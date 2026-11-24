import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useData } from '../data/DataProvider';
import { useEscape } from '../lib/hooks';
import { pct } from '../lib/format';
import type { SyncStatus } from '../lib/types';

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscape(onClose);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  // keep keyboard focus inside the dialog
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onKeyDown={trap}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/* ---------- Confirm dialogs ---------- */
interface ConfirmOpts {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          actions={
            <>
              <button className="btn" onClick={() => close(false)}>Cancel</button>
              <button className={`btn ${state.danger ? 'danger solid' : 'primary'}`} onClick={() => close(true)}>
                {state.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <div className="muted">{state.body}</div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error('useConfirm needs <ConfirmProvider>');
  return c;
};

/* ---------- Small pieces ---------- */
export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error-text" role="alert">{error}</span>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, total, label, done }: { value: number; total: number; label?: string; done?: boolean }) {
  const p = pct(value, total);
  return (
    <div className={`progress ${done ? 'done' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}

export function SubjectDot({ color, name }: { color?: string; name?: string }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="dot" style={{ background: color ?? 'var(--muted)' }} aria-hidden="true" />
      <span>{name ?? 'No subject'}</span>
    </span>
  );
}

/* ---------- Sync badge + toasts ---------- */
const LABEL: Record<SyncStatus, string> = { synced: 'Synced', saving: 'Saving…', offline: 'Offline', error: 'Sync error' };
export function SyncBadge() {
  const { sync } = useData();
  return (
    <a className="sync" data-status={sync.status} href="#/settings/sync" aria-live="polite" title={sync.error ?? undefined}>
      <span className="dot" aria-hidden="true" />
      {LABEL[sync.status]}
      {sync.pending > 0 && sync.status !== 'synced' ? ` · ${sync.pending}` : ''}
    </a>
  );
}

export function Toasts({ extra, onClearExtra }: { extra?: string | null; onClearExtra?: () => void }) {
  const { sync, engine } = useData();
  useEffect(() => {
    if (!extra) return;
    const t = setTimeout(() => onClearExtra?.(), 6000);
    return () => clearTimeout(t);
  }, [extra, onClearExtra]);
  return (
    <div className="toasts" aria-live="polite">
      {extra && (
        <div className="toast" role="status">
          <span style={{ flex: 1 }}>{extra}</span>
          <button className="btn ghost icon sm" aria-label="Dismiss" onClick={onClearExtra}><Icon name="x" /></button>
        </div>
      )}
      {sync.notices.map((n) => (
        <div className="toast err" role="status" key={n.id}>
          <span style={{ flex: 1 }}>{n.text}</span>
          <button className="btn ghost icon sm" aria-label="Dismiss" onClick={() => engine.dismissNotice(n.id)}><Icon name="x" /></button>
        </div>
      ))}
    </div>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
