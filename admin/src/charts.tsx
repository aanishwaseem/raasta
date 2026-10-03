/** Dependency-free SVG charts: enough for ops dashboards, readable in light and dark themes. */
export interface Point { label: string; value: number }

export function LineChart({ points, unit = '', height = 160 }: { points: Point[]; unit?: string; height?: number }) {
  if (points.length < 2) return <p className="muted">Not enough data yet.</p>;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i: number) => 10 + (i / (points.length - 1)) * 980;
  const y = (v: number) => height - 20 - (v / max) * (height - 40);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 1000 ${height}`} role="img" aria-label={`Line chart, peak ${max}${unit}`}>
      <line x1="10" x2="990" y1={height - 20} y2={height - 20} stroke="var(--line)" />
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2" />
      {points.map((p, i) => <circle key={p.label} cx={x(i)} cy={y(p.value)} r="3" fill="var(--brand)"><title>{`${p.label}: ${p.value}${unit}`}</title></circle>)}
      <text x="10" y="14" fill="var(--muted)" fontSize="12">peak {max}{unit}</text>
      <text x="10" y={height - 4} fill="var(--muted)" fontSize="12">{points[0].label}</text>
      <text x="990" y={height - 4} fill="var(--muted)" fontSize="12" textAnchor="end">{points[points.length - 1].label}</text>
    </svg>
  );
}

/** Horizontal bars with the value printed next to each label. */
export function Bars({ rows, unit = '', tone }: { rows: Point[]; unit?: string; tone?: (p: Point) => string }) {
  if (!rows.length) return <p className="muted">Nothing to show.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: tone?.(r) ?? 'var(--brand)' }} /></span>
          <span className="bar-value">{r.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}
