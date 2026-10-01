import { useMemo, useState } from 'react';
import { DriverReview } from './DriverReview';
import { patch, post } from './api';
import { ReasonButton } from './Actions';
import { useFetch } from './hooks';
import { Badge, ListPage, Stat, money, when } from './ui';

export function Overview() {
  const { data: d, error } = useFetch<any>('/admin/overview', 30000);
  if (error) return <div className="err">{error}</div>;
  if (!d) return <p className="muted">Loading…</p>;
  const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);
  return (
    <>
      <h2>Overview <span className="muted">(last 24h{d.includesTestData ? ', includes test data' : ''})</span></h2>
      <div className="grid">
        <Stat label="Rides requested" value={d.rides.requested} />
        <Stat label="Completed" value={d.rides.completed} />
        <Stat label="Active now" value={d.rides.active} />
        <Stat label="Drivers online" value={d.onlineDriversNow} />
        <Stat label="Completion rate" value={pct(d.rides.completionRate)} />
        <Stat label="No drivers found" value={d.rides.noDrivers} />
        <Stat label="GMV" value={money(d.money.gmv)} />
        <Stat label="Platform revenue" value={money(d.money.platformRevenue)} />
        <Stat label="Avg match time" value={d.rides.avgMatchSeconds == null ? '–' : `${d.rides.avgMatchSeconds}s`} />
        <Stat label="Avg passenger rating" value={d.quality.avgPassengerRating ?? '–'} />
      </div>
      <h2>Needs attention</h2>
      <div className="grid">
        <Stat label="Drivers pending review" value={d.queues.pendingDrivers} alert={d.queues.pendingDrivers > 0} />
        <Stat label="Withdrawals to process" value={d.queues.pendingWithdrawals} alert={d.queues.pendingWithdrawals > 0} />
        <Stat label="Open safety events" value={d.queues.safety} alert={d.queues.safety > 0} />
        <Stat label="Open fraud flags" value={d.queues.fraud} alert={d.queues.fraud > 0} />
        <Stat label="Open support tickets" value={d.queues.support} />
      </div>
    </>
  );
}

export function Drivers() {
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  return (
    <>
      <DriversList key={tick} onOpen={setOpen} />
      {open && <DriverReview id={open} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} />}
    </>
  );
}

