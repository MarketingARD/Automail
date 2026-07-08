// Base de connaissance RAG.
// Portées ("scopes") :
//   'private'      — toutes les boîtes personnelles opt-in
//   'pro'          — toutes les boîtes pro opt-in
//   'client:<id>'  — sous-ensemble pro rattaché à un client précis
// Un mail pro rattaché à un client est indexé dans 'pro' ET 'client:<id>',
// pour pouvoir chercher large (tout le pro) ou précis (un client).
import { db } from '../db.js';
import { embed, cosine, vecToBlob, blobToVec } from './embeddings.js';

/** Rattache un mail à un client via ses domaines/adresses connus. */
export function matchClient(fromEmail, toJson) {
  const clients = db.prepare('SELECT id, domains FROM clients').all();
  const candidates = [String(fromEmail || '').toLowerCase()];
  try {
    for (const rcpt of JSON.parse(toJson || '[]')) {
      candidates.push(String(rcpt.address || rcpt).toLowerCase());
    }
  } catch { /* to_json malformé : on matche sur l'expéditeur seul */ }
  for (const c of clients) {
    let domains = [];
    try { domains = JSON.parse(c.domains); } catch { continue; }
    for (const d of domains) {
      const needle = String(d).toLowerCase().trim();
      if (!needle) continue;
      for (const addr of candidates) {
        if (!addr) continue;
        if (needle.includes('@') ? addr === needle : addr.endsWith('@' + needle) || addr.endsWith('.' + needle)) {
          return c.id;
        }
      }
    }
  }
  return null;
}

/** Scopes d'indexation pour un message donné (compte + client). */
export function scopesFor(account, clientId) {
  if (!account.rag_enabled) return [];
  const scopes = [account.kind === 'private' ? 'private' : 'pro'];
  if (account.kind === 'pro' && clientId) scopes.push(`client:${clientId}`);
  return scopes;
}

function chunkFor(msg) {
  const header = `De: ${msg.from_name || ''} <${msg.from_email}> — ${msg.date || ''}\nObjet: ${msg.subject || ''}`;
  const body = (msg.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 1800);
  return `${header}\n${body}`;
}

/** Indexe (ou ré-indexe) un message dans ses scopes. */
export async function indexMessage(msg, account) {
  const scopes = scopesFor(account, msg.client_id);
  db.prepare('DELETE FROM embeddings WHERE message_id = ?').run(msg.id);
  if (!scopes.length || msg.is_noise) {
    db.prepare('UPDATE messages SET embedded = 0 WHERE id = ?').run(msg.id);
    return 0;
  }
  const chunk = chunkFor(msg);
  const { vector, model } = await embed(chunk, 'passage');
  const insert = db.prepare(
    'INSERT INTO embeddings (message_id, scope, model, dim, vector, chunk_text) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const scope of scopes) {
    insert.run(msg.id, scope, model, vector.length, vecToBlob(vector), chunk);
  }
  db.prepare('UPDATE messages SET embedded = 1 WHERE id = ?').run(msg.id);
  return scopes.length;
}

export function removeFromIndex(messageId) {
  db.prepare('DELETE FROM embeddings WHERE message_id = ?').run(messageId);
  db.prepare('UPDATE messages SET embedded = 0 WHERE id = ?').run(messageId);
}

/**
 * Recherche les k passages les plus proches dans un scope.
 * Compare uniquement des vecteurs du même modèle que la requête.
 */
export async function search(query, scope, k = 6, excludeMessageId = null) {
  const { vector: qvec, model } = await embed(query, 'query');
  const rows = db
    .prepare(
      `SELECT e.message_id, e.vector, e.model, e.chunk_text,
              m.subject, m.from_email, m.from_name, m.date, m.account_id, m.client_id
       FROM embeddings e JOIN messages m ON m.id = e.message_id
       WHERE e.scope = ? AND m.deleted_at IS NULL`
    )
    .all(scope);
  const scored = [];
  for (const row of rows) {
    if (excludeMessageId && row.message_id === excludeMessageId) continue;
    if (row.model !== model) continue;
    scored.push({ ...row, vector: undefined, score: cosine(qvec, blobToVec(row.vector)) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Contexte RAG pour un message : cherche dans le scope le plus précis disponible. */
export async function contextFor(msg, account, k = 5) {
  let scope = null;
  if (account.kind === 'pro' && msg.client_id) scope = `client:${msg.client_id}`;
  else if (account.kind === 'pro') scope = 'pro';
  else scope = 'private';
  const query = `${msg.subject || ''}\n${(msg.body_text || '').slice(0, 1200)}`;
  const results = await search(query, scope, k, msg.id);
  return { scope, results };
}

export function ragStats() {
  const rows = db
    .prepare(
      `SELECT scope, COUNT(*) AS chunks, COUNT(DISTINCT message_id) AS messages
       FROM embeddings GROUP BY scope`
    )
    .all();
  return rows;
}
