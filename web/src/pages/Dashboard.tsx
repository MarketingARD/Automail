import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, timeAgo, type Stats } from '../api';
import { Dot, Tag, useToast } from '../ui';

export default function Dashboard({ stats, refresh }: { stats: Stats | null; refresh: () => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [sweeping, setSweeping] = useState(false);

  if (!stats) return <div className="page loading">Chargement…</div>;

  const { totals, accounts } = stats;
  const clean = totals.noise_total === 0;

  async function sweepAll() {
    if (!stats || totals.noise_total === 0) return;
    if (!confirm(`Supprimer les ${totals.noise_total} mails classés bruit, sur toutes les boîtes ?`)) return;
    setSweeping(true);
    try {
      const r = await api.post<{ deleted: number; remoteErrors: string[] }>('/messages/sweep');
      toast(`${r.deleted} mails balayés. Boîtes propres.`, 'Balayage');
      if (r.remoteErrors?.length) toast(r.remoteErrors.join(' — '), 'Avertissement IMAP');
      refresh();
    } catch (err) {
      toast(String(err), 'Erreur');
    } finally {
      setSweeping(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <Tag>Aujourd'hui</Tag>
        <h1>
          {totals.focus_unread === 0
            ? <>Rien ne demande votre attention<Dot c="var(--a1)" /></>
            : <>{totals.focus_unread} {totals.focus_unread > 1 ? 'mails demandent' : 'mail demande'} votre attention<Dot /></>}
        </h1>
      </div>

      {/* ── Hero noir : l'état du bruit ── */}
      <div className="card-black" style={{ padding: '38px 42px', marginBottom: 28 }}>
        <div className="aurora-glow" style={{ width: 460, height: 460, top: -220, right: -140 }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 40 }}>
          <div style={{ flex: '1 1 260px' }}>
            <Tag>{clean ? 'Tout est propre' : 'Bruit accumulé'}</Tag>
            <div className="stat-num" style={{ fontSize: 84, marginTop: 14, color: 'var(--offwhite)' }}>
              {totals.noise_total}
            </div>
            <div style={{ color: 'var(--gray-onblack)', fontSize: 14, marginTop: 8 }}>
              {clean
                ? `mails à balayer — ${stats.sweptToday} déjà supprimés aujourd'hui`
                : 'newsletters, promos et notifications interceptées'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {!clean && (
              <button className="btn" style={{ background: 'var(--offwhite)', color: 'var(--ink)' }} onClick={sweepAll} disabled={sweeping}>
                {sweeping ? 'Balayage…' : `Balayer tout le bruit (${totals.noise_total})`}
              </button>
            )}
            <Link to="/inbox?status=noise" className="btn-ghost btn" style={{ color: 'var(--offwhite)', borderColor: 'var(--gray-dark)' }}>
              Vérifier avant
            </Link>
          </div>
        </div>
      </div>

      {/* ── Trois compteurs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 28 }}>
        <button className="card" style={{ padding: '26px 28px', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/inbox')}>
          <Tag>À traiter</Tag>
          <div className="stat-num" style={{ fontSize: 46, marginTop: 12 }}>{totals.focus_unread}</div>
          <div style={{ color: 'var(--gray-dark)', fontSize: 13.5, marginTop: 6 }}>non lus dans le focus</div>
        </button>
        <button className="card" style={{ padding: '26px 28px', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/inbox?tasks=1')}>
          <Tag>Tâches détectées</Tag>
          <div className="stat-num" style={{ fontSize: 46, marginTop: 12 }}>{totals.tasks_pending}</div>
          <div style={{ color: 'var(--gray-dark)', fontSize: 13.5, marginTop: 6 }}>
            à envoyer vers ClickUp — {totals.tasks_created} déjà créées
          </div>
        </button>
        <button className="card" style={{ padding: '26px 28px', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/clients')}>
          <Tag>Base de connaissance</Tag>
          <div className="stat-num" style={{ fontSize: 46, marginTop: 12 }}>{stats.ragUnique}</div>
          <div style={{ color: 'var(--gray-dark)', fontSize: 13.5, marginTop: 6 }}>
            mails indexés dans {stats.rag.length} base{stats.rag.length > 1 ? 's' : ''} RAG
          </div>
        </button>
      </div>

      {/* ── Santé par boîte ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 28 }}>
        <Tag>Vos boîtes</Tag>
        <div>
          {accounts.map((a) => {
            const noisePct = a.total ? Math.round(((a.noise_count || 0) / a.total) * 100) : 0;
            return (
              <div key={a.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '18px 22px', marginBottom: 10, flexWrap: 'wrap' }}>
                <span className="dot" style={{ background: a.color }} />
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.name}</div>
                  <div style={{ color: 'var(--gray)', fontSize: 13 }}>
                    {a.email} — <span className="tag" style={{ fontSize: 10.5 }}>{a.kind === 'pro' ? 'pro' : 'privé'}</span>
                    {a.rag_enabled ? <span className="tag" style={{ fontSize: 10.5 }}> · rag</span> : null}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="stat-num" style={{ fontSize: 26 }}>{a.unread_focus}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12.5 }}> à lire</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="stat-num" style={{ fontSize: 26, color: (a.noise_count || 0) > 0 ? 'var(--ink)' : 'var(--gray)' }}>{a.noise_count}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12.5 }}> bruit ({noisePct} %)</span>
                </div>
                <div style={{ color: 'var(--gray)', fontSize: 12.5, minWidth: 110, textAlign: 'right' }}>
                  {a.last_sync_error
                    ? <span style={{ color: '#b3554e' }}>sync en erreur</span>
                    : a.last_sync_at ? `sync ${timeAgo(a.last_sync_at)}` : 'jamais synchronisé'}
                </div>
              </div>
            );
          })}
          {accounts.length === 0 && (
            <div className="empty">
              Aucune boîte connectée pour l'instant.{' '}
              <Link to="/settings" style={{ fontWeight: 600 }}>Ajouter une boîte →</Link>
            </div>
          )}
        </div>
      </div>

      {(!stats.ai || !stats.clickup) && (
        <div style={{ marginTop: 36, padding: '16px 20px', border: '1px solid var(--border)', color: 'var(--gray-dark)', fontSize: 13.5 }}>
          {!stats.ai && <>Le tri fonctionne en mode heuristique. Installez Claude Code (abonnement) ou ajoutez une clé API dans les <Link to="/settings" style={{ fontWeight: 600 }}>réglages</Link> pour un triage plus fin, la détection de tâches et les brouillons de réponse. </>}
          {!stats.clickup && <>ClickUp n'est pas encore connecté.</>}
        </div>
      )}
    </div>
  );
}
