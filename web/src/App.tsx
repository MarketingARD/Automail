import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, type Stats } from './api';
import { Mark, ToastProvider } from './ui';
import Dashboard from './pages/Dashboard';
import Inbox from './pages/Inbox';
import MessageView from './pages/Message';
import Clients from './pages/Clients';
import Settings from './pages/Settings';

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);

  const refresh = useCallback(() => {
    api.get<Stats>('/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="aurora-glow" style={{ width: 220, height: 220, top: -130, right: -110, opacity: 0.5 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '26px 24px 30px', position: 'relative', zIndex: 1 }}>
            <Mark size={30} />
            <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.1, letterSpacing: '.01em' }}>
              auto<br />mail
            </div>
          </div>
          <nav>
            <div className="tag" style={{ padding: '0 24px 10px', color: 'var(--gray-onblack)' }}>Trier</div>
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span>Aujourd'hui</span>
              {stats && stats.totals.focus_unread > 0 && <span className="count">{stats.totals.focus_unread}</span>}
            </NavLink>
            <NavLink to="/inbox" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span>Boîte unifiée</span>
              {stats && <span className="count">{stats.totals.focus_total}</span>}
            </NavLink>
            <NavLink to="/inbox?status=noise" className={() => `nav-link ${location.pathname === '/inbox' && location.search.includes('noise') ? 'active' : ''}`}>
              <span>Bruit</span>
              {stats && stats.totals.noise_total > 0 && <span className="count">{stats.totals.noise_total}</span>}
            </NavLink>
            <div className="tag" style={{ padding: '26px 24px 10px', color: 'var(--gray-onblack)' }}>Connaissance</div>
            <NavLink to="/clients" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span>Clients & RAG</span>
            </NavLink>
            <div style={{ flex: 1 }} />
            <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} style={{ paddingBottom: 26 }}>
              <span>Réglages</span>
            </NavLink>
          </nav>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard stats={stats} refresh={refresh} />} />
            <Route path="/inbox" element={<Inbox refreshStats={refresh} />} />
            <Route path="/message/:id" element={<MessageView refreshStats={refresh} />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/settings" element={<Settings refreshStats={refresh} />} />
          </Routes>
        </main>
      </div>
    </ToastProvider>
  );
}
