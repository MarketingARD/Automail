// Chaîne de fournisseurs IA : liste ordonnée, santé (cooldown), presets.
// Le moteur (engine.js) parcourt les fournisseurs activés dans l'ordre et
// bascule sur le suivant dès qu'un fournisseur est à court de quota.
import { db, getSetting } from '../db.js';

// ── Catalogue de presets (fournisseurs à quota gratuit compatibles OpenAI) ──
// base_url et model sont modifiables : les modèles et endpoints évoluent.
export const PRESETS = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', signup: 'https://platform.openai.com/api-keys', note: 'Jetons quotidiens offerts si compte avec historique payant + partage de données activé.' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', base_url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', signup: 'https://console.mistral.ai/api-keys', note: 'Quota gratuit généreux, clé sans carte bancaire.' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', signup: 'https://aistudio.google.com/apikey', note: 'Free tier sans carte. RPD limité selon le modèle.' },
  { id: 'groq', label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', signup: 'https://console.groq.com/keys', note: 'Inférence ultra-rapide, quota journalier gratuit.' },
  { id: 'cerebras', label: 'Cerebras', kind: 'openai', base_url: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', signup: 'https://cloud.cerebras.ai/', note: '1M jetons gratuits par modèle et par jour.' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', base_url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', signup: 'https://openrouter.ai/keys', note: 'Des dizaines de modèles :free, une seule clé.' },
  { id: 'qwen', label: 'Qwen (Alibaba)', kind: 'openai', base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', signup: 'https://bailian.console.alibabacloud.com/', note: '1M jetons gratuits par modèle, 90 jours.' },
  { id: 'nvidia', label: 'NVIDIA NIM', kind: 'openai', base_url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', signup: 'https://build.nvidia.com/', note: 'Accès gratuit à ~100 modèles.' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', kind: 'openai', base_url: 'https://api.cloudflare.com/client/v4/accounts/VOTRE_ACCOUNT_ID/ai/v1', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', signup: 'https://dash.cloudflare.com/', note: 'Remplacez VOTRE_ACCOUNT_ID dans l’URL. 10k neurones/jour gratuits.' },
  { id: 'huggingface', label: 'Hugging Face', kind: 'openai', base_url: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', signup: 'https://huggingface.co/settings/tokens', note: 'Petit quota mensuel gratuit, modèles OSS.' },
  { id: 'anthropic', label: 'Anthropic (clé API)', kind: 'anthropic', base_url: '', model: '', signup: 'https://console.anthropic.com/settings/keys', note: 'Facturation à l’usage — Claude Haiku/Sonnet.' },
  { id: 'custom', label: 'Autre (compatible OpenAI)', kind: 'openai', base_url: '', model: '', signup: '', note: 'Tout endpoint /chat/completions compatible OpenAI.' },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

const cols = 'id, name, kind, preset, base_url, api_key, model, enabled, sort_order, cooldown_until, last_status, last_error, last_used_at';

export function all() {
  return db.prepare(`SELECT ${cols} FROM providers ORDER BY sort_order, id`).all();
}

export function enabledOrdered() {
  return db.prepare(`SELECT ${cols} FROM providers WHERE enabled = 1 ORDER BY sort_order, id`).all();
}

export function get(id) {
  return db.prepare(`SELECT ${cols} FROM providers WHERE id = ?`).get(id);
}

/** Clé effective : la clé du fournisseur, ou l'env pour Anthropic (compat .env). */
export function effectiveKey(p) {
  if (p.api_key) return p.api_key;
  if (p.kind === 'anthropic') return process.env.ANTHROPIC_API_KEY || getSetting('anthropic_key') || '';
  return '';
}

/** Un fournisseur peut-il produire un résultat maintenant (config complète) ? */
export function isConfigured(p, claudeCliOk) {
  if (p.kind === 'claude_subscription') return Boolean(claudeCliOk);
  if (p.kind === 'anthropic') return Boolean(effectiveKey(p));
  return Boolean(p.base_url && effectiveKey(p) && p.model);
}

export function inCooldown(p, now = Date.now()) {
  return p.cooldown_until && new Date(p.cooldown_until).getTime() > now;
}

export function markOk(id) {
  db.prepare(
    "UPDATE providers SET last_status='ok', last_error='', cooldown_until=NULL, last_used_at=datetime('now') WHERE id=?"
  ).run(id);
}

/** Met le fournisseur en pause. status: 'rate_limit'|'quota'|'auth'|'error'… */
export function markCooldown(id, status, message, ms) {
  const until = new Date(Date.now() + ms).toISOString();
  db.prepare(
    "UPDATE providers SET last_status=?, last_error=?, cooldown_until=?, last_used_at=datetime('now') WHERE id=?"
  ).run(status, String(message || '').slice(0, 300), until, id);
}

export function resetHealth(id = null) {
  if (id) db.prepare("UPDATE providers SET cooldown_until=NULL, last_status='unused', last_error='' WHERE id=?").run(id);
  else db.prepare("UPDATE providers SET cooldown_until=NULL, last_status='unused', last_error=''").run();
}

export function create(input) {
  const preset = input.preset ? presetById(input.preset) : null;
  const kind = input.kind || preset?.kind || 'openai';
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM providers').get().m;
  const info = db
    .prepare(
      `INSERT INTO providers (name, kind, preset, base_url, api_key, model, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name || preset?.label || 'Fournisseur',
      kind,
      input.preset || '',
      input.base_url ?? preset?.base_url ?? '',
      input.api_key || '',
      input.model ?? preset?.model ?? '',
      input.enabled === false ? 0 : 1,
      maxOrder + 1
    );
  return info.lastInsertRowid;
}

export function update(id, input) {
  const p = get(id);
  if (!p) return false;
  db.prepare(
    `UPDATE providers SET name=?, base_url=?, model=?, enabled=?, api_key=? WHERE id=?`
  ).run(
    input.name ?? p.name,
    input.base_url ?? p.base_url,
    input.model ?? p.model,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : p.enabled,
    // clé masquée (••••) → on garde l'existante
    input.api_key && !String(input.api_key).startsWith('••••') ? input.api_key : p.api_key,
    id
  );
  // un changement de config remet la santé à zéro
  if (input.api_key || input.base_url || input.model) resetHealth(id);
  return true;
}

export function remove(id) {
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

/** Déplace un fournisseur dans l'ordre de la chaîne. */
export function move(id, dir) {
  const list = all();
  const idx = list.findIndex((p) => p.id === Number(id));
  if (idx === -1) return;
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return;
  const a = list[idx];
  const b = list[swapWith];
  const tx = db.transaction(() => {
    db.prepare('UPDATE providers SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
    db.prepare('UPDATE providers SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  });
  tx();
}

/** Masque les clés pour l'API publique. */
export function publicView(p) {
  const { api_key, ...rest } = p;
  return {
    ...rest,
    has_key: Boolean(effectiveKey(p)),
    key_from_env: !api_key && p.kind === 'anthropic' && Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

/** Amorce la chaîne au premier lancement : abonnement Claude en tête. */
export function ensureDefaults() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM providers').get().n;
  if (count > 0) return;
  create({ name: 'Abonnement Claude', kind: 'claude_subscription', preset: '', enabled: true });
  const legacyKey = getSetting('anthropic_key') || '';
  if (legacyKey || process.env.ANTHROPIC_API_KEY) {
    create({ name: 'Anthropic (clé API)', kind: 'anthropic', preset: 'anthropic', api_key: legacyKey, enabled: true });
  }
}
