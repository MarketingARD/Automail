// Connecteur générique pour toute API compatible OpenAI (chat/completions).
// Couvre OpenAI, Mistral, Gemini (endpoint compat), Groq, Cerebras, OpenRouter,
// Qwen/DashScope, NVIDIA NIM, Cloudflare Workers AI, Hugging Face… — tous
// exposent le même protocole. Un seul code, N fournisseurs.
import { ProviderError } from './errors.js';
import {
  classifySystem, classifyUser, draftSystem, draftUser,
  extractJson, normalizeClassification,
} from './prompts.js';

/** Appel chat/completions. Retourne le texte, ou lève une ProviderError typée. */
async function chat({ baseUrl, apiKey, model, system, user, maxTokens, timeout = 60000 }) {
  if (!baseUrl) throw new ProviderError('URL de base manquante', { kind: 'auth' });
  if (!apiKey) throw new ProviderError('clé API manquante', { kind: 'auth' });
  if (!model) throw new ProviderError('modèle non défini', { kind: 'auth' });

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const call = (tokenField) =>
    fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // en-têtes courtois pour OpenRouter (ignorés ailleurs)
        'HTTP-Referer': 'https://localhost/automail',
        'X-Title': 'Automail',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        [tokenField]: maxTokens,
        temperature: 0.3,
      }),
    });

  try {
    let res = await call('max_tokens');
    let body = await res.text();

    // certains modèles récents refusent max_tokens → réessai avec max_completion_tokens
    if (res.status === 400 && /max_completion_tokens/i.test(body)) {
      res = await call('max_completion_tokens');
      body = await res.text();
    }

    if (!res.ok) throw mapHttpError(res, body);

    let data;
    try { data = JSON.parse(body); } catch {
      throw new ProviderError('réponse non-JSON', { kind: 'bad_response', status: res.status });
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new ProviderError('réponse vide', { kind: 'bad_response', status: res.status });
    }
    return text;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err.name === 'AbortError') throw new ProviderError('délai dépassé', { kind: 'unavailable' });
    throw new ProviderError(err.message || 'erreur réseau', { kind: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(res, body) {
  const status = res.status;
  const snippet = (body || '').slice(0, 300);
  if (status === 429) {
    const ra = res.headers.get('retry-after');
    const retryAfterMs = ra && !Number.isNaN(Number(ra)) ? Number(ra) * 1000 : null;
    return new ProviderError(`429 rate limit: ${snippet}`, { kind: 'rate_limit', retryAfterMs, status });
  }
  if (status === 402 || /quota|insufficient|exceeded your|credit/i.test(snippet)) {
    return new ProviderError(`quota épuisé: ${snippet}`, { kind: 'quota', status });
  }
  if (status === 401 || status === 403) {
    return new ProviderError(`auth ${status}: ${snippet}`, { kind: 'auth', status });
  }
  if (status >= 500) {
    return new ProviderError(`serveur ${status}: ${snippet}`, { kind: 'unavailable', status });
  }
  return new ProviderError(`HTTP ${status}: ${snippet}`, { kind: 'error', status });
}

export async function classify(provider, { subject, fromName, fromEmail, bodyText, accountKind }) {
  const text = await chat({
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    model: provider.model,
    system: classifySystem(accountKind),
    user: classifyUser({ fromName, fromEmail, subject, bodyText }),
    maxTokens: 600,
  });
  try {
    return normalizeClassification(extractJson(text));
  } catch {
    throw new ProviderError('classification illisible', { kind: 'bad_response' });
  }
}

export async function draft(provider, { message, context, instructions, senderName }) {
  const text = await chat({
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    model: provider.model,
    system: draftSystem(senderName),
    user: draftUser({ message, context, instructions }),
    maxTokens: 1200,
    timeout: 90000,
  });
  return text.trim();
}
