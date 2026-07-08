// Couche IA optionnelle (Anthropic). Sans clé, Automail retombe sur les
// heuristiques locales — l'app reste 100 % fonctionnelle.
import { getSetting } from '../db.js';

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

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('réponse IA sans JSON');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Classification bruit + détection de tâche en un seul appel.
 * Retourne { isNoise, score, reason, task: {title, details, due}|null } ou null si IA indisponible/erreur.
 */
export async function aiClassify({ subject, fromName, fromEmail, bodyText, accountKind }) {
  const c = await client();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: CLASSIFY_MODEL(),
      max_tokens: 500,
      system: `Tu tries la boîte mail (${accountKind === 'private' ? 'personnelle' : 'professionnelle'}) d'un indépendant français. Réponds UNIQUEMENT en JSON strict.

"Bruit" = newsletters, promos, notifications automatiques de plateformes, publicités, invitations marketing, digests — tout ce qui ne demande ni lecture attentive ni action personnelle.
PAS du bruit = messages écrits par un humain pour ce destinataire, demandes clients, factures à payer, confirmations importantes (billets, rendez-vous, administratif), échanges en cours.

Détecte aussi si le mail contient une tâche actionnable pour le destinataire (une demande explicite, un livrable, une échéance). Une newsletter n'est jamais une tâche.

Format:
{"is_noise": bool, "score": 0..1, "reason": "explication courte en français", "task": null | {"title": "verbe d'action + objet", "details": "1-2 phrases de contexte", "due": null | "YYYY-MM-DD"}}`,
      messages: [
        {
          role: 'user',
          content: `De: ${fromName || ''} <${fromEmail}>\nObjet: ${subject}\n\n${(bodyText || '').slice(0, 3000)}`,
        },
      ],
    });
    const parsed = extractJson(res.content.map((b) => b.text || '').join(''));
    return {
      isNoise: Boolean(parsed.is_noise),
      score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
      reason: String(parsed.reason || ''),
      task: parsed.task && parsed.task.title ? parsed.task : null,
    };
  } catch (err) {
    console.error('[ai] classification échouée:', err.message);
    return null;
  }
}

/**
 * Brouillon de réponse avec contexte RAG.
 * context = [{subject, fromEmail, date, chunk_text}]
 */
export async function aiDraftReply({ message, context, instructions, senderName }) {
  const c = await client();
  if (!c) return null;
  const contextBlock = (context || [])
    .map(
      (x, i) =>
        `[${i + 1}] ${x.date || ''} — ${x.from_email || x.fromEmail || ''} — ${x.subject || ''}\n${(x.chunk_text || '').slice(0, 900)}`
    )
    .join('\n\n');
  try {
    const res = await c.messages.create({
      model: DRAFT_MODEL(),
      max_tokens: 1200,
      system: `Tu rédiges des réponses d'email pour ${senderName || "l'utilisateur"}, en français sauf si le mail reçu est dans une autre langue. Ton naturel, direct, professionnel sans raideur. Utilise l'historique fourni pour être précis (dates, engagements, contexte) sans le paraphraser inutilement. Réponds uniquement avec le corps du mail, sans objet ni commentaire.`,
      messages: [
        {
          role: 'user',
          content: `HISTORIQUE PERTINENT (base de connaissance):\n${contextBlock || '(vide)'}\n\nMAIL À RÉPONDRE:\nDe: ${message.from_name} <${message.from_email}>\nObjet: ${message.subject}\n\n${(message.body_text || '').slice(0, 4000)}\n\n${instructions ? 'CONSIGNES: ' + instructions : 'Rédige une réponse adaptée.'}`,
        },
      ],
    });
    return res.content.map((b) => b.text || '').join('').trim();
  } catch (err) {
    console.error('[ai] brouillon échoué:', err.message);
    return null;
  }
}
