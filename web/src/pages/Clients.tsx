import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, type Client, type RagHit } from '../api';
import { Dot, Tag, useToast } from '../ui';

const COLORS = ['#F6A98C', '#E289BC', '#7B68D8'];

type RagStat = { scope: string; chunks: number; messages: number };

export default function Clients() {
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [ragStats, setRagStats] = useState<RagStat[]>([]);
  const [editing, setEditing] = useState<Partial<Client> | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('pro');
  const [hits, setHits] = useState<RagHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => {
    api.get<{ clients: Client[] }>('/clients').then((r) => setClients(r.clients)).catch(() => {});
    api.get<{ stats: RagStat[] }>('/rag/stats').then((r) => setRagStats(r.stats)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const statFor = (s: string) => ragStats.find((r) => r.scope === s);

  async function save() {
    if (!editing?.name) return;
    const domains = String(editing.domains || '')
      .split(/[\n,;]/).map((d) => d.trim()).filter(Boolean);
    try {
      if (editing.id) await api.put(`/clients/${editing.id}`, { ...editing, domains });
      else await api.post('/clients', { ...editing, domains });
      toast(`Client « ${editing.name} » enregistré — les mails correspondants sont rattachés.`, 'Clients');
      setEditing(null);
      load();
    } catch (err) { toast(String(err), 'Erreur'); }
  }

  async function remove(c: Client) {
    if (!confirm(`Supprimer « ${c.name} » et sa base RAG ?`)) return;
    try {
      await api.del(`/clients/${c.id}`);
      load();
    } catch (err) { toast(String(err), 'Erreur'); }
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await api.get<{ results: RagHit[] }>(`/rag/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}`);
      setHits(r.results);
    } catch (err) { toast(String(err), 'Recherche'); } finally { setSearching(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <Tag>Clients & RAG</Tag>
        <h1>La mémoire de chaque relation<Dot c="var(--a3)" /></h1>
      </div>

      {/* bases globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        {[
          { scope: 'pro', label: 'Base pro', desc: 'toutes les boîtes pro opt-in' },
          { scope: 'private', label: 'Base privée', desc: 'vos boîtes personnelles opt-in' },
        ].map(({ scope: s, label, desc }) => {
          const st = statFor(s);
          return (
            <div key={s} className="card-black" style={{ padding: '24px 26px' }}>
              <div className="aurora-glow" style={{ width: 160, height: 160, top: -80, right: -50, opacity: 0.45 }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <Tag>{label}</Tag>
                <div className="stat-num" style={{ fontSize: 40, marginTop: 10 }}>{st?.messages ?? 0}</div>
                <div style={{ fontSize: 13, color: 'var(--gray-onblack)', marginTop: 6 }}>mails indexés — {desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* clients */}
      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 28, marginBottom: 40 }}>
        <div>
          <Tag>Par client</Tag>
          <button className="btn btn-small" style={{ marginTop: 14 }} onClick={() => setEditing({ color: COLORS[clients.length % 3] })}>
            + Nouveau client
          </button>
        </div>
        <div>
          {clients.map((c) => {
            const st = statFor(`client:${c.id}`);
            let domains: string[] = [];
            try { domains = JSON.parse(c.domains); } catch { /* ignore */ }
            return (
              <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '18px 22px', marginBottom: 10, flexWrap: 'wrap' }}>
                <span className="dot" style={{ background: c.color }} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.name}</div>
                  <div style={{ color: 'var(--gray)', fontSize: 13 }}>{domains.join(' · ') || 'aucun domaine'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="stat-num" style={{ fontSize: 24 }}>{st?.messages ?? 0}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12.5 }}> indexés</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="stat-num" style={{ fontSize: 24 }}>{c.message_count ?? 0}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12.5 }}> mails</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost btn btn-small" onClick={() => setEditing({ ...c, domains: domains.join(', ') as unknown as string })}>Modifier</button>
                  <button className="btn-danger btn btn-small" onClick={() => remove(c)}>Suppr.</button>
                </div>
              </div>
            );
          })}
          {clients.length === 0 && (
            <div className="empty">Aucun client défini. Créez-en un avec ses domaines : ses mails alimenteront sa propre base RAG.</div>
          )}
        </div>
      </div>

      {/* recherche dans la mémoire */}
      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 28 }}>
        <Tag>Interroger</Tag>
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 190 }}>
              <option value="pro">Base pro</option>
              <option value="private">Base privée</option>
              {clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
            </select>
            <input
              style={{ flex: '1 1 240px' }}
              placeholder="Ex : budget refonte, deadline salon, contrat cadre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <button className="btn" onClick={search} disabled={searching}>{searching ? 'Recherche…' : 'Chercher'}</button>
          </div>
          {hits && (
            <div style={{ marginTop: 18 }}>
              {hits.length === 0 && <div className="empty">Aucun résultat dans cette base.</div>}
              {hits.map((h) => (
                <a key={h.message_id} href={`/message/${h.message_id}`} className="card" style={{ display: 'block', padding: '16px 20px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{h.subject}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--gray)' }}>
                      {h.from_name || h.from_email} — {timeAgo(h.date)} — pertinence {(h.score * 100).toFixed(0)} %
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--gray-dark)', marginTop: 6, lineHeight: 1.5 }}>
                    {h.chunk_text.split('\n').slice(2).join(' ').slice(0, 260)}…
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* éditeur client */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,2,2,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setEditing(null)}>
          <div className="card" style={{ width: 480, maxWidth: '92vw', padding: '30px 34px', background: 'var(--paper)' }} onClick={(e) => e.stopPropagation()}>
            <Tag>{editing.id ? 'Modifier le client' : 'Nouveau client'}</Tag>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
              <div className="field">
                <label>Nom</label>
                <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Maison Lumière" />
              </div>
              <div className="field">
                <label>Domaines et adresses (séparés par des virgules) — tout mail correspondant rejoint sa base RAG</label>
                <textarea rows={2} value={String(editing.domains || '')} onChange={(e) => setEditing({ ...editing, domains: e.target.value })} placeholder="maisonlumiere.fr, claire@perso.com" />
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows={2} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </div>
              <div className="field">
                <label>Couleur</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setEditing({ ...editing, color: c })} style={{ width: 26, height: 26, background: c, border: editing.color === c ? '2px solid var(--ink)' : '1px solid var(--border)' }} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                <button className="btn-ghost btn" onClick={() => setEditing(null)}>Annuler</button>
                <button className="btn" onClick={save}>Enregistrer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
