// Classification du bruit sans IA : règles apprises + heuristiques locales.
// Sert de base toujours disponible ; l'IA (si clé fournie) affine par-dessus.
import { db } from '../db.js';

const NOREPLY_RE = /^(no-?reply|do-?not-?reply|notification[s]?|newsletter|news|info-?promo|mailer|bounce|marketing|hello|updates?|ship-?confirm|order-?update|auto-?confirm|billing|receipts?)@/i;

const SUBJECT_NOISE = [
  /newsletter/i, /désabonn/i, /unsubscribe/i, /promo(tion)?s?\b/i, /soldes?\b/i,
  /-\s?\d{1,2}\s?%/, /\d{1,2}\s?%\s?(de\s)?(remise|réduction|off)/i, /vente\s+(privée|flash)/i,
  /offre\s+(spéciale|exclusive|limitée)/i, /black\s?friday/i, /derni[eè]re\s+chance/i,
  /ne\s+manquez\s+pas/i, /découvrez\s+(notre|nos|les)/i, /webinaire?/i, /webinar/i,
  /facture\s+.{0,20}(est\s+)?disponible/i, /reçu\s+de\s+paiement/i,
  /commande\s+.{0,30}(expédiée|livrée|en\s+route)/i, /abonnement\s+.{0,30}(se\s+renouvelle|expire|renouvelé)/i,
  /arrive\s+à\s+\d+\s?%/i, /votre\s+(récap|rapport|bilan)\s/i, /wrapped/i,
  /confirmez\s+votre\s+(inscription|abonnement)/i, /bienvenue\s+chez/i,
  /invitation\s+linkedin/i, /a\s+publié|vient\s+de\s+publier/i, /new\s+sign-?in/i,
  /digest/i, /récap(itulatif)?\s+(hebdo|de\s+la\s+semaine)/i, /weekly\s+(recap|digest)/i,
  /🔥|⚡|🎁|💥|🚀|😍|��/u,
];

const NOISE_DOMAINS = [
  'mailchimp.com', 'sendgrid.net', 'sendinblue.com', 'brevo.com', 'mailjet.com',
  'substack.com', 'medium.com', 'linkedin.com', 'facebookmail.com', 'twitter.com',
  'x.com', 'instagram.com', 'pinterest.com', 'tiktok.com', 'quora.com', 'meetup.com',
  'eventbrite.com', 'amazonses.com', 'klaviyomail.com', 'hubspotemail.net',
];

export function senderPatterns(fromEmail) {
  const email = (fromEmail || '').toLowerCase().trim();
  const domain = email.split('@')[1] || '';
  return { email, domain: domain ? '@' + domain : '' };
}

/** Règle apprise (corrections utilisateur) → priorité absolue. */
export function ruleFor(fromEmail) {
  const { email, domain } = senderPatterns(fromEmail);
  if (!email) return null;
  const row = db
    .prepare('SELECT * FROM sender_rules WHERE pattern = ? OR pattern = ? ORDER BY pattern = ? DESC LIMIT 1')
    .get(email, domain, email);
  return row || null;
}

/**
 * Score heuristique 0..1 (1 = bruit certain).
 * headers: Map ou objet éventuel avec list-unsubscribe / precedence.
 */
export function heuristicNoise({ subject = '', fromEmail = '', headers = {}, bodyText = '' }) {
  let score = 0;
  const reasons = [];
  const h = (name) => {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()];
  };

  if (h('list-unsubscribe')) { score += 0.45; reasons.push('lien de désabonnement'); }
  const precedence = String(h('precedence') || '').toLowerCase();
  if (precedence.includes('bulk') || precedence.includes('list')) { score += 0.25; reasons.push('envoi en masse'); }
  if (NOREPLY_RE.test(fromEmail)) { score += 0.3; reasons.push('expéditeur no-reply'); }

  const { domain } = senderPatterns(fromEmail);
  if (NOISE_DOMAINS.some((d) => domain.endsWith(d))) { score += 0.35; reasons.push('plateforme d’envoi marketing'); }

  let subjectHits = 0;
  for (const re of SUBJECT_NOISE) if (re.test(subject)) subjectHits++;
  if (subjectHits > 0) {
    score += Math.min(0.25 + subjectHits * 0.15, 0.55);
    reasons.push('objet type newsletter/promo');
  }
  const bodyHead = bodyText.slice(0, 4000);
  if (/se\s+désabonner|unsubscribe|gérer\s+(mes|vos|les)\s+préférences/i.test(bodyHead)) {
    score += 0.2; reasons.push('mention de désabonnement');
  }
  if (/message\s+automatique|ne\s+(pas\s+)?répond(ez|re)\s+(pas\s+)?à\s+ce|suivre\s+(mon|votre)\s+colis|gérez?\s+votre\s+abonnement|passez\s+au\s+plan\s+supérieur/i.test(bodyHead)) {
    score += 0.2; reasons.push('notification automatique');
  }

  return { score: Math.min(score, 1), reason: reasons.join(', ') };
}

/**
 * Décision complète : règle apprise > heuristique.
 * Retourne { isNoise, score, reason, source }.
 */
export function classifyLocal(msg) {
  const rule = ruleFor(msg.fromEmail);
  if (rule) {
    db.prepare('UPDATE sender_rules SET hits = hits + 1 WHERE id = ?').run(rule.id);
    return {
      isNoise: rule.action === 'noise',
      score: rule.action === 'noise' ? 1 : 0,
      reason: `règle apprise (${rule.pattern})`,
      source: 'rule',
    };
  }
  const { score, reason } = heuristicNoise(msg);
  return { isNoise: score >= 0.5, score, reason: reason || 'aucun signal de bruit', source: 'heuristic' };
}

/** Corrige le triage et apprend une règle expéditeur. */
export function learnFromOverride(fromEmail, markedAsNoise) {
  const { email } = senderPatterns(fromEmail);
  if (!email) return;
  db.prepare(
    `INSERT INTO sender_rules (pattern, action, hits) VALUES (?, ?, 1)
     ON CONFLICT(pattern) DO UPDATE SET action = excluded.action, hits = sender_rules.hits + 1`
  ).run(email, markedAsNoise ? 'noise' : 'keep');
}
