// Client API + types partagés.

export type Account = {
  id: number;
  name: string;
  email: string;
  kind: 'pro' | 'private';
  color: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  rag_enabled: number;
  paused: number;
  last_sync_at: string | null;
  last_sync_error: string | null;
  unread_focus?: number;
  noise_count?: number;
  total?: number;
  has_imap_pass?: boolean;
  has_smtp_pass?: boolean;
};

export type Task = { title: string; details?: string; due?: string | null };

export type Message = {
  id: number;
  account_id: number;
  subject: string;
  from_name: string;
  from_email: string;
  date: string;
  snippet: string;
  body_text?: string;
  body_html?: string;
  is_read: number;
  is_noise: number;
  noise_score: number;
  noise_reason: string;
  noise_source: string;
  task_detected: number;
  task_json: string | null;
  clickup_task_id: string | null;
  clickup_url: string | null;
  client_id: number | null;
  account_name?: string;
  account_color?: string;
  account_kind?: string;
  client_name?: string | null;
  client_color?: string | null;
};

export type Client = {
  id: number;
  name: string;
  domains: string;
  color: string;
  notes: string;
  message_count?: number;
  indexed_count?: number;
};

export type RagHit = {
  message_id: number;
  chunk_text: string;
  subject: string;
  from_email: string;
  from_name: string;
  date: string;
  score: number;
};

export type Stats = {
  accounts: Account[];
  totals: {
    focus_unread: number;
    focus_total: number;
    noise_total: number;
    tasks_pending: number;
    tasks_created: number;
  };
  sweptToday: number;
  rag: { scope: string; chunks: number; messages: number }[];
  ragUnique: number;
  ai: boolean;
  aiChain: ChainEntry[];
  clickup: boolean;
};

export type ChainEntry = {
  id: number;
  name: string;
  kind: string;
  preset: string;
  status: string;
  last_status: string;
  last_error: string;
  cooldown_until: string | null;
};

export type Provider = {
  id: number;
  name: string;
  kind: 'claude_subscription' | 'anthropic' | 'openai';
  preset: string;
  base_url: string;
  model: string;
  enabled: number;
  sort_order: number;
  last_status: string;
  last_error: string;
  cooldown_until: string | null;
  has_key: boolean;
  key_from_env: boolean;
};

export type ProviderPreset = {
  id: string;
  label: string;
  kind: string;
  base_url: string;
  model: string;
  signup: string;
  note: string;
};

class ApiError extends Error {}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new ApiError(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => req<T>(path, { method: 'DELETE' }),
};

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
