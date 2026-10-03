import { useState, type ReactNode } from 'react';
import { post } from './api';
import { useFetch } from './hooks';
import { Badge, ListPage, Table, money, when } from './ui';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="toolbar"><h2 style={{ margin: 0 }}>{title}</h2><button onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

/** GPS trace of a trip drawn as a polyline: lets staff see what actually happened on a disputed or flagged ride. */
function Trace({ points }: { points: { lat: number; lng: number }[] }) {
  if (points.length < 2) return <p className="muted">No GPS trace was recorded (or it was removed by the retention policy).</p>;
  const [minX, maxX, minY, maxY] = [Math.min(...points.map((p) => p.lng)), Math.max(...points.map((p) => p.lng)), Math.min(...points.map((p) => p.lat)), Math.max(...points.map((p) => p.lat))];
  const sx = (v: number) => 20 + ((v - minX) / (maxX - minX || 1)) * 560;
  const sy = (v: number) => 180 - ((v - minY) / (maxY - minY || 1)) * 160;
  return (
    <svg className="map" viewBox="0 0 600 200" style={{ height: 200 }} role="img" aria-label="Trip GPS trace">
      <polyline fill="none" stroke="var(--brand)" strokeWidth="2" points={points.map((p) => `${sx(p.lng)},${sy(p.lat)}`).join(' ')} />
      <circle cx={sx(points[0].lng)} cy={sy(points[0].lat)} r="5" fill="var(--warn)"><title>Start</title></circle>
      <circle cx={sx(points[points.length - 1].lng)} cy={sy(points[points.length - 1].lat)} r="5" fill="var(--danger)"><title>Last point</title></circle>
    </svg>
  );
}

export function RideDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useFetch<any>(`/admin/rides/${id}`);
  const r = data?.ride;
  return (
    <Modal title="Ride details" onClose={onClose}>
      {error && <div className="err">{error}</div>}
      {r && (
        <>
          <dl className="kv">
            <dt>Status</dt><dd><Badge v={r.status} /></dd>
            <dt>Route</dt><dd>{r.pickup?.address} → {r.dropoff?.address}</dd>
            <dt>Fare</dt><dd>offered {money(r.fare?.offered)} · discount {money(r.fare?.discount)} · final {money(r.fare?.final)}</dd>
            <dt>Driver</dt><dd>{r.driver ? `${r.driver.firstName ?? ''} ${r.driver.vehicle?.plateNumber ?? ''}` : '–'}</dd>
          </dl>
          <h3>GPS trace</h3><Trace points={data.trace} />
          <h3>Timeline</h3>
          <Table rows={data.events.map((e: any, i: number) => ({ ...e, id: String(e.id ?? i) }))} cols={[{ head: 'When', cell: (e: any) => when(e.createdAt ?? e.created_at) }, { head: 'Event', cell: (e: any) => String(e.type).replaceAll('_', ' ') }, { head: 'By', cell: (e: any) => e.actorRole ?? e.actor_role ?? '–' }]} />
          <h3>Matching: why each driver was offered</h3>
          <Table rows={data.matchingOffers.map((o: any, i: number) => ({ ...o, id: String(i) }))} cols={[
            { head: 'Attempt', cell: (o: any) => `${o.attempt}.${o.rank}` }, { head: 'Status', cell: (o: any) => o.status }, { head: 'Score', cell: (o: any) => o.score }, { head: 'Pickup ETA', cell: (o: any) => `${o.pickupEtaS}s` },
            { head: 'Reasons', cell: (o: any) => (o.scoreBreakdown?.reasons ?? []).join('; ') || '–' },
          ]} />
          <h3>Payments</h3>
          <Table rows={data.payments} cols={[{ head: 'Purpose', cell: (p: any) => p.purpose }, { head: 'Method', cell: (p: any) => p.method }, { head: 'Amount', cell: (p: any) => money(p.amount) }, { head: 'Status', cell: (p: any) => <Badge v={p.status} /> }, { head: 'Failure', cell: (p: any) => p.failureReason ?? '–' }]} />
          {data.safetyEvents.length > 0 && <><h3>Safety events</h3><Table rows={data.safetyEvents} cols={[{ head: 'Type', cell: (s: any) => s.type }, { head: 'Severity', cell: (s: any) => s.severity }, { head: 'Status', cell: (s: any) => <Badge v={s.status} /> }]} /></>}
        </>
      )}
    </Modal>
  );
}

export function TicketThread({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useFetch<any>(`/admin/support/tickets/${id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await post(`/admin/support/tickets/${id}/messages`, { body: text.trim() }); setText(''); reload(); onChanged(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={data ? data.subject : 'Ticket'} onClose={onClose}>
      {error && <div className="err">{error}</div>}
      {data && (
        <>
          <p className="muted">{data.category} · <Badge v={data.priority} /> · <Badge v={data.status} />{data.rideId ? ` · ride ${String(data.rideId).slice(0, 8)}` : ''}</p>
          {data.messages.map((m: any) => (
            <div key={m.id} className="card" style={{ marginBottom: 8, borderLeft: m.authorKind === 'AGENT' ? '3px solid var(--brand)' : undefined }}>
              <b>{m.authorName}</b> <span className="muted">{when(m.createdAt)}</span><div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            </div>
          ))}
          <textarea rows={3} style={{ width: '100%' }} aria-label="Reply" placeholder="Reply to the customer (they are notified)" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="primary" disabled={busy || text.trim().length < 2 || data.status === 'CLOSED'} onClick={send}>Send reply</button>
        </>
      )}
    </Modal>
  );
}

export const Deliveries = () => (
  <ListPage<any> title="Deliveries" path="/admin/deliveries"
    filters={[{ key: 'status', label: 'Status', options: ['CREATED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'CANCELLED'] }]}
    cols={() => [
      { head: 'Created', cell: (d) => when(d.createdAt) }, { head: 'Sender', cell: (d) => d.senderName }, { head: 'Package', cell: (d) => `${d.packageCategory} · ${d.weightKg} kg` },
      { head: 'Route', cell: (d) => `${d.pickupAddress} → ${d.dropoffAddress}` }, { head: 'Fare', cell: (d) => money(d.fare) }, { head: 'Status', cell: (d) => <Badge v={d.status} /> },
      { head: 'Tracking', cell: (d) => d.trackingCode },
    ]} />
);
