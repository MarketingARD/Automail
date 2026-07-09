// Adaptateur « abonnement Claude » : Claude Code CLI en mode headless
// (`claude -p --output-format json`). Consomme l'abonnement Claude Pro/Max de
// l'utilisateur, aucune clé API. Lève une ProviderError typée pour la bascule.
import { spawn } from 'node:child_process';
import { getSetting } from '../db.js';
import { ProviderError } from './errors.js';
import {
  classifySystem, classifyUser, draftSystem, draftUser,
  extractJson, normalizeClassification,
} from './prompts.js';

const CLASSIFY_MODEL = (p) => (p && p.model) || process.env.AUTOMAIL_CLASSIFY_MODEL || getSetting('classify_model') || 'haiku';
const DRAFT_MODEL = (p) => (p && p.model) || process.env.AUTOMAIL_DRAFT_MODEL || getSetting('draft_model') || 'sonnet';

let probePromise = null;

/** Détecte le CLI `claude` (résultat mis en cache). */
export function claudeCliProbe(force = false) {
  if (!probePromise || force) {
    probePromise = new Promise((resolve) => {
      let out = '';
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      let child;
      try {
        child = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        return finish({ ok: false, error: err.message });
      }
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, error: 'délai dépassé' }); }, 10000);
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, error: err.code === 'ENOENT' ? 'commande `claude` introuvable' : err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish(code === 0 ? { ok: true, version: out.trim() } : { ok: false, error: `claude --version → code ${code}` });
      });
    });
  }
  return probePromise;
}

/**
 * Lance `claude -p` avec le prompt sur stdin. ANTHROPIC_API_KEY est retirée de
 * l'environnement pour forcer l'authentification par abonnement.
 */
function runClaude(prompt, { model, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const args = ['-p', '--output-format', 'json'];
    if (model) args.push('--model', model);
    let child;
    try {
      child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new ProviderError(err.message, { kind: 'unavailable' }));
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ProviderError('claude -p : délai dépassé', { kind: 'unavailable' }));
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(new ProviderError(err.message, { kind: 'unavailable' })); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const blob = `${stderr}\n${stdout}`;
      if (code !== 0) return reject(mapCliError(blob, code));
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.is_error) return reject(mapCliError(String(envelope.result || ''), code));
        resolve(String(envelope.result ?? ''));
      } catch {
        resolve(stdout.trim());
      }
    });
    child.stdin.on('error', () => { /* processus mort avant la fin de l'écriture */ });
    child.stdin.end(prompt);
  });
}

function mapCliError(text, code) {
  const t = (text || '').toLowerCase();
  if (/usage limit|rate limit|limit reached|too many requests|429|resets? at/.test(t)) {
    // limite d'abonnement (fenêtre 5 h / hebdo) : pause 30 min puis on rebascule
    return new ProviderError(`limite d'abonnement atteinte: ${text.slice(0, 200)}`, { kind: 'rate_limit', retryAfterMs: 30 * 60_000 });
  }
  if (/not logged in|please run .*login|authentication|unauthor/.test(t)) {
    return new ProviderError('non connecté — lancez `claude` dans le terminal', { kind: 'auth' });
  }
  return new ProviderError(`claude -p → ${code}: ${text.slice(0, 200)}`, { kind: 'error' });
}

async function ensureCli() {
  const probe = await claudeCliProbe();
  if (!probe.ok) throw new ProviderError(`Claude Code indisponible: ${probe.error}`, { kind: 'unavailable', retryAfterMs: 5 * 60_000 });
}

export async function classify(provider, { subject, fromName, fromEmail, bodyText, accountKind }) {
  await ensureCli();
  const prompt = `${classifySystem(accountKind)}\n\n---\n\n${classifyUser({ fromName, fromEmail, subject, bodyText })}`;
  const text = await runClaude(prompt, { model: CLASSIFY_MODEL(provider) });
  try {
    return normalizeClassification(extractJson(text));
  } catch {
    throw new ProviderError('classification illisible', { kind: 'bad_response' });
  }
}

export async function draft(provider, { message, context, instructions, senderName }) {
  await ensureCli();
  const prompt = `${draftSystem(senderName)}\n\n---\n\n${draftUser({ message, context, instructions })}`;
  const text = await runClaude(prompt, { model: DRAFT_MODEL(provider), timeout: 180000 });
  return text.trim();
}
