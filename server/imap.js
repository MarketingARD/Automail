// Synchronisation IMAP incrémentale (imapflow) + actions distantes
// (suppression, déplacement corbeille) pour le balayage du bruit.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { db } from './db.js';
import { processMessage } from './pipeline.js';
import { heuristicNoise } from './ai/heuristics.js';

const syncing = new Set();

function imapClient(account) {
  return new ImapFlow({
    host: account.imap_host,
    port: account.imap_port || 993,
    secure: (account.imap_port || 993) === 993,
    auth: { user: account.imap_user || account.email, pass: account.imap_pass },
    logger: false,
  });
}

export function sanitize(html) {
  return sanitizeHtml(html || '', {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'span']),
    allowedAttributes: {
      '*': ['style', 'align', 'width', 'height'],
      a: ['href'],
      img: ['src', 'alt', 'width', 'height'],
    },
    allowedSchemes: ['https', 'http', 'mailto', 'data', 'cid'],
  });
}

function snippet(text) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

/** Synchronise la boîte INBOX d'un compte. Retourne le nombre de nouveaux mails. */
export async function syncAccount(accountId, { limit = 100 } = {}) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Compte introuvable');
  if (!account.imap_host) throw new Error('IMAP non configuré pour ce compte');
  if (syncing.has(accountId)) return { added: 0, skipped: 'déjà en cours' };
  syncing.add(accountId);

  const client = imapClient(account);
  let added = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const lastUidRow = db
        .prepare('SELECT MAX(uid) AS max_uid FROM messages WHERE account_id = ? AND folder = ?')
        .get(accountId, 'INBOX');
      const sinceUid = (lastUidRow?.max_uid || 0) + 1;
      const range =
        lastUidRow?.max_uid ? `${sinceUid}:*` : `${Math.max(1, (client.mailbox.exists || 0) - limit + 1)}:*`;

      const newIds = [];
      for await (const raw of client.fetch(
        range,
        { uid: true, envelope: true, source: true, flags: true, headers: ['list-unsubscribe', 'precedence'] },
        { uid: Boolean(lastUidRow?.max_uid) }
      )) {
        if (lastUidRow?.max_uid && raw.uid <= lastUidRow.max_uid) continue;
        const parsed = await simpleParser(raw.source);
        const from = parsed.from?.value?.[0] || {};
        const to = (parsed.to?.value || []).map((v) => ({ address: v.address, name: v.name }));
        const bodyText = parsed.text || '';
        const bodyHtml = parsed.html ? sanitize(parsed.html) : '';
        // pré-score heuristique avec les vrais en-têtes (perdus ensuite)
        const pre = heuristicNoise({
          subject: parsed.subject || '',
          fromEmail: from.address || '',
          headers: raw.headers ? Object.fromEntries(
            String(raw.headers).split(/\r?\n/).filter(Boolean).map((l) => {
              const i = l.indexOf(':');
              return [l.slice(0, i).toLowerCase().trim(), l.slice(i + 1).trim()];
            })
          ) : {},
          bodyText,
        });
        try {
          const info = db
            .prepare(
              `INSERT INTO messages (account_id, uid, folder, message_id, subject, from_name, from_email,
               to_json, date, snippet, body_text, body_html, is_read, noise_score, noise_reason)
               VALUES (?, ?, 'INBOX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              accountId,
              raw.uid,
              parsed.messageId || null,
              parsed.subject || '(sans objet)',
              from.name || '',
              (from.address || '').toLowerCase(),
              JSON.stringify(to),
              (parsed.date || new Date()).toISOString(),
              snippet(bodyText),
              bodyText,
              bodyHtml,
              raw.flags?.has('\\Seen') ? 1 : 0,
              pre.score,
              pre.reason
            );
          newIds.push(info.lastInsertRowid);
          added++;
        } catch (err) {
          if (!/UNIQUE constraint/.test(err.message)) throw err;
        }
      }
      // triage async après la boucle fetch (ne pas bloquer le lock IMAP)
      lock.release();
      for (const id of newIds) await processMessage(id);
    } finally {
      try { lock.release(); } catch { /* déjà relâché */ }
    }
    db.prepare("UPDATE accounts SET last_sync_at = datetime('now'), last_sync_error = NULL WHERE id = ?").run(accountId);
    return { added };
  } catch (err) {
    db.prepare('UPDATE accounts SET last_sync_error = ? WHERE id = ?').run(err.message, accountId);
    throw err;
  } finally {
    syncing.delete(accountId);
    try { await client.logout(); } catch { /* connexion déjà fermée */ }
  }
}

/** Supprime des mails côté serveur IMAP (déplacement corbeille, sinon flag \Deleted + expunge). */
export async function deleteRemote(account, uids) {
  if (!account.imap_host || !uids.length) return { moved: 0, mode: 'local' };
  const client = imapClient(account);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const trash =
        (await client.list()).find((f) => f.specialUse === '\\Trash')?.path || null;
      if (trash) {
        await client.messageMove(uids, trash, { uid: true });
        return { moved: uids.length, mode: 'trash' };
      }
      await client.messageDelete(uids, { uid: true });
      return { moved: uids.length, mode: 'expunge' };
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* connexion déjà fermée */ }
  }
}

/** Teste la connexion IMAP d'un compte (sans rien lire). */
export async function testConnection(account) {
  const client = imapClient(account);
  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (err) {
    throw new Error(`Connexion IMAP échouée : ${err.message}`);
  }
}

/** Boucle de synchronisation périodique de tous les comptes actifs. */
export function startSyncLoop() {
  const interval = (Number(process.env.AUTOMAIL_SYNC_INTERVAL) || 180) * 1000;
  const tick = async () => {
    const accounts = db
      .prepare('SELECT id, name FROM accounts WHERE paused = 0 AND imap_host IS NOT NULL AND imap_host != \'\'')
      .all();
    for (const acc of accounts) {
      try {
        const { added } = await syncAccount(acc.id);
        if (added) console.log(`[sync] ${acc.name}: ${added} nouveau(x) mail(s)`);
      } catch (err) {
        console.error(`[sync] ${acc.name}:`, err.message);
      }
    }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, interval);
}
