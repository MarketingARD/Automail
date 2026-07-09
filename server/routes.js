import { Router } from 'express';
import { db, getSetting, setSetting } from './db.js';
import { syncAccount, deleteRemote, testConnection } from './imap.js';
import { sendReply } from './smtp.js';
import { processMessage, processPending } from './pipeline.js';
import { learnFromOverride } from './ai/heuristics.js';
import { aiDraftReply, aiAvailable, chainStatus, claudeCliProbe } from './ai/engine.js';
import * as providers from './ai/providers.js';
import * as openaiCompat from './ai/openai-compat.js';
import * as anthropicAdapter from './ai/claude.js';
import * as subscriptionAdapter from './ai/claudecode.js';
import { search, contextFor, ragStats, indexMessage, removeFromIndex, matchClient } from './ai/rag.js';
import { createTask, hierarchy, clickupConfigured } from './clickup.js';

export const api = Router();

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, err, code = 400) => res.status(code).json({ ok: false, error: String(err.message || err) });

const accountById = db.prepare ? null : null; // placeholder to keep structure flat
const getAccount = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
const getMessage = (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

// ───────────────────────── Stats / dashboard ─────────────────────────
api.get('/stats', async (req, res) => {
  const accounts = db
    .prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM messages m WHERE m.account_id = a.id AND m.deleted_at IS NULL AND m.is_noise = 0 AND m.is_read = 0) AS unread_focus,
        (SELECT COUNT(*) FROM messages m WHERE m.account_id = a.id AND m.deleted_at IS NULL AND m.is_noise = 1) AS noise_count,
        (SELECT COUNT(*) FROM messages m WHERE m.account_id = a.id AND m.deleted_at IS NULL) AS total
       FROM accounts a ORDER BY a.kind, a.name`
    )
    .all()
    .map(({ imap_pass, smtp_pass, ...rest }) => rest);
  const totals = db
    .prepare(
      `SELECT
        COUNT(*) FILTER (WHERE is_noise = 0 AND is_read = 0) AS focus_unread,
        COUNT(*) FILTER (WHERE is_noise = 0) AS focus_total,
        COUNT(*) FILTER (WHERE is_noise = 1) AS noise_total,
        COUNT(*) FILTER (WHERE task_detected = 1 AND clickup_task_id IS NULL) AS tasks_pending,
        COUNT(*) FILTER (WHERE task_detected = 1 AND clickup_task_id IS NOT NULL) AS tasks_created
       FROM messages WHERE deleted_at IS NULL`
    )
    .get();
  const sweptToday = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE deleted_at >= datetime('now', 'start of day')`)
    .get().n;
  const ragUnique = db.prepare('SELECT COUNT(DISTINCT message_id) AS n FROM embeddings').get().n;
  ok(res, {
    accounts,
    totals,
    sweptToday,
    rag: ragStats(),
    ragUnique,
    ai: await aiAvailable(),
    aiChain: await chainStatus(),
    clickup: clickupConfigured(),
  });
});

// ───────────────────────── Comptes ─────────────────────────
api.get('/accounts', (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY kind, name').all()
    .map(({ imap_pass, smtp_pass, ...rest }) => ({ ...rest, has_imap_pass: Boolean(imap_pass), has_smtp_pass: Boolean(smtp_pass) }));
  ok(res, { accounts: rows });
});

