import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, timeAgo, type Account, type Message } from '../api';
import { Checkbox, Dot, Tag, useToast } from '../ui';

type Status = 'focus' | 'noise' | 'all';

export default function Inbox({ refreshStats }: { refreshStats: () => void }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const status = (params.get('status') as Status) || 'focus';
  const accountId = params.get('account') || '';
  const tasksOnly = params.get('tasks') === '1';
  const [q, setQ] = useState(params.get('q') || '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ status, limit: '300' });
    if (accountId) qs.set('accountId', accountId);
    if (q) qs.set('q', q);
    api
      .get<{ messages: Message[] }>(`/messages?${qs}`)
      .then((r) => setMessages(tasksOnly ? r.messages.filter((m) => m.task_detected) : r.messages))
      .catch((e) => toast(String(e), 'Erreur'))
      .finally(() => setLoading(false));
  }, [status, accountId, q, tasksOnly, toast]);

  useEffect(() => { load(); setSelected(new Set()); }, [load]);
  useEffect(() => {
    api.get<{ accounts: Account[] }>('/accounts').then((r) => setAccounts(r.accounts)).catch(() => {});
  }, []);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const allSelected = messages.length > 0 && selected.size === messages.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(messages.map((m) => m.id)));

  async function bulk(action: 'noise' | 'restore' | 'delete' | 'read') {
    if (!selected.size) return;
    if (action === 'delete' && !confirm(`Supprimer définitivement ${selected.size} mail(s) ?`)) return;
    setBusy(true);
    try {
      await api.post('/messages/bulk', { ids: [...selected], action });
      const labels = { noise: 'marqués bruit', restore: 'restaurés', delete: 'supprimés', read: 'marqués lus' };
      toast(`${selected.size} mails ${labels[action]}.`, 'Action groupée');
      setSelected(new Set());
      load();
      refreshStats();
    } catch (err) {
      toast(String(err), 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function sweep() {
    const scope = accountId ? messages.length : undefined;
    const label = accountId ? 'cette boîte' : 'toutes les boîtes';
    if (!confirm(`Supprimer tout le bruit de ${label} ?${scope ? ` (${scope} mails listés)` : ''}`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ deleted: number }>('/messages/sweep', accountId ? { accountId: Number(accountId) } : {});
      toast(`${r.deleted} mails balayés.`, 'Balayage');
      load();
      refreshStats();
    } catch (err) {
      toast(String(err), 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const title = useMemo(() => {
    if (tasksOnly) return <>Mails avec tâches détectées<Dot c="var(--a3)" /></>;
    if (status === 'noise') return <>Le bruit, en quarantaine<Dot c="var(--a1)" /></>;
    if (status === 'all') return <>Tout, sans filtre<Dot /></>;
    return <>L'essentiel, toutes boîtes confondues<Dot /></>;
  }, [status, tasksOnly]);

  return (
    <div className="page">
      <div className="page-head">
        <Tag>{status === 'noise' ? 'Bruit' : 'Boîte unifiée'}</Tag>
        <h1>{title}</h1>
      </div>

      {/* filtres */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <button className={`chip ${status === 'focus' && !tasksOnly ? 'on' : ''}`} onClick={() => { setFilter('tasks', ''); setFilter('status', ''); }}>Focus</button>
        <button className={`chip ${status === 'noise' ? 'on' : ''}`} onClick={() => { setFilter('tasks', ''); setFilter('status', 'noise'); }}>Bruit</button>
        <button className={`chip ${status === 'all' ? 'on' : ''}`} onClick={() => { setFilter('tasks', ''); setFilter('status', 'all'); }}>Tout</button>
        <button className={`chip ${tasksOnly ? 'on' : ''}`} onClick={() => setFilter('tasks', tasksOnly ? '' : '1')}>Tâches</button>
        <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <button className={`chip ${!accountId ? 'on' : ''}`} onClick={() => setFilter('account', '')}>Toutes les boîtes</button>
        {accounts.map((a) => (
          <button key={a.id} className={`chip ${accountId === String(a.id) ? 'on' : ''}`} onClick={() => setFilter('account', String(a.id))}>
            <span className="dot" style={{ background: a.color }} />
            {a.name}
          </button>
        ))}
        <input
          placeholder="Rechercher…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginLeft: 'auto', width: 200, padding: '6px 12px' }}
        />
      </div>

      {/* barre d'actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--ink)', color: 'var(--offwhite)', flexWrap: 'wrap' }}>
        <Checkbox on={allSelected} onChange={toggleAll} />
        {selected.size > 0 ? (
          <>
            <span style={{ fontSize: 13.5 }}>{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
            <span style={{ flex: 1 }} />
            {status !== 'noise' && <button className="btn btn-small" style={{ background: 'var(--offwhite)', color: 'var(--ink)' }} disabled={busy} onClick={() => bulk('noise')}>Marquer bruit</button>}
            {status === 'noise' && <button className="btn btn-small" style={{ background: 'var(--offwhite)', color: 'var(--ink)' }} disabled={busy} onClick={() => bulk('restore')}>Restaurer</button>}
            <button className="btn btn-small" style={{ background: 'transparent', border: '1px solid var(--gray-dark)' }} disabled={busy} onClick={() => bulk('read')}>Lu</button>
            <button className="btn btn-small" style={{ background: 'transparent', border: '1px solid var(--gray-dark)' }} disabled={busy} onClick={() => bulk('delete')}>Supprimer</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13.5, color: 'var(--gray-onblack)' }}>
              {loading ? 'Chargement…' : `${messages.length} mail${messages.length > 1 ? 's' : ''}`}
            </span>
            <span style={{ flex: 1 }} />
            {status === 'noise' && messages.length > 0 && (
              <button className="btn btn-small" style={{ background: 'var(--offwhite)', color: 'var(--ink)' }} disabled={busy} onClick={sweep}>
                Tout balayer ({messages.length})
              </button>
            )}
          </>
        )}
      </div>

      {/* liste */}
      <div style={{ border: '1px solid var(--border-soft)', borderTop: 'none' }}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`mail-row ${m.is_read ? '' : 'unread'} ${selected.has(m.id) ? 'selected' : ''}`}
            onClick={() => navigate(`/message/${m.id}`)}
          >
            <Checkbox
              on={selected.has(m.id)}
              onChange={(v) => {
                const next = new Set(selected);
                if (v) next.add(m.id); else next.delete(m.id);
                setSelected(next);
              }}
            />
            <div className="mail-from" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="dot" style={{ background: m.account_color || 'var(--gray)' }} title={m.account_name} />
              <span>{m.from_name || m.from_email}</span>
            </div>
            <div className="mail-subject">
              {m.subject} <span className="mail-snippet">— {m.snippet}</span>
            </div>
            <div className="mail-meta">
              {m.task_detected === 1 && (
                <span title={m.clickup_task_id ? 'Tâche ClickUp créée' : 'Tâche détectée'} style={{ color: m.clickup_task_id ? 'var(--gray)' : 'var(--a3)', fontSize: 14 }}>
                  {m.clickup_task_id ? '✓⚑' : '⚑'}
                </span>
              )}
              {m.client_name && <span style={{ color: 'var(--gray-dark)' }}>{m.client_name}</span>}
              {status !== 'focus' && m.is_noise === 1 && <span className="tag" style={{ fontSize: 10.5 }}>bruit</span>}
              <span>{timeAgo(m.date)}</span>
            </div>
          </div>
        ))}
        {!loading && messages.length === 0 && (
          <div className="empty">
            {status === 'noise' ? 'Aucun bruit en attente. Boîtes propres ✓' : 'Rien ici.'}
          </div>
        )}
      </div>
    </div>
  );
}
