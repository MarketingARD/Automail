// Moteur cascade : parcourt la chaîne de fournisseurs activés dans l'ordre.
// Le premier qui répond gagne. Un fournisseur à court de quota (429), sans
// crédit, ou en erreur est mis en pause (cooldown) et Automail bascule
// automatiquement sur le suivant. Si toute la chaîne est épuisée : retour à
// null (le pipeline retombe alors sur les heuristiques locales).
import * as providers from './providers.js';
import { cooldownMs } from './errors.js';
import * as subscription from './claudecode.js';
import * as anthropic from './claude.js';
import * as openai from './openai-compat.js';
import { claudeCliProbe } from './claudecode.js';

function adapterFor(kind) {
  if (kind === 'claude_subscription') return subscription;
  if (kind === 'anthropic') return anthropic;
  return openai; // 'openai' et compatibles
}

/** Prépare un fournisseur pour l'appel : injecte la clé effective. */
function withKey(p) {
  return { ...p, api_key: providers.effectiveKey(p) };
}

async function runChain(method, input) {
  const probe = await claudeCliProbe();
  const chain = providers.enabledOrdered();
  const now = Date.now();
  for (const p of chain) {
    if (!providers.isConfigured(p, probe.ok)) continue;
    if (providers.inCooldown(p, now)) continue;
    const adapter = adapterFor(p.kind);
    try {
      const value = await adapter[method](withKey(p), input);
      if (value == null) {
        providers.markCooldown(p.id, 'error', 'réponse vide', 30_000);
        continue;
      }
      providers.markOk(p.id);
      return { value, provider: p.name };
    } catch (err) {
      const kind = err.kind || 'error';
      providers.markCooldown(p.id, kind, err.message, cooldownMs(err));
      console.error(`[chaîne] ${p.name} (${kind}):`, (err.message || '').slice(0, 160));
      // on continue avec le fournisseur suivant
    }
  }
  return null;
}

/** Au moins un fournisseur activé et configuré peut-il répondre ? */
export async function aiAvailable() {
  const probe = await claudeCliProbe();
  return providers.enabledOrdered().some((p) => providers.isConfigured(p, probe.ok));
}

export async function aiClassify(input) {
  const r = await runChain('classify', input);
  return r ? r.value : null;
}

export async function aiDraftReply(input) {
  const r = await runChain('draft', input);
  return r ? r.value : null;
}

/** État de la chaîne pour l'UI : chaque fournisseur + statut résolu. */
export async function chainStatus() {
  const probe = await claudeCliProbe();
  const now = Date.now();
  return providers.all().map((p) => {
    const configured = providers.isConfigured(p, probe.ok);
    let status = 'ready';
    if (!p.enabled) status = 'disabled';
    else if (!configured) status = p.kind === 'claude_subscription' ? 'cli_missing' : 'unconfigured';
    else if (providers.inCooldown(p, now)) status = p.last_status || 'cooldown';
    else if (p.last_status && p.last_status !== 'unused' && p.last_status !== 'ok') status = 'ready';
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      preset: p.preset,
      status,
      last_status: p.last_status,
      last_error: p.last_error,
      cooldown_until: providers.inCooldown(p, now) ? p.cooldown_until : null,
    };
  });
}

export { claudeCliProbe };
