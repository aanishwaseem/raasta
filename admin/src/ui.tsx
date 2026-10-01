import { useState, type ReactNode } from 'react';
import { useFetch } from './hooks';

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface Col<T> { head: string; cell: (row: T) => ReactNode }

export const money = (n: number | null | undefined) => (n == null ? '–' : `Rs ${Math.round(n).toLocaleString()}`);
export const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '–');

const GOOD = ['ACTIVE', 'APPROVED', 'COMPLETED', 'PAID', 'RESOLVED', 'CLOSED', 'SUCCEEDED'];
const BAD = ['SUSPENDED', 'REJECTED', 'CANCELLED', 'FAILED', 'DELETED', 'NO_DRIVERS', 'URGENT'];
export function Badge({ v }: { v?: string | null }) {
  if (!v) return <>–</>;
  const kind = GOOD.includes(v) ? 'good' : BAD.includes(v) ? 'bad' : v.startsWith('PENDING') || v === 'REQUESTED' || v === 'OPEN' || v === 'HIGH' ? 'warn' : '';
  return <span className={`badge ${kind}`}>{v.replaceAll('_', ' ')}</span>;
}

export function Stat({ label, value, alert }: { label: string; value: ReactNode; alert?: boolean }) {
  return <div className={`card stat${alert ? ' alert' : ''}`}><b>{value}</b><span>{label}</span></div>;
}

export function Table<T extends { id: string }>({ rows, cols }: { rows: T[]; cols: Col<T>[] }) {
  if (!rows.length) return <p className="muted">Nothing to show.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c.head}>{c.head}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>{cols.map((c) => <td key={c.head}>{c.cell(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Paged, filterable list backed by an admin endpoint that returns { items, page, pageSize, total }. */
export function ListPage<T extends { id: string }>({ title, path, filters, cols, extra }: {
  title: string; path: string; cols: (reload: () => void) => Col<T>[];
  filters?: { key: string; label: string; options?: string[] }[]; extra?: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [f, setF] = useState<Record<string, string>>({});
  const qs = new URLSearchParams({ page: String(page), pageSize: '20', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const { data, error, loading, reload } = useFetch<Page<T>>(`${path}?${qs}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <>
      <h2>{title}</h2>
      <div className="toolbar">
        {filters?.map((x) => x.options
          ? <select key={x.key} value={f[x.key] ?? ''} onChange={(e) => { setPage(1); setF({ ...f, [x.key]: e.target.value }); }}><option value="">{x.label}: all</option>{x.options.map((o) => <option key={o}>{o}</option>)}</select>
          : <input key={x.key} placeholder={x.label} value={f[x.key] ?? ''} onChange={(e) => { setPage(1); setF({ ...f, [x.key]: e.target.value }); }} />)}
        {extra}
      </div>
      {error && <div className="err">{error}</div>}
      {data && <Table rows={data.items} cols={cols(reload)} />}
      {loading && !data && <p className="muted">Loading…</p>}
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
        <span className="muted">Page {page} of {pages}{data ? ` · ${data.total} total` : ''}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>
  );
}
