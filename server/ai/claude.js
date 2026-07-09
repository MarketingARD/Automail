// Adaptateur « Anthropic clé API » (SDK). Lève une ProviderError typée en cas
// d'échec pour que le moteur cascade puisse basculer sur le fournisseur suivant.
import { ProviderError } from './errors.js';
import {
  classifySystem, classifyUser, draftSystem, draftUser,
  extractJson, normalizeClassification,
} from './prompts.js';

const CLASSIFY_MODEL = (p) => p.model || process.env.AUTOMAIL_CLASSIFY_MODEL || 'claude-haiku-4-5';
const DRAFT_MODEL = (p) => p.model || process.env.AUTOMAIL_DRAFT_MODEL || 'claude-sonnet-5';

const clients = new Map();
async function client(key) {
  if (clients.has(key)) return clients.get(key);
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const c = new Anthropic({ apiKey: key });
  clients.set(key, c);
  return c;
}

function mapError(err) {
  const status = err?.status;
  const msg = err?.message || 'erreur Anthropic';
  if (status === 429) {
    const ra = err?.headers?.['retry-after'];
    return new ProviderError(msg, { kind: 'rate_limit', status, retryAfterMs: ra ? Number(ra) * 1000 : null });
  }
  if (status === 401 || status === 403) return new ProviderError(msg, { kind: 'auth', status });
  if (status === 400 && /credit|balance|quota/i.test(msg)) return new ProviderError(msg, { kind: 'quota', status });
  if (status >= 500 || status === 529) return new ProviderError(msg, { kind: 'unavailable', status });
  return new ProviderError(msg, { kind: 'error', status });
}

export async function classify(provider, { subject, fromName, fromEmail, bodyText, accountKind }) {
  const key = provider.api_key;
  if (!key) throw new ProviderError('clé API manquante', { kind: 'auth' });
  try {
    const c = await client(key);
    const res = await c.messages.create({
      model: CLASSIFY_MODEL(provider),
      max_tokens: 500,
      system: classifySystem(accountKind),
      messages: [{ role: 'user', content: classifyUser({ fromName, fromEmail, subject, bodyText }) }],
    });
    return normalizeClassification(extractJson(res.content.map((b) => b.text || '').join('')));
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw mapError(err);
  }
}

export async function draft(provider, { message, context, instructions, senderName }) {
  const key = provider.api_key;
  if (!key) throw new ProviderError('clé API manquante', { kind: 'auth' });
  try {
    const c = await client(key);
    const res = await c.messages.create({
      model: DRAFT_MODEL(provider),
      max_tokens: 1200,
      system: draftSystem(senderName),
      messages: [{ role: 'user', content: draftUser({ message, context, instructions }) }],
    });
    return res.content.map((b) => b.text || '').join('').trim();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw mapError(err);
  }
}
