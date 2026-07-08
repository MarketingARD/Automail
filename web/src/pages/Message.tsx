import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, timeAgo, type Account, type Message, type RagHit, type Task } from '../api';
import { Tag, Term, useToast } from '../ui';

type Detail = {
  message: Message;
  account: Account;
  client: { id: number; name: string; color: string } | null;
  rag: { scope: string | null; results: RagHit[] };
};

export default function MessageView({ refreshStats }: { refreshStats: () => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState('');
  const [instructions, setInstructions] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHtml, setShowHtml] = useState(true);

  const load = useCallback(() => {
    api.get<Detail>(`/messages/${id}`).then(setDetail).catch((e) => toast(String(e), 'Erreur'));
  }, [id, toast]);
  useEffect(load, [load]);

  if (!detail) return <div className="page loading">Chargement…</div>;
  const { message: m, account, client, rag } = detail;
  const task: Task | null = m.task_json ? JSON.parse(m.task_json) : null;

  async function toggleNoise() {
    setBusy(true);
    try {
      await api.post(`/messages/${m.id}/noise`, { noise: m.is_noise === 0 });
      toast(
        m.is_noise === 0
          ? `Marqué bruit — les prochains mails de ${m.from_email} seront filtrés.`
          : `Restauré — ${m.from_email} ne sera plus filtré.`,
        'Triage'
      );
      load();
      refreshStats();
    } catch (err) { toast(String(err), 'Erreur'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Supprimer ce mail ?')) return;
    setBusy(true);
    try {
      await api.post('/messages/bulk', { ids: [m.id], action: 'delete' });
      toast('Mail supprimé.', 'Corbeille');
      refreshStats();
      navigate(-1);
    } catch (err) { toast(String(err), 'Erreur'); setBusy(false); }
  }

  async function createClickup() {
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/messages/${m.id}/task`);
      toast('Tâche créée dans ClickUp.', 'ClickUp');
      load();
      window.open(r.url, '_blank');
    } catch (err) { toast(String(err), 'ClickUp'); } finally { setBusy(false); }
  }

  async function generateDraft() {
    setDrafting(true);
    try {
      const r = await api.post<{ draft: string; contextUsed: number }>(`/messages/${m.id}/draft`, { instructions });
      setDraft(r.draft);
      toast(`Brouillon généré avec ${r.contextUsed} extraits de contexte.`, 'IA');
    } catch (err) { toast(String(err), 'IA'); } finally { setDrafting(false); }
  }

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api.post(`/messages/${m.id}/send`, { text: draft });
      toast(`Réponse envoyée à ${m.from_email}.`, 'Envoyé');
      setDraft('');
    } catch (err) { toast(String(err), 'Envoi'); } finally { setSending(false); }
  }

  async function reclassify() {
    setBusy(true);
    try {
      await api.post(`/messages/${m.id}/classify`);
      toast('Triage relancé.', 'IA');
      load();
      refreshStats();
    } catch (err) { toast(String(err), 'Erreur'); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <button className="btn-ghost btn btn-small" onClick={() => navigate(-1)}>← Retour</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 28, alignItems: 'start' }}>
        {/* ── colonne mail ── */}
        <div>
          <div className="card" style={{ padding: '30px 34px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="chip" style={{ cursor: 'default' }}>
                <span className="dot" style={{ background: account.color }} />
                {account.name}
              </span>
              {client && (
                <span className="chip" style={{ cursor: 'default' }}>
                  <span className="dot" style={{ background: client.color }} />
                  {client.name}
                </span>
              )}
              {m.is_noise === 1 && <span className="chip" style={{ cursor: 'default', borderColor: 'var(--a1)' }}>bruit — {m.noise_reason}</span>}
            </div>
            <h1 style={{ fontWeight: 400, fontSize: 26, lineHeight: 1.2, letterSpacing: '-.01em', marginBottom: 14 }}>
              {m.subject}
            </h1>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', color: 'var(--gray-dark)', fontSize: 13.5, paddingBottom: 18, borderBottom: '1px solid var(--border-soft)', marginBottom: 22 }}>
              <span><strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{m.from_name || m.from_email}</strong> &lt;{m.from_email}&gt;</span>
              <span>{fmtDate(m.date)}</span>
            </div>
            {m.body_html && showHtml ? (
              <div className="mail-body-html" dangerouslySetInnerHTML={{ __html: m.body_html }} />
            ) : (
              <div className="mail-body">{m.body_text}</div>
            )}
            {m.body_html && (
              <button className="tag" style={{ marginTop: 18, cursor: 'pointer', border: 'none', background: 'none' }} onClick={() => setShowHtml(!showHtml)}>
                {showHtml ? 'voir en texte brut' : 'voir en html'}
              </button>
            )}
          </div>

          {/* actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" onClick={toggleNoise} disabled={busy}>
              {m.is_noise === 1 ? 'Restaurer en mail normal' : 'Marquer comme bruit'}
            </button>
            <button className="btn-ghost btn" onClick={reclassify} disabled={busy}>Re-trier</button>
            <button className="btn-danger btn" onClick={remove} disabled={busy}>Supprimer</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--gray)' }}>
            Triage : {m.noise_source === 'ai' ? 'IA' : m.noise_source === 'rule' ? 'règle apprise' : m.noise_source === 'user' ? 'vous' : 'heuristique'}
            {m.noise_reason ? ` — ${m.noise_reason}` : ''} (score {Math.round((m.noise_score || 0) * 100)} %)
          </div>

          {/* réponse */}
          {m.is_noise === 0 && (
            <div className="card" style={{ padding: '26px 30px', marginTop: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <Tag>Répondre</Tag>
                <span style={{ fontSize: 12.5, color: 'var(--gray)' }}>
                  brouillon nourri par la base <Term c="var(--a3)">{rag.scope || '—'}</Term>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <input
                  style={{ flex: '1 1 240px' }}
                  placeholder="Consigne (ex : accepte, propose mardi 14h, ton chaleureux)…"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
                <button className="btn" onClick={generateDraft} disabled={drafting}>
                  {drafting ? 'Rédaction…' : 'Brouillon IA'}
                </button>
              </div>
              <textarea
                style={{ width: '100%', minHeight: 180, marginTop: 14, lineHeight: 1.6 }}
                placeholder="Votre réponse…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={send} disabled={sending || !draft.trim()}>
                  {sending ? 'Envoi…' : `Envoyer à ${m.from_email}`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── colonne contexte ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* tâche détectée */}
          {task && (
            <div className="card-black" style={{ padding: '22px 24px' }}>
              <div className="aurora-glow" style={{ width: 180, height: 180, top: -90, right: -60, opacity: 0.5 }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <Tag>Tâche détectée</Tag>
                <div style={{ fontWeight: 600, fontSize: 15.5, marginTop: 10, lineHeight: 1.35 }}>{task.title}</div>
                {task.details && <div style={{ fontSize: 13.5, color: 'var(--gray-onblack)', marginTop: 8, lineHeight: 1.5 }}>{task.details}</div>}
                {task.due && <div style={{ fontSize: 13, marginTop: 10, color: 'var(--a1)' }}>Échéance : {new Date(task.due).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</div>}
                <div style={{ marginTop: 16 }}>
                  {m.clickup_url ? (
                    <a href={m.clickup_url} target="_blank" rel="noreferrer" className="btn btn-small" style={{ background: 'var(--offwhite)', color: 'var(--ink)' }}>
                      Voir dans ClickUp ↗
                    </a>
                  ) : (
                    <button className="btn btn-small" style={{ background: 'var(--offwhite)', color: 'var(--ink)' }} onClick={createClickup} disabled={busy}>
                      Créer dans ClickUp
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* contexte RAG */}
          <div className="card" style={{ padding: '22px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Tag>Contexte</Tag>
              <span className="tag" style={{ fontSize: 10.5 }}>{rag.scope || 'aucune base'}</span>
            </div>
            {rag.results.length === 0 ? (
              <div style={{ fontSize: 13.5, color: 'var(--gray)', marginTop: 12, lineHeight: 1.5 }}>
                Pas encore d'historique indexé pour ce contexte.
                {account.rag_enabled ? '' : ' Cette boîte ne fait pas partie de la base RAG (activable dans les réglages).'}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {rag.results.map((hit) => (
                  <Link
                    key={hit.message_id}
                    to={`/message/${hit.message_id}`}
                    style={{ display: 'block', padding: '12px 0', borderBottom: '1px solid var(--border-soft)' }}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{hit.subject}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 3 }}>
                      {hit.from_name || hit.from_email} — {timeAgo(hit.date)}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--gray-dark)', marginTop: 5, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {hit.chunk_text.split('\n').slice(2).join(' ')}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
