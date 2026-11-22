import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { getStore, onStoreChange, setStore } from '../shared/storage';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ---------- routing ---------- */

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path = '/', search = ''] = hash.split('?');
  return { path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export const isEmbedded = new URLSearchParams(window.location.search).has('embed');

/* ---------- data hooks ---------- */

export function useStore<T>(key: string, fallback: T): [T, (next: T | ((current: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    let live = true;
    void getStore(key, fallback).then((v) => {
      if (!live) return;
      setValue(v);
      setReady(true);
    });
    const off = onStoreChange<T>(key, (v) => live && setValue(v === undefined ? fallback : v));
    return () => {
      live = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(latest.current) : next;
      latest.current = resolved;
      setValue(resolved);
      void setStore(key, resolved);
    },
    [key],
  );
  return [value, update, ready];
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ data: null, error: errorMessage(error), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/* ---------- toasts ---------- */

type Tone = 'info' | 'good' | 'bad' | 'warn';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), tone === 'bad' ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.tone}`}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------- layout ---------- */

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, hint, actions, children, className }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title || actions ? (
        <div className="card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {hint ? <p>{hint}</p> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Button({ busy, variant, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'danger' | 'ghost' | 'small' }) {
  return (
    <button type="button" {...rest} className={`${variant ?? ''} ${rest.className ?? ''}`} disabled={rest.disabled || busy}>
      {busy ? <span className="spinner" /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label} {hint ? <span className="hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" /> {label}…
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        {children}
        {footer ? <div className="row end">{footer}</div> : null}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  align?: 'right';
  render: (row: T, index: number) => ReactNode;
}

export function Table<T>({ columns, rows, rowKey, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string; empty?: string }) {
  if (!rows.length) return <div className="muted small">{empty ?? 'Nothing to show.'}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align ?? ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align ?? ''}>
                  {c.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- data display ---------- */

export function toneFor(score: number): 'good' | 'warn' | 'bad' {
  return score >= 65 ? 'good' : score >= 40 ? 'warn' : 'bad';
}

const TONE_COLOR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

export function Gauge({ value, label, invert }: { value: number | null; label: string; invert?: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const tone = toneFor(invert ? 100 - v : v);
  return (
    <div className="gauge">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={TONE_COLOR[tone]} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div className="num">{value === null ? '–' : Math.round(v)}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Meter({ value }: { value: number }) {
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Pill({ tone, children }: { tone?: 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export interface Series {
  label: string;
  color?: string;
  points: { x: string; y: number }[];
}

const SERIES_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--good)', 'var(--warn)', 'var(--bad)'];

export function LineChart({ series, height = 180, yLabel }: { series: Series[]; height?: number; yLabel?: (v: number) => string }) {
  const width = 640;
  const pad = { l: 46, r: 10, t: 10, b: 22 };
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const n = Math.max(...series.map((s) => s.points.length), 0);
  const geometry = useMemo(() => {
    const max = Math.max(1, ...all);
    const min = Math.min(0, ...all);
    const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (width - pad.l - pad.r));
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (height - pad.t - pad.b);
    return { max, min, x, y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(all), n, height]);
  if (!n) return <div className="muted small">No data yet.</div>;
  const labels = series[0]?.points ?? [];
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {[geometry.min, (geometry.min + geometry.max) / 2, geometry.max].map((v) => (
          <g key={v}>
            <line className="axis" x1={pad.l} x2={width - pad.r} y1={geometry.y(v)} y2={geometry.y(v)} />
            <text x={pad.l - 6} y={geometry.y(v) + 3} textAnchor="end">
              {yLabel ? yLabel(v) : Math.round(v)}
            </text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={i} x={geometry.x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {labels[i]?.x}
          </text>
        ))}
        {series.map((s, si) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color ?? SERIES_COLORS[si % SERIES_COLORS.length]}
            strokeWidth="2"
            strokeLinejoin="round"
            points={s.points.map((p, i) => `${geometry.x(i)},${geometry.y(p.y)}`).join(' ')}
          />
        ))}
      </svg>
      {series.length > 1 ? (
        <div className="row small muted">
          {series.map((s, si) => (
            <span key={s.label} className="row" style={{ gap: 5 }}>
              <span style={{ width: 10, height: 3, background: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length], display: 'inline-block' }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BarList({ items, format }: { items: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="stack" style={{ gap: 7 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div className="row between small">
            <span className="truncate">{item.label}</span>
            <span className="muted">{format ? format(item.value) : item.value}</span>
          </div>
          <Meter value={(item.value / max) * 100} />
        </div>
      ))}
    </div>
  );
}

export function downloadFile(name: string, content: string | Blob, type = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
