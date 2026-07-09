// Données de démonstration — trois boîtes, trois clients, ~50 mails réalistes.
// Usage : npm run seed   (réinitialise la base)
process.env.AUTOMAIL_SEED = '1'; // triage heuristique uniquement, aucun appel IA réel
import { db } from './db.js';
import { processMessage } from './pipeline.js';

const daysAgo = (d, h = 9, m = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - d);
  date.setHours(h, m, 0, 0);
  return date.toISOString();
};

console.log('▸ Réinitialisation de la base…');
db.exec('DELETE FROM embeddings; DELETE FROM messages; DELETE FROM sender_rules; DELETE FROM clients; DELETE FROM accounts;');

const insAccount = db.prepare(
  `INSERT INTO accounts (name, email, kind, color, imap_host, rag_enabled, last_sync_at)
   VALUES (?, ?, ?, ?, '', ?, datetime('now'))`
);
const ard = insAccount.run('ARD Studio', 'marketing@ardigital.eu', 'pro', '#F6A98C', 1).lastInsertRowid;
const freelance = insAccount.run('Alex — Freelance', 'alex@steies.fr', 'pro', '#E289BC', 1).lastInsertRowid;
const perso = insAccount.run('Perso', 'alex.steies@gmail.com', 'private', '#7B68D8', 1).lastInsertRowid;

const insClient = db.prepare('INSERT INTO clients (name, domains, color, notes) VALUES (?, ?, ?, ?)');
insClient.run('Maison Lumière', JSON.stringify(['maisonlumiere.fr']), '#F6A98C', 'Marque de luminaires design — refonte e-commerce + campagnes.');
insClient.run('Nordwind', JSON.stringify(['nordwind.io']), '#E289BC', 'SaaS logistique — contenu LinkedIn et site vitrine.');
insClient.run('Café Balthazar', JSON.stringify(['cafebalthazar.be', 'sofia.balthazar@gmail.com']), '#7B68D8', 'Torréfacteur bruxellois — identité et packaging.');

