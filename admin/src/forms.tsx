import { useState, type FormEvent, type ReactNode } from 'react';

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label>{label}{children}</label>;

/** Wraps a form: shows the API error inline, disables submit while busy. */
export function FormBox({ title, submit, onSubmit, children }: { title: string; submit: string; onSubmit: () => Promise<unknown>; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSubmit(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={run} style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="form">{children}</div>
      {err && <div className="err">{err}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : submit}</button>
    </form>
  );
}

/** Reads a comma/newline separated list of "lng,lat" pairs into a polygon ring ([lng, lat] points). */
export function parsePolygon(text: string): number[][] {
  const pts = text.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(',').map((n) => Number(n.trim())));
  if (pts.length < 3 || pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) throw new Error('Enter at least 3 points, one "lng,lat" per line.');
  return pts;
}