api.post('/accounts', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email) return fail(res, 'Nom et adresse requis');
  const info = db
    .prepare(
      `INSERT INTO accounts (name, email, kind, color, imap_host, imap_port, imap_user, imap_pass,
       smtp_host, smtp_port, smtp_user, smtp_pass, rag_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.name, b.email.toLowerCase(), b.kind === 'private' ? 'private' : 'pro',
      b.color || '#F6A98C',
      b.imap_host || '', b.imap_port || 993, b.imap_user || '', b.imap_pass || '',
      b.smtp_host || '', b.smtp_port || 465, b.smtp_user || '', b.smtp_pass || '',
      b.rag_enabled ? 1 : 0
    );
  ok(res, { id: info.lastInsertRowid });
});

api.put('/accounts/:id', (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return fail(res, 'Compte introuvable', 404);
  const b = req.body || {};
  const merged = {
    ...acc,
    ...b,
    kind: (b.kind ?? acc.kind) === 'private' ? 'private' : 'pro',
    rag_enabled: b.rag_enabled !== undefined ? (b.rag_enabled ? 1 : 0) : acc.rag_enabled,
    paused: b.paused !== undefined ? (b.paused ? 1 : 0) : acc.paused,
    imap_pass: b.imap_pass || acc.imap_pass,
    smtp_pass: b.smtp_pass || acc.smtp_pass,
  };
  db.prepare(
    `UPDATE accounts SET name=?, email=?, kind=?, color=?, imap_host=?, imap_port=?, imap_user=?, imap_pass=?,
     smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, rag_enabled=?, paused=? WHERE id=?`
  ).run(
    merged.name, merged.email, merged.kind, merged.color,
    merged.imap_host, merged.imap_port, merged.imap_user, merged.imap_pass,
    merged.smtp_host, merged.smtp_port, merged.smtp_user, merged.smtp_pass,
    merged.rag_enabled, merged.paused, acc.id
  );
  // opt-in/out RAG → réindexation en arrière-plan
  if (b.rag_enabled !== undefined && Boolean(b.rag_enabled) !== Boolean(acc.rag_enabled)) {
    reindexAccount(acc.id).catch((e) => console.error('[rag] réindexation:', e.message));
  }
  ok(res, {});
});

async function reindexAccount(accountId) {
  const account = getAccount(accountId);
  const msgs = db
    .prepare('SELECT * FROM messages WHERE account_id = ? AND deleted_at IS NULL')
    .all(accountId);
  for (const m of msgs) {
    if (account.rag_enabled) await indexMessage(m, account);
    else removeFromIndex(m.id);
  }
}

api.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  ok(res, {});
});

api.post('/accounts/:id/test', async (req, res) => {
  const acc = getAccount(req.params.id);
  if (!acc) return fail(res, 'Compte introuvable', 404);
  try {
    await testConnection(acc);
    ok(res, { message: 'Connexion IMAP OK' });
  } catch (err) {
    fail(res, err);
  }
});

api.post('/accounts/:id/sync', async (req, res) => {
  try {
    const result = await syncAccount(Number(req.params.id));
    ok(res, result);
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────── Messages ─────────────────────────
api.get('/messages', (req, res) => {
  const { accountId, status = 'focus', q = '', clientId, limit = 200, offset = 0 } = req.query;
  const where = ['m.deleted_at IS NULL'];
  const params = [];
  if (accountId) { where.push('m.account_id = ?'); params.push(accountId); }
  if (clientId) { where.push('m.client_id = ?'); params.push(clientId); }
  if (status === 'focus') where.push('m.is_noise = 0');
  else if (status === 'noise') where.push('m.is_noise = 1');
  if (q) {
    where.push('(m.subject LIKE ? OR m.from_email LIKE ? OR m.from_name LIKE ? OR m.snippet LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = db
    .prepare(
      `SELECT m.id, m.account_id, m.subject, m.from_name, m.from_email, m.date, m.snippet,
              m.is_read, m.is_noise, m.noise_score, m.noise_reason, m.noise_source,
              m.task_detected, m.task_json, m.clickup_task_id, m.clickup_url, m.client_id,
              a.name AS account_name, a.color AS account_color, a.kind AS account_kind,
              c.name AS client_name, c.color AS client_color
       FROM messages m
       JOIN accounts a ON a.id = m.account_id
       LEFT JOIN clients c ON c.id = m.client_id
       WHERE ${where.join(' AND ')}
       ORDER BY m.date DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Number(limit), Number(offset));
  ok(res, { messages: rows });
});

api.get('/messages/:id', async (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return fail(res, 'Message introuvable', 404);
  const account = getAccount(msg.account_id);
  db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(msg.id);
  let rag = { scope: null, results: [] };
  try {
    rag = await contextFor(msg, account);
  } catch (err) {
    console.error('[rag] contexte:', err.message);
  }
  const client = msg.client_id
    ? db.prepare('SELECT id, name, color FROM clients WHERE id = ?').get(msg.client_id)
    : null;
  const { imap_pass, smtp_pass, ...safeAccount } = account;
  ok(res, { message: msg, account: safeAccount, client, rag });
});

