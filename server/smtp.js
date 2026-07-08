// Envoi de réponses via SMTP (nodemailer).
import nodemailer from 'nodemailer';

export async function sendReply(account, { to, subject, text, inReplyTo }) {
  if (!account.smtp_host) throw new Error('SMTP non configuré pour ce compte');
  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port || 465,
    secure: (account.smtp_port || 465) === 465,
    auth: {
      user: account.smtp_user || account.imap_user || account.email,
      pass: account.smtp_pass || account.imap_pass,
    },
  });
  const info = await transporter.sendMail({
    from: `"${account.name}" <${account.email}>`,
    to,
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    text,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
  return info.messageId;
}
