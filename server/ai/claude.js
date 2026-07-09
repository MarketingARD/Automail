// Moteur « clé API » (Anthropic SDK). Voir engine.js pour le choix du moteur.
import { getSetting } from '../db.js';
import {
  classifySystem, classifyUser, draftSystem, draftUser,
  extractJson, normalizeClassification,
} from './prompts.js';

const CLASSIFY_MODEL = () =>
  process.env.AUTOMAIL_CLASSIFY_MODEL || getSetting('classify_model') || 'claude-haiku-4-5';
const DRAFT_MODEL = () =>
  process.env.AUTOMAIL_DRAFT_MODEL || getSetting('draft_model') || 'claude-sonnet-5';

let _client = null;
let _clientKey = null;

export function apiKey() {
  return process.env.ANTHROPIC_API_KEY || getSetting('anthropic_key') || '';
}

export function aiAvailable() {
  return Boolean(apiKey());
}

async function client() {
  const key = apiKey();
  if (!key) return null;
  if (_client && _clientKey === key) return _client;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: key });
  _clientKey = key;
  return _client;
}

/**
 * Classification bruit + détection de tâche en un seul appel.
 * Retourne { isNoise, score, reason, task } ou null si indisponible/erreur.
 */
export async function aiClassify({ subject, fromName, fromEmail, bodyText, accountKind }) {
  const c = await client();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: CLASSIFY_MODEL(),
      max_tokens: 500,
      system: classifySystem(accountKind),
      messages: [{ role: 'user', content: classifyUser({ fromName, fromEmail, subject, bodyText }) }],
    });
    return normalizeClassification(extractJson(res.content.map((b) => b.text || '').join('')));
  } catch (err) {
    console.error('[api] classification échouée:', err.message);
    return null;
  }
}

/** Brouillon de réponse avec contexte RAG. Retourne le texte ou null. */
export async function aiDraftReply({ message, context, instructions, senderName }) {
  const c = await client();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: DRAFT_MODEL(),
      max_tokens: 1200,
      system: draftSystem(senderName),
      messages: [{ role: 'user', content: draftUser({ message, context, instructions }) }],
    });
    return res.content.map((b) => b.text || '').join('').trim();
  } catch (err) {
    console.error('[api] brouillon échoué:', err.message);
    return null;
  }
}