// triage manuel : bruit ↔ normal (+ apprentissage)
api.post('/messages/:id/noise', async (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return fail(res, 'Message introuvable', 404);
  const isNoise = Boolean(req.body?.noise);
  db.prepare(
    `UPDATE messages SET is_noise = ?, noise_source = 'user',
     noise_reason = ?, noise_score = ? WHERE id = ?`
  ).run(isNoise ? 1 : 0, isNoise ? 'marqué bruit par vous' : 'restauré par vous', isNoise ? 1 : 0, msg.id);
  if (req.body?.learn !== false) learnFromOverride(msg.from_email, isNoise);
  // le bruit sort de la base RAG ; un mail restauré y retourne
  const account = getAccount(msg.account_id);
  const updated = getMessage(msg.id);
  try {
    await indexMessage(updated, account);
  } catch (err) {
    console.error('[rag] triage réindexation:', err.message);
  }
  ok(res, { learned: req.body?.learn !== false });
});

// actions groupées
api.post('/messages/bulk', async (req, res) => {
  const { ids = [], action } = req.body || {};
  if (!ids.length) return fail(res, 'Aucun message sélectionné');
  const placeholders = ids.map(() => '?').join(',');
  if (action === 'noise' || action === 'restore') {
    const isNoise = action === 'noise';
    db.prepare(
      `UPDATE messages SET is_noise = ?, noise_source = 'user',
       noise_reason = ? WHERE id IN (${placeholders})`
    ).run(isNoise ? 1 : 0, isNoise ? 'marqué bruit par vous' : 'restauré par vous', ...ids);
    for (const id of ids) {
      const m = getMessage(id);
      if (!m) continue;
      learnFromOverride(m.from_email, isNoise);
      try { await indexMessage(m, getAccount(m.account_id)); } catch { /* réindexation best-effort */ }
    }
    return ok(res, { updated: ids.length });
  }
  if (action === 'read') {
    db.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${placeholders})`).run(...ids);
    return ok(res, { updated: ids.length });
  }
  if (action === 'delete') {
    const result = await deleteMessages(ids);
    return ok(res, result);
  }
  fail(res, `Action inconnue : ${action}`);
});

async function deleteMessages(ids) {
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, account_id, uid FROM messages WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
    .all(...ids);
  const byAccount = new Map();
  for (const r of rows) {
    if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, []);
    byAccount.get(r.account_id).push(r);
  }
  let remote = 0;
  const remoteErrors = [];
  for (const [accountId, msgs] of byAccount) {
    const account = getAccount(accountId);
    const uids = msgs.map((m) => m.uid).filter(Boolean);
    if (account.imap_host && uids.length) {
      try {
        const r = await deleteRemote(account, uids);
        remote += r.moved;
      } catch (err) {
        remoteErrors.push(`${account.name}: ${err.message}`);
      }
    }
  }
  db.prepare(`UPDATE messages SET deleted_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM embeddings WHERE message_id IN (${placeholders})`).run(...ids);
  return { deleted: rows.length, remote, remoteErrors };
}

// balayage : supprime tout le bruit d'un coup (par compte ou global)
api.post('/messages/sweep', async (req, res) => {
  const { accountId } = req.body || {};
  const rows = db
    .prepare(
      `SELECT id FROM messages WHERE is_noise = 1 AND deleted_at IS NULL
       ${accountId ? 'AND account_id = ?' : ''}`
    )
    .all(...(accountId ? [accountId] : []));
  if (!rows.length) return ok(res, { deleted: 0, remote: 0, remoteErrors: [] });
  const result = await deleteMessages(rows.map((r) => r.id));
  ok(res, result);
});

// re-triage manuel (IA si dispo)
api.post('/messages/:id/classify', async (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return fail(res, 'Message introuvable', 404);
  db.prepare("UPDATE messages SET noise_source = '' WHERE id = ?").run(msg.id);
  const updated = await processMessage(msg.id);
  ok(res, { message: updated });
});

api.post('/messages/process-pending', async (req, res) => {
  const n = await processPending(req.body?.accountId || null);
  ok(res, { processed: n });
});

// brouillon IA avec contexte RAG
api.post('/messages/:id/draft', async (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return fail(res, 'Message introuvable', 404);
  const account = getAccount(msg.account_id);
  let rag = { results: [] };
  try {
    rag = await contextFor(msg, account, 6);
  } catch { /* contexte RAG best-effort */ }
  const draft = await aiDraftReply({
    message: msg,
    context: rag.results,
    instructions: req.body?.instructions || '',
    senderName: account.name,
  });
  if (draft == null)
    return fail(res, "Brouillon indisponible — configurez un moteur IA (abonnement Claude ou clé API) dans Réglages → Intelligence.", 503);
  ok(res, { draft, contextUsed: rag.results.length, scope: rag.scope });
});

// envoi de la réponse
api.post('/messages/:id/send', async (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return fail(res, 'Message introuvable', 404);
  const account = getAccount(msg.account_id);
  const { text } = req.body || {};
  if (!text) return fail(res, 'Corps de réponse vide');
  try {
    const id = await sendReply(account, {
      to: msg.from_email,
      subject: msg.subject,
      text,
      inReplyTo: msg.message_id,
    });
    ok(res, { messageId: id });
  } catch (err) {
    fail(res, err);
  }
});

// création de tâche ClickUp
api.post('/messages/:id/task', async (req, res) => {
  const msg = getMessage(req.params.id);
  if (!msg) return fail(res, 'Message introuvable', 404);
  const task = req.body?.task || (msg.task_json ? JSON.parse(msg.task_json) : null);
  if (!task?.title) return fail(res, 'Aucune tâche détectée dans ce mail');
  try {
    const created = await createTask(task, msg);
    db.prepare('UPDATE messages SET clickup_task_id = ?, clickup_url = ?, task_detected = 1, task_json = ? WHERE id = ?')
      .run(created.id, created.url, JSON.stringify(task), msg.id);
    ok(res, created);
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────── Clients (bases RAG pro) ─────────────────────────
api.get('/clients', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM messages m WHERE m.client_id = c.id AND m.deleted_at IS NULL) AS message_count,
        (SELECT COUNT(DISTINCT e.message_id) FROM embeddings e WHERE e.scope = 'client:' || c.id) AS indexed_count
       FROM clients c ORDER BY c.name`
    )
    .all();
  ok(res, { clients: rows });
});

