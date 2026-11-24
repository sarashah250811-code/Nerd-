import { formatMinutes } from '../lib/format';

export interface BarDatum {
  label: string;
  value: number;
  title?: string;
  alt?: boolean;
}

/** Accessible SVG bar chart; every bar has a <title> tooltip and the whole chart a text summary. */
export function BarChart({ data, height = 180, ariaLabel, unit = 'min' }: { data: BarDatum[]; height?: number; ariaLabel: string; unit?: 'min' | 'count' }) {
  const W = 640;
  const padL = 34;
  const padB = 24;
  const padT = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = niceMax(max);
  const bw = (W - padL) / Math.max(1, data.length);
  const H = height;
  const innerH = H - padB - padT;
  const fmt = (v: number) => (unit === 'min' ? formatMinutes(v) : String(Math.round(v)));
  const ticks = [0, top / 2, top];
  const every = data.length > 16 ? Math.ceil(data.length / 8) : 1;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ariaLabel}. ${data.map((d) => `${d.label}: ${fmt(d.value)}`).join(', ')}`}>
      {ticks.map((t) => {
        const y = padT + innerH - (t / top) * innerH;
        return (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={W} y1={y} y2={y} />
            <text x={padL - 6} y={y + 4} textAnchor="end">{unit === 'min' ? formatMinutes(t) : Math.round(t)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / top) * innerH;
        const x = padL + i * bw + bw * 0.18;
        const w = bw * 0.64;
        return (
          <g key={i}>
            <rect className={`bar ${d.alt ? 'alt' : ''}`} x={x} y={padT + innerH - h} width={w} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={3}>
              <title>{d.title ?? `${d.label}: ${fmt(d.value)}`}</title>
            </rect>
            {i % every === 0 && (
              <text x={x + w / 2} y={H - 6} textAnchor="middle">{d.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function niceMax(v: number) {
  const steps = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600, 900, 1200];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 600) * 600;
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}
export function Donut({ slices, size = 170, ariaLabel, centre }: { slices: Slice[]; size?: number; ariaLabel: string; centre?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 62;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" role="img" aria-label={`${ariaLabel}. ${slices.map((s) => `${s.label}: ${formatMinutes(s.value)}`).join(', ')}`}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
      {total > 0 &&
        slices.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={s.label} cx="80" cy="80" r={r} fill="none" stroke={s.color} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)">
              <title>{`${s.label}: ${formatMinutes(s.value)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      {centre && (
        <text x="80" y="86" textAnchor="middle" style={{ fill: 'var(--text)', fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600 }}>{centre}</text>
      )}
    </svg>
  );
}

/** Ring used for the daily target and the timer. */
export function Ring({ ratio, size = 120, stroke = 10, children, color = 'var(--accent)' }: { ratio: number; size?: number; stroke?: number; children?: React.ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, ratio)))} style={{ transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}
