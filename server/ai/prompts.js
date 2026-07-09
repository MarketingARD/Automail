// Prompts partagés entre les moteurs IA (clé API et abonnement Claude Code).

export function classifySystem(accountKind) {
  return `Tu tries la boîte mail (${accountKind === 'private' ? 'personnelle' : 'professionnelle'}) d'un indépendant français. Réponds UNIQUEMENT en JSON strict, sans texte autour.

"Bruit" = newsletters, promos, notifications automatiques de plateformes, publicités, invitations marketing, digests — tout ce qui ne demande ni lecture attentive ni action personnelle.
PAS du bruit = messages écrits par un humain pour ce destinataire, demandes clients, factures à payer, confirmations importantes (billets, rendez-vous, administratif), échanges en cours.

Détecte aussi si le mail contient une tâche actionnable pour le destinataire (une demande explicite, un livrable, une échéance). Une newsletter n'est jamais une tâche.

Format:
{"is_noise": bool, "score": 0..1, "reason": "explication courte en français", "task": null | {"title": "verbe d'action + objet", "details": "1-2 phrases de contexte", "due": null | "YYYY-MM-DD"}}`;
}

export function classifyUser({ fromName, fromEmail, subject, bodyText }) {
  return `De: ${fromName || ''} <${fromEmail}>\nObjet: ${subject}\n\n${(bodyText || '').slice(0, 3000)}`;
}

export function draftSystem(senderName) {
  return `Tu rédiges des réponses d'email pour ${senderName || "l'utilisateur"}, en français sauf si le mail reçu est dans une autre langue. Ton naturel, direct, professionnel sans raideur. Utilise l'historique fourni pour être précis (dates, engagements, contexte) sans le paraphraser inutilement. Réponds uniquement avec le corps du mail, sans objet ni commentaire.`;
}

export function draftUser({ message, context, instructions }) {
  const contextBlock = (context || [])
    .map(
      (x, i) =>
        `[${i + 1}] ${x.date || ''} — ${x.from_email || ''} — ${x.subject || ''}\n${(x.chunk_text || '').slice(0, 900)}`
    )
    .join('\n\n');
  return `HISTORIQUE PERTINENT (base de connaissance):\n${contextBlock || '(vide)'}\n\nMAIL À RÉPONDRE:\nDe: ${message.from_name} <${message.from_email}>\nObjet: ${message.subject}\n\n${(message.body_text || '').slice(0, 4000)}\n\n${instructions ? 'CONSIGNES: ' + instructions : 'Rédige une réponse adaptée.'}`;
}

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('réponse IA sans JSON');
  return JSON.parse(text.slice(start, end + 1));
}

export function normalizeClassification(parsed) {
  return {
    isNoise: Boolean(parsed.is_noise),
    score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
    reason: String(parsed.reason || ''),
    task: parsed.task && parsed.task.title ? parsed.task : null,
  };
}