api.post('/clients', (req, res) => {
  const b = req.body || {};
  if (!b.name) return fail(res, 'Nom requis');
  const info = db
    .prepare('INSERT INTO clients (name, domains, color, notes) VALUES (?, ?, ?, ?)')
    .run(b.name, JSON.stringify(b.domains || []), b.color || '#7B68D8', b.notes || '');
  rematchClient(info.lastInsertRowid).catch((e) => console.error('[rag] rematch:', e.message));
  ok(res, { id: info.lastInsertRowid });
});

api.put('/clients/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return fail(res, 'Client introuvable', 404);
  const b = req.body || {};
  db.prepare('UPDATE clients SET name = ?, domains = ?, color = ?, notes = ? WHERE id = ?').run(
    b.name ?? c.name,
    JSON.stringify(b.domains ?? JSON.parse(c.domains)),
    b.color ?? c.color,
    b.notes ?? c.notes,
    c.id
  );
  rematchClient(c.id).catch((e) => console.error('[rag] rematch:', e.message));
  ok(res, {});
});

/** Rattache rétroactivement les mails pro existants à un client (et réindexe). */
async function rematchClient(clientId) {
  const msgs = db
    .prepare(
      `SELECT m.* FROM messages m JOIN accounts a ON a.id = m.account_id
       WHERE a.kind = 'pro' AND m.deleted_at IS NULL AND (m.client_id IS NULL OR m.client_id = ?)`
    )
    .all(clientId);
  for (const m of msgs) {
    const matched = matchClient(m.from_email, m.to_json);
    if (matched !== m.client_id) {
      db.prepare('UPDATE messages SET client_id = ? WHERE id = ?').run(matched, m.id);
      const account = getAccount(m.account_id);
      try { await indexMessage({ ...m, client_id: matched }, account); } catch { /* best-effort */ }
    }
  }
}

