// Pipeline de traitement d'un mail entrant :
// 1. rattachement client (domaines connus)
// 2. triage bruit — règle apprise > IA (si clé) > heuristiques
// 3. détection de tâche (IA)
// 4. indexation RAG (si la boîte est opt-in et que ce n'est pas du bruit)
import { db, getSetting } from './db.js';
import { classifyLocal } from './ai/heuristics.js';
import { aiClassify, aiAvailable } from './ai/claude.js';
import { matchClient, indexMessage } from './ai/rag.js';
import { ruleFor } from './ai/heuristics.js';

export async function processMessage(messageId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!msg) return null;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(msg.account_id);

  // 1. client
  const clientId = account.kind === 'pro' ? matchClient(msg.from_email, msg.to_json) : null;

  // 2 + 3. triage
  const local = classifyLocal({
    subject: msg.subject,
    fromEmail: msg.from_email,
    headers: {},
    bodyText: msg.body_text,
  });
  let triage = local;
  let task = null;

  const useAI = aiAvailable() && getSetting('ai_triage', '1') === '1';
  if (useAI && local.source !== 'rule') {
    const ai = await aiClassify({
      subject: msg.subject,
      fromName: msg.from_name,
      fromEmail: msg.from_email,
      bodyText: msg.body_text,
      accountKind: account.kind,
    });
    if (ai) {
      triage = { isNoise: ai.isNoise, score: ai.score, reason: ai.reason, source: 'ai' };
      task = ai.task;
    }
  }

  db.prepare(
    `UPDATE messages SET client_id = ?, is_noise = ?, noise_score = ?, noise_reason = ?,
     noise_source = ?, task_detected = ?, task_json = ? WHERE id = ?`
  ).run(
    clientId,
    triage.isNoise ? 1 : 0,
    triage.score,
    triage.reason,
    triage.source,
    task ? 1 : 0,
    task ? JSON.stringify(task) : null,
    msg.id
  );

  // 4. RAG
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  try {
    await indexMessage(updated, account);
  } catch (err) {
    console.error('[rag] indexation échouée pour message', msg.id, err.message);
  }
  return updated;
}

/** Retraite tous les messages non encore triés d'un compte (ou tous). */
export async function processPending(accountId = null) {
  const rows = db
    .prepare(
      `SELECT id FROM messages WHERE noise_source = '' AND deleted_at IS NULL
       ${accountId ? 'AND account_id = ?' : ''} ORDER BY date DESC`
    )
    .all(...(accountId ? [accountId] : []));
  let n = 0;
  for (const { id } of rows) {
    await processMessage(id);
    n++;
  }
  return n;
}

export { ruleFor };
