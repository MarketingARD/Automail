import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, type Account, type Provider, type ProviderPreset } from '../api';
import { Dot, Tag, Toggle, useToast } from '../ui';

const COLORS = ['#F6A98C', '#E289BC', '#7B68D8'];

type SettingsData = {
  ai_triage: string;
  clickup_token: string; clickup_list_id: string; clickup_list_name: string; user_name: string;
  env_clickup: boolean;
};
type Rule = { id: number; pattern: string; action: string; hits: number };
type CuList = { id: string; name: string };
type CuTeam = { id: string; name: string; spaces: { id: string; name: string; lists: CuList[] }[] };
type ProviderDraft = Partial<Provider> & { api_key?: string; preset?: string };

export default function Settings({ refreshStats }: { refreshStats: () => void }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Partial<Account & { imap_pass: string; smtp_pass: string }> | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [teams, setTeams] = useState<CuTeam[] | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [chain, setChain] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [claudeCli, setClaudeCli] = useState<{ ok: boolean; info: string }>({ ok: false, info: '' });
  const [editingProvider, setEditingProvider] = useState<ProviderDraft | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const loadProviders = useCallback((reprobe = false) => {
    api.get<{ providers: Provider[]; presets: ProviderPreset[]; claude_cli: { ok: boolean; info: string } }>(
      `/providers${reprobe ? '?reprobe=1' : ''}`
    ).then((r) => { setChain(r.providers); setPresets(r.presets); setClaudeCli(r.claude_cli); }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.get<{ accounts: Account[] }>('/accounts').then((r) => setAccounts(r.accounts)).catch(() => {});
    api.get<{ settings: SettingsData }>('/settings').then((r) => setSettings(r.settings)).catch(() => {});
    api.get<{ rules: Rule[] }>('/rules').then((r) => setRules(r.rules)).catch(() => {});
    loadProviders();
  }, [loadProviders]);
  useEffect(load, [load]);

  const KIND_LABEL: Record<string, string> = {
    claude_subscription: 'Abonnement Claude', anthropic: 'Anthropic · clé API', openai: 'API compatible OpenAI',
  };

  function statusBadge(p: Provider) {
    if (!p.enabled) return { text: 'désactivé', color: 'var(--gray)' };
    if (p.kind === 'claude_subscription' && !claudeCli.ok) return { text: 'Claude Code introuvable', color: '#b3554e' };
    if (p.kind !== 'claude_subscription' && !p.has_key) return { text: 'clé manquante', color: '#b3554e' };
    if (p.cooldown_until) {
      const until = new Date(p.cooldown_until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const label = p.last_status === 'quota' ? 'quota épuisé' : p.last_status === 'auth' ? 'clé refusée' : 'en pause';
      return { text: `${label} → reprise ${until}`, color: '#c88a3a' };
    }
    if (p.last_status === 'ok') return { text: 'actif ✓', color: '#4a7c59' };
    if (p.last_status === 'auth') return { text: 'clé refusée', color: '#b3554e' };
    return { text: 'prêt', color: 'var(--gray-dark)' };
  }

  async function saveProvider() {
    const d = editingProvider;
    if (!d) return;
    try {
      if (d.id) await api.put(`/providers/${d.id}`, d);
      else await api.post('/providers', d);
      toast(`Fournisseur « ${d.name} » enregistré.`, 'IA');
      setEditingProvider(null);
      loadProviders();
      refreshStats();
    } catch (err) { toast(String(err), 'Erreur'); }
  }

  async function toggleProvider(p: Provider, on: boolean) {
    await api.put(`/providers/${p.id}`, { enabled: on });
    loadProviders();
    refreshStats();
  }

  async function moveProvider(p: Provider, dir: 'up' | 'down') {
    await api.post(`/providers/${p.id}/move`, { dir });
    loadProviders();
  }

  async function deleteProvider(p: Provider) {
    if (!confirm(`Retirer « ${p.name} » de la chaîne ?`)) return;
    await api.del(`/providers/${p.id}`);
    loadProviders();
    refreshStats();
  }

  async function testProvider(p: Provider) {
    setTestingId(p.id);
    try {
      const r = await api.post<{ message: string }>(`/providers/${p.id}/test`);
      toast(`${p.name} : ${r.message}`, 'Test');
    } catch (err) { toast(`${p.name} : ${String(err)}`, 'Test'); } finally { setTestingId(null); loadProviders(); }
  }

  function addFromPreset(presetId: string) {
    const preset = presets.find((x) => x.id === presetId);
    if (!preset) return;
    setEditingProvider({
      preset: preset.id, kind: preset.kind as Provider['kind'], name: preset.label,
      base_url: preset.base_url, model: preset.model, api_key: '',
    });
  }

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

      {/* ── IA : chaîne de fournisseurs ── */}
      <Section label="02 — Intelligence">
        <p style={{ fontSize: 13.5, color: 'var(--gray-dark)', lineHeight: 1.55, maxWidth: 660, marginBottom: 18 }}>
          Automail essaie vos fournisseurs <strong style={{ fontWeight: 600 }}>de haut en bas</strong>. Dès que l'un est à
          court de quota (limite atteinte, 429) ou en erreur, il passe automatiquement au suivant, puis retombe sur les
          heuristiques locales si tout est épuisé. Réordonnez pour choisir la priorité — l'abonnement Claude en tête,
          les API gratuites en secours, par exemple.
        </p>

        {chain.map((p, i) => {
          const badge = statusBadge(p);
          return (
            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', marginBottom: 10, flexWrap: 'wrap', opacity: p.enabled ? 1 : 0.6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button className="btn-ghost btn btn-small" style={{ padding: '1px 7px', lineHeight: 1.2 }} disabled={i === 0} onClick={() => moveProvider(p, 'up')}>↑</button>
                <button className="btn-ghost btn btn-small" style={{ padding: '1px 7px', lineHeight: 1.2 }} disabled={i === chain.length - 1} onClick={() => moveProvider(p, 'down')}>↓</button>
              </div>
              <span className="stat-num" style={{ fontSize: 20, width: 22, textAlign: 'center', color: 'var(--gray)' }}>{i + 1}</span>
              <span className="dot" style={{ background: badge.color }} />
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                  {p.name} <span className="tag" style={{ fontSize: 10 }}>{KIND_LABEL[p.kind] || p.kind}</span>
                </div>
                <div style={{ color: 'var(--gray)', fontSize: 12.5 }}>
                  {p.kind === 'claude_subscription'
                    ? (claudeCli.ok ? `Claude Code ${claudeCli.info}` : 'Claude Code non installé')
                    : <>{p.model || 'modèle ?'}{p.key_from_env ? ' · clé .env' : p.has_key ? ' · clé ✓' : ' · pas de clé'}</>}
                  {' — '}<span style={{ color: badge.color }}>{badge.text}</span>
                  {p.last_error && p.cooldown_until && <span style={{ color: 'var(--gray)' }}> ({p.last_error.slice(0, 60)})</span>}
                </div>
              </div>
              <Toggle on={Boolean(p.enabled)} onChange={(v) => toggleProvider(p, v)} />
              <div style={{ display: 'flex', gap: 6 }}>
                {p.kind !== 'claude_subscription' && (
                  <button className="btn-ghost btn btn-small" disabled={testingId === p.id} onClick={() => testProvider(p)}>
                    {testingId === p.id ? 'Test…' : 'Tester'}
                  </button>
                )}
                {p.kind !== 'claude_subscription' && (
                  <button className="btn-ghost btn btn-small" onClick={() => setEditingProvider({ ...p, api_key: '' })}>Modifier</button>
                )}
                <button className="btn-danger btn btn-small" onClick={() => deleteProvider(p)}>Retirer</button>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <select defaultValue="" onChange={(e) => { if (e.target.value) { addFromPreset(e.target.value); e.target.value = ''; } }} style={{ minWidth: 260 }}>
            <option value="">+ Ajouter un fournisseur…</option>
            <optgroup label="Quota gratuit (compatible OpenAI)">
              {presets.filter((p) => p.kind === 'openai' && p.id !== 'custom').map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </optgroup>
            <optgroup label="Autres">
              {presets.filter((p) => p.kind !== 'openai' || p.id === 'custom').map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </optgroup>
          </select>
          {!chain.some((p) => p.kind === 'claude_subscription') && (
            <button className="btn-ghost btn btn-small" onClick={() => setEditingProvider({ kind: 'claude_subscription', name: 'Abonnement Claude', preset: '' })}>
              + Rajouter l'abonnement Claude
            </button>
          )}
          <button className="btn-ghost btn btn-small" onClick={() => loadProviders(true)}>↻ Rafraîchir l'état</button>
        </div>

        <div className="card" style={{ padding: '16px 20px', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <Toggle on={settings.ai_triage !== '0'} onChange={(v) => saveSettings({ ai_triage: v ? '1' : '0' })} />
              Triage IA des nouveaux mails
            </label>
            <div className="field" style={{ flex: '1 1 220px' }}>
              <label>Votre nom (signature des brouillons)</label>
              <input defaultValue={settings.user_name} placeholder="Alex"
                onBlur={(e) => e.target.value !== settings.user_name && saveSettings({ user_name: e.target.value })} />
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 12, lineHeight: 1.5 }}>
            Économie de quota : les cas évidents (désabonnement, no-reply, règles apprises) sont tranchés localement —
            seuls les mails ambigus consomment un appel au premier fournisseur disponible.
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

      {/* ── Éditeur de fournisseur IA ── */}
      {editingProvider && (() => {
        const preset = presets.find((x) => x.id === editingProvider.preset);
        const isSub = editingProvider.kind === 'claude_subscription';
        const isOpenai = editingProvider.kind === 'openai';
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,2,2,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setEditingProvider(null)}>
            <div className="card" style={{ width: 520, maxWidth: '94vw', padding: '30px 34px', background: 'var(--paper)' }} onClick={(e) => e.stopPropagation()}>
              <Tag>{editingProvider.id ? 'Modifier le fournisseur' : 'Ajouter un fournisseur'}</Tag>
              {preset?.note && (
                <p style={{ fontSize: 12.5, color: 'var(--gray-dark)', margin: '12px 0 4px', lineHeight: 1.5 }}>
                  {preset.note}{preset.signup && <> <a href={preset.signup} target="_blank" rel="noreferrer" style={{ fontWeight: 600, textDecoration: 'underline' }}>Obtenir une clé ↗</a></>}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
                <div className="field">
                  <label>Nom</label>
                  <input value={editingProvider.name || ''} onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })} />
                </div>
                {isSub && (
                  <p style={{ fontSize: 13, color: 'var(--gray-dark)', lineHeight: 1.5 }}>
                    Utilise Claude Code installé sur votre machine — aucune clé, consomme votre abonnement Claude.
                    {claudeCli.ok ? ` Détecté : ${claudeCli.info}.` : ' Non détecté actuellement.'}
                  </p>
                )}
                {isOpenai && (
                  <div className="field">
                    <label>URL de base (compatible OpenAI, sans /chat/completions)</label>
                    <input value={editingProvider.base_url || ''} placeholder="https://api.exemple.com/v1"
                      onChange={(e) => setEditingProvider({ ...editingProvider, base_url: e.target.value })} />
                  </div>
                )}
                {!isSub && (
                  <div className="field">
                    <label>Modèle {editingProvider.kind === 'anthropic' && <em>(vide = Haiku/Sonnet par défaut)</em>}</label>
                    <input value={editingProvider.model || ''} placeholder={isOpenai ? 'ex : llama-3.3-70b-versatile' : 'claude-haiku-4-5'}
                      onChange={(e) => setEditingProvider({ ...editingProvider, model: e.target.value })} />
                  </div>
                )}
                {!isSub && (
                  <div className="field">
                    <label>Clé API {editingProvider.key_from_env && <em>(actuellement fournie via .env)</em>}</label>
                    <input type="password"
                      placeholder={editingProvider.id && editingProvider.has_key ? '•••••• (inchangée)' : 'collez votre clé'}
                      value={editingProvider.api_key || ''}
                      onChange={(e) => setEditingProvider({ ...editingProvider, api_key: e.target.value })} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
                <button className="btn-ghost btn" onClick={() => setEditingProvider(null)}>Annuler</button>
                <button className="btn" onClick={saveProvider}>Enregistrer</button>
              </div>
            </div>
          </div>
        );
      })()}
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
