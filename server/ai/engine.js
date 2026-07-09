// Choix du moteur IA.
//   'subscription' (défaut) — Claude Code CLI en headless : consomme
//                             l'abonnement Claude Pro/Max, aucune clé requise.
//   'api'                   — clé API Anthropic.
//   'off'                   — heuristiques locales uniquement.
// Si l'abonnement est choisi mais que le CLI `claude` est introuvable,
// repli automatique sur la clé API quand elle existe.
import { getSetting } from '../db.js';
import * as api from './claude.js';
import * as subscription from './claudecode.js';
import { claudeCliProbe } from './claudecode.js';

export function engineName() {
  return getSetting('ai_engine', 'subscription');
}

/** Résout le moteur réellement utilisable : 'subscription' | 'api' | null. */
export async function resolveEngine() {
  const wanted = engineName();
  if (wanted === 'off') return null;
  if (wanted === 'api') return api.aiAvailable() ? 'api' : null;
  // 'subscription'
  const probe = await claudeCliProbe();
  if (probe.ok) return 'subscription';
  return api.aiAvailable() ? 'api' : null;
}

export async function aiAvailable() {
  return (await resolveEngine()) !== null;
}

export async function aiClassify(input) {
  const engine = await resolveEngine();
  if (!engine) return null;
  const result = await (engine === 'api' ? api.aiClassify(input) : subscription.aiClassify(input));
  // le moteur choisi a échoué en cours de route → tenter l'autre
  if (result === null && engine === 'subscription' && api.aiAvailable()) {
    return api.aiClassify(input);
  }
  return result;
}

export async function aiDraftReply(input) {
  const engine = await resolveEngine();
  if (!engine) return null;
  const result = await (engine === 'api' ? api.aiDraftReply(input) : subscription.aiDraftReply(input));
  if (result === null && engine === 'subscription' && api.aiAvailable()) {
    return api.aiDraftReply(input);
  }
  return result;
}

export { claudeCliProbe };