api.delete('/clients/:id', (req, res) => {
  db.prepare("DELETE FROM embeddings WHERE scope = 'client:' || ?").run(req.params.id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  ok(res, {});
});

api.get('/clients/:id/documents', (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.message_id, e.chunk_text, e.created_at, m.subject, m.from_email, m.date
       FROM embeddings e JOIN messages m ON m.id = e.message_id
       WHERE e.scope = 'client:' || ? ORDER BY m.date DESC LIMIT 100`
    )
    .all(req.params.id);
  ok(res, { documents: rows });
});

// ───────────────────────── RAG ─────────────────────────
api.get('/rag/search', async (req, res) => {
  const { q, scope = 'pro', k = 8 } = req.query;
  if (!q) return fail(res, 'Requête vide');
  try {
    const results = await search(String(q), String(scope), Number(k));
    ok(res, { results });
  } catch (err) {
    fail(res, err);
  }
});

api.get('/rag/stats', (req, res) => ok(res, { stats: ragStats() }));

// ───────────────────────── Réglages ─────────────────────────
const SETTING_KEYS = [
  'ai_triage', 'clickup_token', 'clickup_list_id', 'clickup_list_name', 'user_name',
];

api.get('/settings', (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k, '');
  out.clickup_token = out.clickup_token ? '••••' + out.clickup_token.slice(-4) : '';
  out.env_clickup = Boolean(process.env.CLICKUP_TOKEN);
  ok(res, { settings: out });
});

// ───────────────────────── Fournisseurs IA (chaîne) ─────────────────────────
api.get('/providers', async (req, res) => {
  const probe = await claudeCliProbe(Boolean(req.query.reprobe));
  ok(res, {
    providers: providers.all().map(providers.publicView),
    presets: providers.PRESETS,
    claude_cli: { ok: probe.ok, info: probe.ok ? probe.version : probe.error },
  });
});

api.post('/providers', (req, res) => {
  const b = req.body || {};
  const preset = b.preset ? providers.presetById(b.preset) : null;
  if (!preset && !b.kind) return fail(res, 'Fournisseur inconnu');
  const id = providers.create(b);
  ok(res, { id });
});

api.put('/providers/:id', (req, res) => {
  if (!providers.update(Number(req.params.id), req.body || {})) return fail(res, 'Fournisseur introuvable', 404);
  ok(res, {});
});

api.delete('/providers/:id', (req, res) => {
  providers.remove(Number(req.params.id));
  ok(res, {});
});

api.post('/providers/:id/move', (req, res) => {
  providers.move(Number(req.params.id), req.body?.dir === 'up' ? 'up' : 'down');
  ok(res, {});
});

api.post('/providers/:id/reset', (req, res) => {
  providers.resetHealth(Number(req.params.id));
  ok(res, {});
});

// Test rapide : une classification bidon pour vérifier clé + endpoint.
api.post('/providers/:id/test', async (req, res) => {
  const p = providers.get(Number(req.params.id));
  if (!p) return fail(res, 'Fournisseur introuvable', 404);
  const probe = await claudeCliProbe();
  if (!providers.isConfigured(p, probe.ok)) return fail(res, 'Fournisseur non configuré (clé, URL ou modèle manquant).');
  const adapter = p.kind === 'claude_subscription' ? subscriptionAdapter
    : p.kind === 'anthropic' ? anthropicAdapter : openaiCompat;
  const filled = { ...p, api_key: providers.effectiveKey(p) };
  try {
    const r = await adapter.classify(filled, {
      subject: 'Newsletter — soldes -50% cette semaine',
      fromName: 'Promos', fromEmail: 'newsletter@example.com',
      bodyText: 'Découvrez nos offres. Se désabonner en bas de page.', accountKind: 'pro',
    });
    providers.markOk(p.id);
    ok(res, { message: `OK — a répondu (bruit=${r.isNoise}).` });
  } catch (err) {
    const { cooldownMs } = await import('./ai/errors.js');
    providers.markCooldown(p.id, err.kind || 'error', err.message, cooldownMs(err));
    fail(res, err.message || 'échec');
  }
});

api.put('/settings', (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) {
    if (b[k] === undefined) continue;
    if ((k === 'anthropic_key' || k === 'clickup_token') && String(b[k]).startsWith('••••')) continue;
    setSetting(k, b[k]);
  }
  ok(res, {});
});

api.get('/clickup/hierarchy', async (req, res) => {
  try {
    ok(res, { teams: await hierarchy() });
  } catch (err) {
    fail(res, err);
  }
});

// règles apprises
api.get('/rules', (req, res) => {
  ok(res, { rules: db.prepare('SELECT * FROM sender_rules ORDER BY hits DESC').all() });
});
api.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM sender_rules WHERE id = ?').run(req.params.id);
  ok(res, {});
});
