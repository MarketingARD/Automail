// Petits composants partagés — fidèles à la charte.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** Le logotype : cercle coupé en deux, décalé. */
export function Mark({ size = 30, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 96 96" style={{ width: size, height: size, overflow: 'visible', color, flexShrink: 0 }}>
      <defs>
        <clipPath id="cutA"><polygon points="-10,-10 63,-10 35,106 -10,106" /></clipPath>
        <clipPath id="cutB"><polygon points="67,-10 106,-10 106,106 39,106" /></clipPath>
      </defs>
      <g clipPath="url(#cutA)" transform="translate(-2.6,0.8)"><circle cx="48" cy="48" r="36" fill="currentColor" /></g>
      <g clipPath="url(#cutB)" transform="translate(2.6,-0.8)"><circle cx="48" cy="48" r="36" fill="currentColor" /></g>
    </svg>
  );
}

/** Point final coloré des titres — l'accent aurora, jamais plus. */
export function Dot({ c = 'var(--a2)' }: { c?: string }) {
  return <span className="accent-dot" style={{ color: c }}>.</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <div className="tag">{children}</div>;
}

/** ➤ terme clé — l'emphase inline de la charte. */
export function Term({ children, c = 'var(--a2)' }: { children: ReactNode; c?: string }) {
  return (
    <span>
      <span style={{ color: c }}>➤ </span>
      <strong style={{ fontWeight: 600 }}>{children}</strong>
    </span>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Checkbox({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`checkbox ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
    >
      {on ? '✓' : ''}
    </button>
  );
}

// ── Toasts ──
type ToastCtx = { toast: (msg: string, tag?: string) => void };
const Ctx = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tag?: string }[]>([]);
  const toast = useCallback((msg: string, tag?: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg, tag }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 100 }}>
        {items.map((t) => (
          <div key={t.id} className="toast" style={{ position: 'static' }}>
            {t.tag && <div className="tag" style={{ marginBottom: 4 }}>{t.tag}</div>}
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
