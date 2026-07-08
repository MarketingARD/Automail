import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, type Account } from '../api';
import { Dot, Tag, Toggle, useToast } from '../ui';

const COLORS = ['#F6A98C', '#E289BC', '#7B68D8'];

type SettingsData = {
  anthropic_key: string; classify_model: string; draft_model: string; ai_triage: string;
  clickup_token: string; clickup_list_id: string; clickup_list_name: string; user_name: string;
  env_anthropic: boolean; env_clickup: boolean;
};
type Rule = { id: number; pattern: string; action: string; hits: number };
type CuList = { id: string; name: string };
type CuTeam = { id: string; name: string; spaces: { id: string; name: string; lists: CuList[] }[] };

export default function Settings({ refreshStats }: { refreshStats: () => void }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Partial<Account & { imap_pass: string; smtp_pass: string }> | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [teams, setTeams] = useState<CuTeam[] | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  const load = useCallback(() => {
    api.get<{ accounts: Account[] }>('/accounts').then((r) => setAccounts(r.accounts)).catch(() => {});
    api.get<{ settings: SettingsData }>('/settings').then((r) => setSettings(r.settings)).catch(() => {});
    api.get<{ rules: Rule[] }>('/rules').then((r) => setRules(r.rules)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function saveAccount() {
    if (!editing?.name || !editing?.email) { toast('Nom et adresse requis.', 'Comptes'); return; }
    try {
      if (editing.id) await api.put(`/accounts/${editing.id}`, editing);
      else await api.post('/accounts', editing);
      toast(`Boîte « ${editing.name} » enregistrée.`, 'Comptes');
      setEditing(null);
      load();
      refreshStats();
    } catch (err) { toast(String(err), 'Erreur'); }
  }

  async function removeAccount(a: Account) {
    if (!confirm(`Supprimer la boîte « ${a.name} » et tous ses mails locaux ?`)) return;
    await api.del(`/accounts/${a.id}`);
    load();
    refreshStats();
  }

  async function syncNow(a: Account) {
    setSyncing(a.id);
    try {
      const r = await api.post<{ added: number }>(`/accounts/${a.id}/sync`);
      toast(`${a.name} : ${r.added} nouveau(x) mail(s).`, 'Synchronisation');
      load();
      refreshStats();
    } catch (err) { toast(String(err), 'Synchronisation'); } finally { setSyncing(null); }
  }

  async function toggleRag(a: Account, on: boolean) {
    await api.put(`/accounts/${a.id}`, { rag_enabled: on });
    toast(on ? `${a.name} alimente désormais la base RAG ${a.kind === 'pro' ? 'pro' : 'privée'} (réindexation en cours).` : `${a.name} retirée de la base RAG.`, 'RAG');
    load();
  }

  async function saveSettings(partial: Partial<SettingsData>) {
    await api.put('/settings', partial);
    toast('Réglages enregistrés.', 'Réglages');
    load();
    refreshStats();
  }

  async function loadClickupLists() {
    setLoadingLists(true);
    try {
      const r = await api.get<{ teams: CuTeam[] }>('/clickup/hierarchy');
      setTeams(r.teams);
    } catch (err) { toast(String(err), 'ClickUp'); } finally { setLoadingLists(false); }
  }

  if (!settings) return <div className="page loading">Chargement…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <Tag>Réglages</Tag>
        <h1>Boîtes, intelligence, intégrations<Dot /></h1>
      </div>

      {/* ── Comptes ── */}
      <Section label="01 — Boîtes mail">
        {accounts.map((a) => (
          <div key={a.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="dot" style={{ background: a.color }} />
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.name} <span className="tag" style={{ fontSize: 10.5 }}>{a.kind === 'pro' ? 'pro' : 'privé'}</span></div>
              <div style={{ color: 'var(--gray)', fontSize: 13 }}>
                {a.email}
                {a.imap_host ? ` — ${a.imap_host}` : ' — IMAP non configuré'}
                {a.last_sync_error && <span style={{ color: '#b3554e' }}> — {a.last_sync_error}</span>}
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--gray-dark)' }}>
              base RAG
              <Toggle on={Boolean(a.rag_enabled)} onChange={(v) => toggleRag(a, v)} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost btn btn-small" disabled={!a.imap_host || syncing === a.id} onClick={() => syncNow(a)}>
                {syncing === a.id ? 'Sync…' : a.last_sync_at ? `Sync (${timeAgo(a.last_sync_at)})` : 'Synchroniser'}
              </button>
              <button className="btn-ghost btn btn-small" onClick={() => setEditing({ ...a, imap_pass: '', smtp_pass: '' })}>Modifier</button>
              <button className="btn-danger btn btn-small" onClick={() => removeAccount(a)}>Suppr.</button>
            </div>
          </div>
        ))}
        <button className="btn" style={{ marginTop: 6 }} onClick={() => setEditing({ kind: 'pro', color: COLORS[accounts.length % 3], imap_port: 993, smtp_port: 465, rag_enabled: 1 })}>
          + Connecter une boîte
        </button>
      </Section>

      {/* ── IA ── */}
      <Section label="02 — Intelligence">
        <div className="card" style={{ padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <div className="field">
              <label>Clé API Anthropic {settings.env_anthropic && <em>(déjà fournie via .env)</em>}</label>
              <input
                type="password"
                placeholder="sk-ant-…"
                defaultValue={settings.anthropic_key}
                onBlur={(e) => e.target.value !== settings.anthropic_key && saveSettings({ anthropic_key: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Votre nom (signature des brouillons)</label>
              <input
                defaultValue={settings.user_name}
                placeholder="Alex"
                onBlur={(e) => e.target.value !== settings.user_name && saveSettings({ user_name: e.target.value })}
              />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, fontSize: 14 }}>
            <Toggle on={settings.ai_triage !== '0'} onChange={(v) => saveSettings({ ai_triage: v ? '1' : '0' })} />
            Triage IA des nouveaux mails (sinon : heuristiques locales uniquement)
          </label>
          <p style={{ fontSize: 13, color: 'var(--gray-dark)', marginTop: 14, lineHeight: 1.55, maxWidth: 640 }}>
            Sans clé, Automail filtre avec des règles locales (désabonnement, no-reply, plateformes marketing…)
            et apprend de chacune de vos corrections. Avec une clé, chaque mail est trié finement,
            les tâches sont détectées et les brouillons s'appuient sur la base RAG.
          </p>
        </div>
      </Section>

      {/* ── ClickUp ── */}
      <Section label="03 — ClickUp">
        <div className="card" style={{ padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <div className="field">
              <label>Jeton personnel {settings.env_clickup && <em>(déjà fourni via .env)</em>}</label>
              <input
                type="password"
                placeholder="pk_…"
                defaultValue={settings.clickup_token}
                onBlur={(e) => e.target.value !== settings.clickup_token && saveSettings({ clickup_token: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Liste de destination des tâches</label>
              {teams ? (
                <select
                  value={settings.clickup_list_id}
                  onChange={(e) => {
                    const name = teams.flatMap((t) => t.spaces).flatMap((s) => s.lists).find((l) => l.id === e.target.value)?.name || '';
                    saveSettings({ clickup_list_id: e.target.value, clickup_list_name: name });
                  }}
                >
                  <option value="">— choisir —</option>
                  {teams.map((t) =>
                    t.spaces.map((s) => (
                      <optgroup key={s.id} label={`${t.name} / ${s.name}`}>
                        {s.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </optgroup>
                    ))
                  )}
                </select>
              ) : (
                <button className="btn-ghost btn" onClick={loadClickupLists} disabled={loadingLists}>
                  {loadingLists ? 'Chargement…' : settings.clickup_list_name ? `${settings.clickup_list_name} — changer` : 'Charger mes listes ClickUp'}
                </button>
              )}
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--gray-dark)', marginTop: 14, lineHeight: 1.55 }}>
            Quand une tâche est détectée dans un mail, un clic la crée dans cette liste avec le contexte et l'échéance.
          </p>
        </div>
      </Section>

      {/* ── Règles apprises ── */}
      <Section label="04 — Règles apprises">
        {rules.length === 0 ? (
          <div className="empty">Aucune règle pour l'instant. Chaque fois que vous corrigez le triage, Automail retient l'expéditeur.</div>
        ) : (
          <div className="card">
            {rules.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 18px', borderBottom: '1px solid var(--border-soft)', fontSize: 13.5 }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{r.pattern}</span>
                <span className="tag" style={{ fontSize: 10.5 }}>{r.action === 'noise' ? 'toujours bruit' : 'toujours garder'}</span>
                <span style={{ color: 'var(--gray)', fontSize: 12.5 }}>{r.hits}×</span>
                <button className="btn-danger btn btn-small" onClick={async () => { await api.del(`/rules/${r.id}`); load(); }}>Oublier</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Éditeur de compte ── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,2,2,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, overflowY: 'auto' }} onClick={() => setEditing(null)}>
          <div className="card" style={{ width: 560, maxWidth: '94vw', padding: '30px 34px', background: 'var(--paper)', margin: '30px 0' }} onClick={(e) => e.stopPropagation()}>
            <Tag>{editing.id ? 'Modifier la boîte' : 'Connecter une boîte'}</Tag>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
              <div className="field">
                <label>Nom</label>
                <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="ARD Studio" />
              </div>
              <div className="field">
                <label>Adresse email</label>
                <input value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="vous@studio.eu" />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={editing.kind || 'pro'} onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'pro' | 'private' })}>
                  <option value="pro">Pro</option>
                  <option value="private">Privé</option>
                </select>
              </div>
              <div className="field">
                <label>Couleur</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 38 }}>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setEditing({ ...editing, color: c })} style={{ width: 26, height: 26, background: c, border: editing.color === c ? '2px solid var(--ink)' : '1px solid var(--border)' }} />
                  ))}
                </div>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Toggle on={Boolean(editing.rag_enabled)} onChange={(v) => setEditing({ ...editing, rag_enabled: v ? 1 : 0 })} />
                  Cette boîte alimente la base RAG ({(editing.kind || 'pro') === 'pro' ? 'pro + par client' : 'privée'})
                </label>
              </div>
              <div style={{ gridColumn: '1 / -1' }}><hr className="hr" /><div className="tag" style={{ marginTop: 10 }}>Réception — IMAP</div></div>
              <div className="field">
                <label>Serveur IMAP</label>
                <input value={editing.imap_host || ''} onChange={(e) => setEditing({ ...editing, imap_host: e.target.value })} placeholder="imap.gmail.com" />
              </div>
              <div className="field">
                <label>Port</label>
                <input type="number" value={editing.imap_port ?? 993} onChange={(e) => setEditing({ ...editing, imap_port: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Identifiant (si différent de l'adresse)</label>
                <input value={editing.imap_user || ''} onChange={(e) => setEditing({ ...editing, imap_user: e.target.value })} />
              </div>
              <div className="field">
                <label>Mot de passe / mot de passe d'application</label>
                <input type="password" value={editing.imap_pass || ''} onChange={(e) => setEditing({ ...editing, imap_pass: e.target.value })} placeholder={editing.has_imap_pass ? '•••••• (inchangé)' : ''} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}><hr className="hr" /><div className="tag" style={{ marginTop: 10 }}>Envoi — SMTP</div></div>
              <div className="field">
                <label>Serveur SMTP</label>
                <input value={editing.smtp_host || ''} onChange={(e) => setEditing({ ...editing, smtp_host: e.target.value })} placeholder="smtp.gmail.com" />
              </div>
              <div className="field">
                <label>Port</label>
                <input type="number" value={editing.smtp_port ?? 465} onChange={(e) => setEditing({ ...editing, smtp_port: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Identifiant (optionnel)</label>
                <input value={editing.smtp_user || ''} onChange={(e) => setEditing({ ...editing, smtp_user: e.target.value })} />
              </div>
              <div className="field">
                <label>Mot de passe (optionnel — sinon IMAP)</label>
                <input type="password" value={editing.smtp_pass || ''} onChange={(e) => setEditing({ ...editing, smtp_pass: e.target.value })} placeholder={editing.has_smtp_pass ? '•••••• (inchangé)' : ''} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
              <button className="btn-ghost btn" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn" onClick={saveAccount}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 28, marginBottom: 40 }}>
      <Tag>{label}</Tag>
      <div>{children}</div>
    </div>
  );
}