const insMsg = db.prepare(
  `INSERT INTO messages (account_id, uid, folder, message_id, subject, from_name, from_email, to_json,
    date, snippet, body_text, is_read, task_detected, task_json)
   VALUES (?, ?, 'INBOX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let uid = 1000;
function mail(accountId, { subject, fromName, fromEmail, date, body, read = 0, task = null }) {
  uid += 1;
  const accEmail = db.prepare('SELECT email FROM accounts WHERE id = ?').get(accountId).email;
  return insMsg.run(
    accountId, uid, `<seed-${uid}@automail.local>`, subject, fromName, fromEmail.toLowerCase(),
    JSON.stringify([{ address: accEmail, name: '' }]),
    date, body.replace(/\s+/g, ' ').trim().slice(0, 220), body.trim(), read,
    task ? 1 : 0, task ? JSON.stringify(task) : null
  ).lastInsertRowid;
}

console.log('▸ Boîte ARD Studio (pro)…');
// ── Fil Maison Lumière : historique riche pour le RAG
mail(ard, {
  subject: 'Brief refonte boutique en ligne', fromName: 'Claire Fontaine', fromEmail: 'claire@maisonlumiere.fr',
  date: daysAgo(21, 10, 12), read: 1,
  body: `Bonjour Alex,

Suite à notre appel, voici le brief pour la refonte de la boutique : nous voulons mettre en avant la collection "Aube" (12 références), simplifier le tunnel d'achat (3 étapes max) et intégrer Klarna en plus de Stripe.

Budget validé : 18 000 € HT. Lancement souhaité avant le salon Maison&Objet.

Claire Fontaine — Directrice, Maison Lumière`,
});
mail(ard, {
  subject: 'Re: Brief refonte boutique en ligne — maquettes v1', fromName: 'Claire Fontaine', fromEmail: 'claire@maisonlumiere.fr',
  date: daysAgo(12, 15, 40), read: 1,
  body: `Alex,

Les maquettes v1 sont superbes, surtout la page collection. Deux retours : le panier doit rester visible en mobile, et Hugo aimerait des photos plus chaudes pour la série "Aube" (il vous envoie le nouveau shooting lundi).

On valide la direction. Facture d'acompte reçue et payée ce matin.

Claire`,
});
mail(ard, {
  subject: 'Validation maquettes + planning intégration', fromName: 'Claire Fontaine', fromEmail: 'claire@maisonlumiere.fr',
  date: daysAgo(2, 9, 5),
  body: `Bonjour Alex,

Nous validons les maquettes v2 ! Pour la suite : pouvez-vous nous envoyer le planning d'intégration d'ici vendredi ? Le salon est confirmé du 5 au 9 septembre, il nous faut la boutique en ligne au moins deux semaines avant.

Autre point : Hugo veut ajouter une page "Savoir-faire" avec la vidéo de l'atelier. Est-ce que ça rentre dans l'enveloppe ?

Merci !
Claire`,
  task: { title: 'Envoyer le planning d’intégration à Maison Lumière', details: 'Claire attend le planning avant vendredi — boutique en ligne à livrer 2 semaines avant le salon (5-9 sept). Chiffrer aussi la page "Savoir-faire".', due: daysAgo(-3).slice(0, 10) },
});
// ── Fil Nordwind
mail(ard, {
  subject: 'Calendrier éditorial LinkedIn — T3', fromName: 'Jonas Meyer', fromEmail: 'jonas@nordwind.io',
  date: daysAgo(15, 11, 20), read: 1,
  body: `Salut Alex,

Le calendrier T2 a super bien marché (+38 % d'impressions, 214 leads). Pour T3 on veut doubler la cadence : 3 posts/semaine dont 1 carrousel. Sujets prioritaires : l'API de tracking, le cas client DHL, et la série "coulisses logistique".

On garde le même process de validation ? Budget à discuter jeudi.

Jonas`,
});
mail(ard, {
  subject: 'Re: Calendrier éditorial — retour sur les 3 premiers posts', fromName: 'Jonas Meyer', fromEmail: 'jonas@nordwind.io',
  date: daysAgo(1, 16, 45),
  body: `Alex,

Les 3 premiers posts T3 sont en ligne, le carrousel API fait déjà 2x notre moyenne. Peux-tu préparer le cas client DHL pour la semaine prochaine ? Il nous faut l'interview de leur ops manager — je te mets en contact avec elle (Birgit) demain.

Deadline idéale : posté mercredi prochain.

Jonas`,
  task: { title: 'Préparer le cas client DHL pour Nordwind', details: 'Interview de Birgit (ops manager DHL) à caler, post à publier mercredi prochain. Jonas fait l’intro demain.', due: daysAgo(-7).slice(0, 10) },
});
// ── Café Balthazar
mail(ard, {
  subject: 'Packaging nouvelle gamme — retours imprimeur', fromName: 'Sofia Balthazar', fromEmail: 'sofia.balthazar@gmail.com',
  date: daysAgo(4, 14, 15), read: 1,
  body: `Bonjour Alex,

L'imprimeur nous dit que le pantone 7412 C sort trop orange sur le kraft. Il propose un test avec le 7413 C ou un papier couché. Tu peux regarder les scans en pièce jointe et me dire ce qui trahit le moins la maquette ?

Aussi : on lance la gamme au marché de la place Sainte-Catherine le 26, il nous faut les étiquettes le 20 au plus tard.

Sofia — Café Balthazar`,
  task: { title: 'Arbitrer le pantone packaging Café Balthazar', details: 'Comparer 7412 C vs 7413 C sur kraft (scans imprimeur). Étiquettes à livrer le 20 — lancement le 26 place Sainte-Catherine.', due: daysAgo(-2).slice(0, 10) },
});
// ── Prospect
mail(ard, {
  subject: 'Demande de devis — identité visuelle cabinet d’architectes', fromName: 'Marc Op de Beeck', fromEmail: 'marc@opdebeeck-architecten.be',
  date: daysAgo(0, 8, 32),
  body: `Bonjour,

Nous sommes un cabinet d'architectes à Anvers (14 personnes) et nous cherchons un studio pour refondre notre identité : logo, site, plaquette. Votre travail pour Maison Lumière nous a beaucoup plu.

Seriez-vous disponible pour un appel cette semaine ? Notre budget se situe entre 15 et 25 k€.

Bien à vous,
Marc Op de Beeck`,
  task: { title: 'Répondre au prospect Op de Beeck Architecten', details: 'Cabinet d’architectes à Anvers, budget 15-25 k€, identité complète. Proposer un créneau d’appel cette semaine.', due: null },
});
// ── Bruit pro
const NOISE_ARD = [
  ['Webinaire : 5 tendances social media pour 2027 🚀', 'HubSpot', 'marketing@hubspotemail.net', 6, `Découvrez notre webinaire exclusif sur les tendances social media. Inscrivez-vous gratuitement ! Se désabonner : cliquez ici.`],
  ['Votre facture Canva Pro est disponible', 'Canva', 'no-reply@canva.com', 5, `Votre reçu de paiement pour Canva Pro (12,99 €/mois) est disponible dans votre espace. Ceci est un message automatique.`],
  ['⚡ Dernière chance : -40 % sur tous les templates', 'Envato Market', 'newsletter@envato.com', 3, `Offre limitée : -40 % sur tous les templates jusqu'à dimanche. Ne manquez pas cette promo exceptionnelle ! Unsubscribe.`],
  ['Alex, votre rapport de performance LinkedIn est prêt', 'LinkedIn', 'notifications-noreply@linkedin.com', 2, `Votre page ARD Studio a reçu 847 impressions cette semaine (+12 %). Voir le rapport complet. Gérer vos préférences de notification.`],
  ['Newsletter Stratégies #442 — le récap de la semaine', 'Stratégies', 'newsletter@strategies.fr', 1, `Au sommaire cette semaine : les budgets pub repartent, interview du CMO de Decathlon, et notre dossier retail media. Se désabonner de la newsletter.`],
  ['Nouvelle connexion à votre compte Meta Business', 'Meta for Business', 'notification@facebookmail.com', 0, `Une nouvelle connexion à votre compte Meta Business Suite a été détectée depuis Bruxelles. Si c'était vous, ignorez ce message.`],
];
for (const [subject, fromName, fromEmail, d, body] of NOISE_ARD) {
  mail(ard, { subject, fromName, fromEmail, date: daysAgo(d, 7, 30), body });
}

console.log('▸ Boîte Freelance (pro)…');
mail(freelance, {
  subject: 'Montage aftermovie — timecodes à revoir', fromName: 'Léa Verstraeten', fromEmail: 'lea@festivalhorizon.be',
  date: daysAgo(3, 18, 20), read: 1,
  body: `Salut Alex,

Le premier cut de l'aftermovie est très fort ! Trois retours : la séquence drone à 01:12 est trop longue de 10 secondes, on aimerait le drop synchronisé sur le feu d'artifice, et le logo sponsor doit apparaître avant 00:10.

Tu peux nous envoyer une v2 pour mardi ? La première a été vue 40 000 fois l'an dernier, on veut faire mieux.

Léa`,
  task: { title: 'Livrer la v2 de l’aftermovie Festival Horizon', details: 'Raccourcir la séquence drone (-10 s à 01:12), synchroniser le drop sur le feu d’artifice, logo sponsor avant 00:10. Deadline mardi.', due: daysAgo(-5).slice(0, 10) },
});
mail(freelance, {
  subject: 'Contrat cadre 2026-2027 — relecture', fromName: 'Thomas Janssens', fromEmail: 'thomas.janssens@rtbf.be',
  date: daysAgo(7, 10, 0), read: 1,
  body: `Bonjour Alex,

Voici le contrat cadre pour les captations 2026-2027 : 24 jours de tournage garantis, tarif jour à 650 €, matériel fourni sauf optiques. La clause d'exclusivité ne concerne que les chaînes belges francophones.

Merci de nous renvoyer le document signé avant le 15.

Thomas`,
  task: { title: 'Relire et signer le contrat cadre RTBF', details: '24 jours garantis à 650 €/jour, exclusivité limitée aux chaînes belges francophones. À renvoyer signé avant le 15.', due: daysAgo(-6).slice(0, 10) },
});
mail(freelance, {
  subject: 'Re: Disponibilités captation concert — 22/07', fromName: 'Nina Kowalski', fromEmail: 'nina@lebotanique.be',
  date: daysAgo(0, 11, 15),
  body: `Alex,

Parfait pour le 22 ! Appel technique lundi à 14h avec notre régisseur. Prévois ta config deux caméras + le stabilisateur, la salle est sombre (Rotonde). Cachet habituel + 10 % pour la nuit.

Nina`,
});
const NOISE_FREE = [
  ['Vimeo : votre stockage arrive à 80 %', 'Vimeo', 'no-reply@vimeo.com', 4, `Votre espace de stockage Vimeo Pro atteint 80 %. Passez au plan supérieur pour continuer à uploader sans limite.`],
  ['🎬 Frame.io — What’s new: camera to cloud updates', 'Frame.io', 'updates@frame.io', 2, `New in Frame.io: C2C support for more cameras, faster proxies workflow. Read the digest. Unsubscribe.`],
  ['Promo matériel : -25 % sur les cartes CFexpress', 'Digit Photo', 'promo@digitphoto.fr', 1, `Vente flash : -25 % sur les cartes CFexpress 512 Go jusqu'à ce soir minuit. Découvrez notre sélection. Se désabonner.`],
];
for (const [subject, fromName, fromEmail, d, body] of NOISE_FREE) {
  mail(freelance, { subject, fromName, fromEmail, date: daysAgo(d, 8, 10), body });
}

console.log('▸ Boîte Perso (privé)…');
mail(perso, {
  subject: 'Anniversaire de Papa — on s’organise ?', fromName: 'Marie Steies', fromEmail: 'marie.steies@gmail.com',
  date: daysAgo(2, 20, 30),
  body: `Coucou,

Pour les 65 ans de Papa le 30, je propose le restaurant "Chez Franz" (celui qu'il adore, avec la terrasse). On serait 12. Tu peux t'occuper de réserver ? Moi je gère le gâteau et le cadeau commun (on est déjà 8 à participer, 40 € chacun).

Dis-moi vite !
Marie`,
  task: { title: 'Réserver Chez Franz pour les 65 ans de Papa', details: '12 personnes le 30, demander la terrasse. Participation cadeau commun : 40 €.', due: daysAgo(-4).slice(0, 10) },
});
mail(perso, {
  subject: 'Re: Location chalet Ardennes — caution rendue', fromName: 'Peter Willems', fromEmail: 'peter@ardennes-chalets.be',
  date: daysAgo(9, 12, 0), read: 1,
  body: `Bonjour Alex,

La caution de 300 € a été remboursée sur votre compte ce matin. Merci d'avoir laissé le chalet impeccable ! Vous êtes les bienvenus pour la saison d'hiver — les réservations ouvrent en septembre, je peux vous bloquer le week-end du nouvel an si vous voulez.

Peter`,
});
mail(perso, {
  subject: 'Résultats de ta prise de sang', fromName: 'Cabinet Dr. Lambert', fromEmail: 'secretariat@cabinet-lambert.be',
  date: daysAgo(1, 9, 45),
  body: `Bonjour,

Vos résultats d'analyse sont disponibles. Tout est dans les normes, mais le Dr Lambert souhaite un contrôle de la ferritine dans 3 mois. Vous pouvez prendre rendez-vous en ligne ou nous appeler.

Le secrétariat`,
});
const NOISE_PERSO = [
  ['Votre commande Amazon a été expédiée 📦', 'Amazon', 'ship-confirm@amazon.fr', 2, `Votre commande n°403-583 (câble HDMI 2.1, 2 m) a été expédiée. Livraison prévue demain. Suivre mon colis.`],
  ['Spotify Wrapped intermédiaire : votre été en musique 🎧', 'Spotify', 'no-reply@spotify.com', 3, `Alex, découvrez ce que vous avez écouté cet été. Votre artiste du moment, vos titres en boucle. Voir mon récap. Gérer les préférences.`],
  ['-50 % sur votre prochaine commande UberEats 🍕', 'Uber Eats', 'promo@ubereats.com', 1, `Offre spéciale : -50 % sur votre prochaine commande (max 15 €) avec le code SUMMER50. Valable 48 h. Se désabonner des offres.`],
  ['Newsletter Vélo Mag — spécial gravel', 'Vélo Mag', 'newsletter@velomag.fr', 5, `Notre dossier gravel : 8 vélos testés, les meilleurs itinéraires belges, et l'équipement pour rouler l'hiver. Se désabonner.`],
  ['Rappel : votre abonnement Basic-Fit se renouvelle', 'Basic-Fit', 'no-reply@basic-fit.com', 4, `Votre abonnement Comfort (24,99 €/4 semaines) se renouvelle le 15. Gérez votre abonnement dans l'app.`],
  ['Loïc a publié 12 photos de "Randonnée Semois"', 'Facebook', 'notification@facebookmail.com', 6, `Loïc Dubois a publié 12 photos dans l'album Randonnée Semois. Voir les photos. Se désabonner de ces notifications.`],
];
for (const [subject, fromName, fromEmail, d, body] of NOISE_PERSO) {
  mail(perso, { subject, fromName, fromEmail, date: daysAgo(d, 17, 20), body });
}

console.log('▸ Triage + indexation RAG (heuristiques locales)…');
const ids = db.prepare('SELECT id FROM messages ORDER BY id').all();
const tasksBefore = new Map(
  db.prepare('SELECT id, task_detected, task_json FROM messages WHERE task_detected = 1').all()
    .map((r) => [r.id, r])
);
for (const { id } of ids) {
  await processMessage(id);
  // le pipeline heuristique ne détecte pas les tâches : on restaure celles du seed
  const t = tasksBefore.get(id);
  if (t) db.prepare('UPDATE messages SET task_detected = 1, task_json = ? WHERE id = ?').run(t.task_json, id);
}

const stats = db.prepare(
  `SELECT COUNT(*) AS total, SUM(is_noise) AS noise, SUM(task_detected) AS tasks,
   SUM(embedded) AS embedded FROM messages`
).get();
console.log(`✓ Seed terminé : ${stats.total} mails, ${stats.noise} classés bruit, ${stats.tasks} tâches détectées, ${stats.embedded} indexés RAG.`);
