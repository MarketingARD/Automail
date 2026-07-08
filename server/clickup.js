// Intégration ClickUp — création de tâches depuis les mails.
// Jeton personnel : ClickUp → Settings → Apps → API Token.
import { getSetting } from './db.js';

const API = 'https://api.clickup.com/api/v2';

function token() {
  return process.env.CLICKUP_TOKEN || getSetting('clickup_token') || '';
}

export function clickupConfigured() {
  return Boolean(token() && getSetting('clickup_list_id'));
}

async function cu(path, options = {}) {
  const t = token();
  if (!t) throw new Error('Jeton ClickUp manquant (Réglages → Intégrations).');
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: t,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Arborescence équipes → espaces → listes, pour choisir la liste cible dans l'UI. */
export async function hierarchy() {
  const { teams } = await cu('/team');
  const out = [];
  for (const team of teams || []) {
    const { spaces } = await cu(`/team/${team.id}/space?archived=false`);
    const spaceOut = [];
    for (const space of spaces || []) {
      const lists = [];
      const { folders } = await cu(`/space/${space.id}/folder?archived=false`);
      for (const folder of folders || []) {
        for (const l of folder.lists || []) lists.push({ id: l.id, name: `${folder.name} / ${l.name}` });
      }
      const { lists: folderless } = await cu(`/space/${space.id}/list?archived=false`);
      for (const l of folderless || []) lists.push({ id: l.id, name: l.name });
      spaceOut.push({ id: space.id, name: space.name, lists });
    }
    out.push({ id: team.id, name: team.name, spaces: spaceOut });
  }
  return out;
}

/**
 * Crée une tâche ClickUp depuis un mail.
 * task = {title, details, due} ; msg pour le contexte (lien, expéditeur).
 */
export async function createTask(task, msg) {
  const listId = getSetting('clickup_list_id');
  if (!listId) throw new Error('Liste ClickUp non configurée (Réglages → Intégrations).');
  const description = [
    task.details || '',
    '',
    '---',
    `📧 Depuis l'email de ${msg.from_name || msg.from_email} <${msg.from_email}>`,
    `Objet : ${msg.subject}`,
    `Reçu le : ${msg.date || ''}`,
  ].join('\n');
  const payload = {
    name: task.title,
    description,
    ...(task.due ? { due_date: new Date(task.due + 'T17:00:00').getTime() } : {}),
  };
  const created = await cu(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: created.id, url: created.url };
}