const DriversList = ({ onOpen }: { onOpen: (id: string) => void }) => (
  <ListPage<any> title="Drivers" path="/admin/drivers"
    filters={[{ key: 'status', label: 'Status', options: ['ONBOARDING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] }, { key: 'q', label: 'Search name or phone' }]}
    cols={(reload) => [
      { head: 'Name', cell: (r) => <>{r.fullName}{r.isTestData && <span className="test">test</span>}</> },
      { head: 'Phone', cell: (r) => r.phone ?? '–' },
      { head: 'City', cell: (r) => r.city ?? '–' },
      { head: 'Vehicle', cell: (r) => r.vehicle ?? '–' },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Docs pending', cell: (r) => r.pendingDocuments },
      { head: 'Actions', cell: (r) => (
        <div className="toolbar">
          <button onClick={() => onOpen(r.id)}>{r.status === 'PENDING_REVIEW' ? 'Review' : 'Details'}</button>
          {r.status === 'PENDING_REVIEW' && <><ReasonButton label="Approve" path={`/admin/drivers/${r.id}/approve`} onDone={reload} /><ReasonButton danger label="Reject" path={`/admin/drivers/${r.id}/reject`} onDone={reload} /></>}
          {r.status === 'APPROVED' && <ReasonButton danger label="Suspend" path={`/admin/drivers/${r.id}/suspend`} onDone={reload} />}
          {r.status === 'SUSPENDED' && <ReasonButton label="Reinstate" path={`/admin/drivers/${r.id}/reinstate`} onDone={reload} />}
        </div>) },
    ]} />
);

export const Users = () => (
  <ListPage<any> title="Users" path="/admin/users"
    filters={[{ key: 'role', label: 'Role', options: ['PASSENGER', 'DRIVER', 'ADMIN', 'SUPPORT', 'CORPORATE_ADMIN'] }, { key: 'status', label: 'Status', options: ['ACTIVE', 'SUSPENDED', 'DELETED'] }, { key: 'q', label: 'Search name, email or phone' }]}
    cols={(reload) => [
      { head: 'Name', cell: (r) => <>{r.fullName}{r.isTestData && <span className="test">test</span>}</> },
      { head: 'Email', cell: (r) => r.email ?? '–' },
      { head: 'Phone', cell: (r) => r.phone ?? '–' },
      { head: 'Roles', cell: (r) => (r.roles ?? []).join(', ') },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Joined', cell: (r) => when(r.createdAt) },
      { head: 'Actions', cell: (r) => r.status === 'ACTIVE'
        ? <ReasonButton danger label="Suspend" path={`/admin/users/${r.id}/suspend`} onDone={reload} />
        : r.status === 'SUSPENDED' ? <ReasonButton label="Reinstate" path={`/admin/users/${r.id}/reinstate`} onDone={reload} /> : null },
    ]} />
);

const ACTIVE_RIDE = ['MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];
export const Rides = () => (
  <ListPage<any> title="Rides" path="/admin/rides"
    filters={[{ key: 'status', label: 'Status', options: ['MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_DRIVERS'] }, { key: 'q', label: 'Search passenger, address or id' }]}
    cols={(reload) => [
      { head: 'Requested', cell: (r) => when(r.requestedAt) },
      { head: 'Passenger', cell: (r) => r.passengerName },
      { head: 'Driver', cell: (r) => r.driverName ?? '–' },
      { head: 'Route', cell: (r) => <>{r.pickupAddress ?? '?'} → {r.dropoffAddress ?? '?'}</> },
      { head: 'Fare', cell: (r) => money(r.finalFare ?? r.offeredFare) },
      { head: 'Payment', cell: (r) => <>{r.paymentMethod} <Badge v={r.paymentStatus} /></> },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Actions', cell: (r) => ACTIVE_RIDE.includes(r.status) ? <ReasonButton danger label="Cancel" path={`/admin/rides/${r.id}/cancel`} onDone={reload} /> : null },
    ]} />
);

export const Withdrawals = () => (
  <ListPage<any> title="Driver withdrawals" path="/admin/withdrawals"
    filters={[{ key: 'status', label: 'Status', options: ['REQUESTED', 'PAID', 'REJECTED'] }]}
    cols={(reload) => [
      { head: 'Requested', cell: (r) => when(r.createdAt) },
      { head: 'Driver', cell: (r) => r.driverName },
      { head: 'Amount', cell: (r) => money(r.amount) },
      { head: 'Destination', cell: (r) => typeof r.destination === 'string' ? r.destination : JSON.stringify(r.destination) },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Actions', cell: (r) => r.status !== 'REQUESTED' ? null : (
        <div className="toolbar">
          {(['PAID', 'REJECTED'] as const).map((decision) => (
            <button key={decision} className={decision === 'PAID' ? 'primary' : 'danger'} onClick={async () => {
              if (!window.confirm(`Mark ${money(r.amount)} for ${r.driverName} as ${decision}?`)) return;
              try { await post(`/admin/withdrawals/${r.id}/process`, { decision }); reload(); } catch (e) { window.alert((e as Error).message); }
            }}>{decision === 'PAID' ? 'Mark paid' : 'Reject'}</button>))}
        </div>) },
    ]} />
);

export const Tickets = () => (
  <ListPage<any> title="Support tickets" path="/admin/support/tickets"
    filters={[{ key: 'status', label: 'Status', options: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'] }, { key: 'priority', label: 'Priority', options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] }]}
    cols={(reload) => [
      { head: 'Created', cell: (r) => when(r.createdAt) },
      { head: 'User', cell: (r) => r.userName },
      { head: 'Category', cell: (r) => r.category },
      { head: 'Subject', cell: (r) => r.subject },
      { head: 'Priority', cell: (r) => <Badge v={r.priority} /> },
      { head: 'Status', cell: (r) => (
        <select value={r.status} onChange={async (e) => { try { await patch(`/admin/support/tickets/${r.id}`, { status: e.target.value }); reload(); } catch (err) { window.alert((err as Error).message); } }}>
          {['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}
        </select>) },
    ]} />
);

/** Live operations map: plain SVG projection of online drivers, active rides and open safety events (no map-tile provider needed). */
export function LiveMap() {
  const { data, error } = useFetch<any>('/admin/live-map', 10000);
  const pts = useMemo(() => {
    if (!data) return null;
    const all: { lat: number; lng: number }[] = [
      ...data.drivers, ...data.safetyEvents,
      ...data.rides.flatMap((r: any) => [{ lat: r.pickupLat, lng: r.pickupLng }, { lat: r.dropoffLat, lng: r.dropoffLng }]),
    ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!all.length) return null;
    const lat = all.map((p) => p.lat); const lng = all.map((p) => p.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lat), Math.max(...lat), Math.min(...lng), Math.max(...lng)];
    const sx = (v: number) => 20 + ((v - minLng) / (maxLng - minLng || 1)) * 960;
    const sy = (v: number) => 400 - ((v - minLat) / (maxLat - minLat || 1)) * 380;
    return { sx, sy };
  }, [data]);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <h2>Live map</h2>
      <p className="muted">{data.drivers.length} drivers online · {data.rides.length} active rides · {data.safetyEvents.length} open safety events · refreshes every 10s</p>
      {!pts ? <p className="muted">No live activity.</p> : (
        <svg className="map" viewBox="0 0 1000 420" role="img" aria-label="Live operations map">
          {data.rides.map((r: any) => <line key={r.id} x1={pts.sx(r.pickupLng)} y1={pts.sy(r.pickupLat)} x2={pts.sx(r.dropoffLng)} y2={pts.sy(r.dropoffLat)} stroke="var(--muted)" strokeDasharray="4 4" />)}
          {data.rides.map((r: any) => <circle key={`p${r.id}`} cx={pts.sx(r.pickupLng)} cy={pts.sy(r.pickupLat)} r="5" fill="var(--warn)"><title>{`Ride ${r.status}`}</title></circle>)}
          {data.drivers.map((d: any) => <circle key={d.id} cx={pts.sx(d.lng)} cy={pts.sy(d.lat)} r="6" fill="var(--brand)"><title>{`Driver ${d.status} ${d.vehicleClass ?? ''}`}</title></circle>)}
          {data.safetyEvents.map((s: any) => <rect key={s.id} x={pts.sx(s.lng) - 7} y={pts.sy(s.lat) - 7} width="14" height="14" fill="var(--danger)"><title>{`${s.type} (${s.severity})`}</title></rect>)}
        </svg>
      )}
      <p className="muted">● driver · <span style={{ color: 'var(--warn)' }}>●</span> ride pickup · <span style={{ color: 'var(--danger)' }}>■</span> safety event</p>
    </>
  );
}
