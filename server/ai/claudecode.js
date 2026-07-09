// Moteur « abonnement Claude » : appelle Claude Code CLI en mode headless
// (`claude -p --output-format json`). Consomme l'abonnement Claude Pro/Max de
// l'utilisateur (connexion claude.ai ou jeton `claude setup-token`) — aucune
// clé API requise. Réservé à un usage personnel local, conformément aux
// conditions d'Anthropic.
import { spawn } from 'node:child_process';
import { getSetting } from '../db.js';
import {
  classifySystem, classifyUser, draftSystem, draftUser,
  extractJson, normalizeClassification,
} from './prompts.js';

const CLASSIFY_MODEL = () =>
  process.env.AUTOMAIL_CLASSIFY_MODEL || getSetting('classify_model') || 'haiku';
const DRAFT_MODEL = () =>
  process.env.AUTOMAIL_DRAFT_MODEL || getSetting('draft_model') || 'sonnet';

let probePromise = null;

/** Détecte le CLI `claude` (résultat mis en cache). */
export function claudeCliProbe(force = false) {
  if (!probePromise || force) {
    probePromise = new Promise((resolve) => {
      let out = '';
      let done = false;
      const finish = (result) => { if (!done) { done = true; resolve(result); } };
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
 * Lance `claude -p` avec le prompt sur stdin et retourne le texte de réponse.
 * ANTHROPIC_API_KEY est retirée de l'environnement pour forcer
 * l'authentification par abonnement (sinon le CLI facturerait la clé API).
 */
function runClaude(prompt, { model, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const args = ['-p', '--output-format', 'json'];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p : délai dépassé (${timeout / 1000}s)`));
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude -p → code ${code}: ${(stderr || stdout).slice(0, 300)}`));
      }
      try {
        // enveloppe JSON du mode headless : { type: "result", result: "…", is_error, … }
        const envelope = JSON.parse(stdout);
        if (envelope.is_error) return reject(new Error(String(envelope.result || 'erreur claude').slice(0, 300)));
        resolve(String(envelope.result ?? ''));
      } catch {
        // certains cas de figure renvoient du texte brut
        resolve(stdout.trim());
      }
    });
    child.stdin.on('error', () => { /* processus mort avant la fin de l'écriture */ });
    child.stdin.end(prompt);
  });
}

/** Même contrat que claude.js : { isNoise, score, reason, task } ou null. */
export async function aiClassify({ subject, fromName, fromEmail, bodyText, accountKind }) {
  const probe = await claudeCliProbe();
  if (!probe.ok) return null;
  try {
    const prompt = `${classifySystem(accountKind)}\n\n---\n\n${classifyUser({ fromName, fromEmail, subject, bodyText })}`;
    const text = await runClaude(prompt, { model: CLASSIFY_MODEL() });
    return normalizeClassification(extractJson(text));
  } catch (err) {
    console.error('[abonnement] classification échouée:', err.message);
    return null;
  }
}

/** Même contrat que claude.js : texte du brouillon ou null. */
export async function aiDraftReply({ message, context, instructions, senderName }) {
  const probe = await claudeCliProbe();
  if (!probe.ok) return null;
  try {
    const prompt = `${draftSystem(senderName)}\n\n---\n\n${draftUser({ message, context, instructions })}`;
    const text = await runClaude(prompt, { model: DRAFT_MODEL(), timeout: 180000 });
    return text.trim() || null;
  } catch (err) {
    console.error('[abonnement] brouillon échoué:', err.message);
    return null;
  }
}
