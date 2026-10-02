import { useState } from 'react';
import { api, patch, post } from './api';
import { ReasonButton } from './Actions';
import { Field, FormBox, parsePolygon } from './forms';
import { useFetch } from './hooks';
import { Badge, ListPage, Table, money, when } from './ui';

export const Vehicles = () => (
  <ListPage<any> title="Vehicles" path="/admin/vehicles"
    filters={[{ key: 'status', label: 'Status', options: ['PENDING', 'APPROVED', 'REJECTED', 'INACTIVE'] }, { key: 'q', label: 'Search plate, make or driver' }]}
    cols={(reload) => [
      { head: 'Driver', cell: (r) => r.driverName }, { head: 'Vehicle', cell: (r) => `${r.make} ${r.model} ${r.year}, ${r.color}` }, { head: 'Plate', cell: (r) => r.plate },
      { head: 'Class', cell: (r) => r.vehicleClass }, { head: 'Seats', cell: (r) => r.seats }, { head: 'Docs pending', cell: (r) => r.pendingDocuments },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> }, { head: 'Added', cell: (r) => when(r.createdAt) },
      { head: 'Actions', cell: (r) => r.status === 'PENDING' ? (
        <div className="toolbar">
          <ReasonButton label="Approve" path={`/admin/vehicles/${r.id}/review`} extra={{ decision: 'APPROVED' }} onDone={reload} />
          <ReasonButton danger label="Reject" path={`/admin/vehicles/${r.id}/review`} extra={{ decision: 'REJECTED' }} onDone={reload} />
        </div>) : null },
    ]} />
);

const FIELDS: [string, string][] = [['baseFare', 'Base fare'], ['perKm', 'Per km'], ['perMinute', 'Per minute'], ['minimumFare', 'Minimum fare'], ['bookingFee', 'Booking fee'], ['platformFeePct', 'Platform fee %'],
  ['fuelCostPerKm', 'Fuel cost / km'], ['maxSurgeMultiplier', 'Max surge multiplier'], ['minOfferPct', 'Min offer % of fare'], ['sharedDiscountPct', 'Shared discount %'], ['cancellationFee', 'Cancellation fee'], ['freeCancelSeconds', 'Free cancel (s)']];

export function Pricing() {
  const { data, error, reload } = useFetch<any[]>('/admin/pricing');
  const [edit, setEdit] = useState<any | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const open = (r: any) => { setEdit(r); setReason(''); setVals(Object.fromEntries(FIELDS.map(([k]) => [k, String(r[k])]))); };
  const save = async () => {
    await api(`/admin/pricing/${edit.id}`, { method: 'PUT', body: JSON.stringify({ ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(vals[k])])), reason }) });
    setEdit(null); reload();
  };
  return (
    <>
      <h2>Pricing</h2>
      <p className="muted">Fares are computed from these parameters plus live demand, traffic and time of day. Surge is capped by the maximum multiplier and always explained to the rider. Every change is audited.</p>
      {error && <div className="err">{error}</div>}
      {edit && (
        <FormBox title={`Edit ${edit.city} · ${edit.productCode}`} submit="Save pricing" onSubmit={save}>
          {FIELDS.map(([k, l]) => <Field key={k} label={l}><input required type="number" step="any" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>)}
          <Field label="Reason (audit log)"><input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </FormBox>
      )}
      {data && <Table rows={data} cols={[
        { head: 'City', cell: (r: any) => r.city }, { head: 'Product', cell: (r: any) => r.productCode }, { head: 'Base', cell: (r: any) => money(r.baseFare) }, { head: 'Per km', cell: (r: any) => r.perKm },
        { head: 'Per min', cell: (r: any) => r.perMinute }, { head: 'Minimum', cell: (r: any) => money(r.minimumFare) }, { head: 'Fee %', cell: (r: any) => r.platformFeePct },
        { head: 'Max surge', cell: (r: any) => `${r.maxSurgeMultiplier}x` }, { head: 'Updated', cell: (r: any) => when(r.updatedAt) }, { head: '', cell: (r: any) => <button onClick={() => open(r)}>Edit</button> },
      ]} />}
    </>
  );
}

/** Projects GeoJSON polygons onto one SVG so staff can see the shape of each area and zone. */
function AreaMap({ shapes }: { shapes: { id: string; name: string; kind: string; ring: number[][] }[] }) {
  const pts = shapes.flatMap((s) => s.ring);
  if (!pts.length) return null;
  const [minX, maxX, minY, maxY] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const sx = (v: number) => 20 + ((v - minX) / (maxX - minX || 1)) * 960;
  const sy = (v: number) => 380 - ((v - minY) / (maxY - minY || 1)) * 360;
  const colour = (k: string) => (k === 'RESTRICTED' ? 'var(--danger)' : k === 'AIRPORT' ? 'var(--warn)' : k === 'ZONE' ? 'var(--muted)' : 'var(--brand)');
  return (
    <svg className="map" viewBox="0 0 1000 400" role="img" aria-label="Service areas and demand zones">
      {shapes.map((s) => <polygon key={s.id} points={s.ring.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} fill={colour(s.kind)} fillOpacity=".12" stroke={colour(s.kind)}><title>{`${s.name} (${s.kind})`}</title></polygon>)}
    </svg>
  );
}
const ringOf = (b: any): number[][] => (b?.type === 'Polygon' ? b.coordinates[0] : b?.type === 'MultiPolygon' ? b.coordinates[0][0] : []);

export function ServiceAreas() {
  const cities = useFetch<any[]>('/admin/cities');
  const areas = useFetch<any[]>('/admin/service-areas');
  const zones = useFetch<any[]>('/admin/zones');
  const [f, setF] = useState({ cityId: '', name: '', kind: 'SERVICE', polygon: '' });
  const toggle = async (path: string, active: boolean, done: () => void) => { try { await patch(path, { active }); done(); } catch (e) { window.alert((e as Error).message); } };
  const add = async () => {
    const polygon = parsePolygon(f.polygon);
    await post('/admin/service-areas', { cityId: f.cityId || cities.data?.[0]?.id, name: f.name, kind: f.kind, polygon });
    setF({ ...f, name: '', polygon: '' }); areas.reload();
  };
  const shapes = [...(areas.data ?? []).filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, kind: a.kind, ring: ringOf(a.boundary) })), ...(zones.data ?? []).filter((z) => z.active).map((z) => ({ id: z.id, name: z.name, kind: 'ZONE', ring: ringOf(z.boundary) }))];
  return (
    <>
      <h2>Service areas</h2>
      <p className="muted">Rides can only start and end inside an active service area. Green = service, amber = airport, red = restricted, grey = demand zones.</p>
      <AreaMap shapes={shapes} />
      <h3>Cities</h3>
      {cities.data && <Table rows={cities.data} cols={[{ head: 'City', cell: (c: any) => c.name }, { head: 'Slug', cell: (c: any) => c.slug },
        { head: 'Active', cell: (c: any) => <input type="checkbox" checked={c.active} aria-label={`Toggle ${c.name}`} onChange={(e) => toggle(`/admin/cities/${c.id}`, e.target.checked, cities.reload)} /> }]} />}
      <h3>Areas</h3>
      {areas.data && <Table rows={areas.data} cols={[{ head: 'Name', cell: (a: any) => a.name }, { head: 'Kind', cell: (a: any) => a.kind },
        { head: 'Active', cell: (a: any) => <input type="checkbox" checked={a.active} aria-label={`Toggle ${a.name}`} onChange={(e) => toggle(`/admin/service-areas/${a.id}`, e.target.checked, areas.reload)} /> }]} />}
      <FormBox title="Add area" submit="Create area" onSubmit={add}>
        <Field label="City"><select value={f.cityId} onChange={(e) => setF({ ...f, cityId: e.target.value })}>{(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Name"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['SERVICE', 'AIRPORT', 'RESTRICTED'].map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label={'Polygon: one "lng,lat" per line'}><textarea rows={4} required value={f.polygon} onChange={(e) => setF({ ...f, polygon: e.target.value })} placeholder={'74.30,31.50\n74.40,31.50\n74.40,31.58'} /></Field>
      </FormBox>
      <h3>Demand zones</h3>
      {zones.data && <Table rows={zones.data} cols={[{ head: 'Zone', cell: (z: any) => z.name }, { head: 'Code', cell: (z: any) => z.code },
        { head: 'Active', cell: (z: any) => <input type="checkbox" checked={z.active} aria-label={`Toggle ${z.name}`} onChange={(e) => toggle(`/admin/zones/${z.id}`, e.target.checked, zones.reload)} /> }]} />}
    </>
  );
}

const INDUSTRIES = ['SOFTWARE', 'FACTORY', 'UNIVERSITY', 'HOSPITAL', 'OFFICE', 'OTHER'];
export function Corporate() {
  const { data, error, reload } = useFetch<any[]>('/admin/corporate-accounts');
  const [f, setF] = useState({ name: '', industry: 'OFFICE', billingEmail: '', adminEmail: '', monthlyBudget: '0' });
  const create = async () => { await post('/admin/corporate-accounts', { ...f, monthlyBudget: Number(f.monthlyBudget) }); setF({ ...f, name: '', billingEmail: '', adminEmail: '' }); reload(); };
  return (
    <>
      <h2>Corporate accounts</h2>
      <p className="muted">Company administrators sign in to this same dashboard and see only their own account (employees, policy, budget, rides, invoices).</p>
      <FormBox title="New corporate account" submit="Create" onSubmit={create}>
        <Field label="Company"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Industry"><select value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select></Field>
        <Field label="Billing email"><input required type="email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} /></Field>
        <Field label="Admin user email (must already be registered)"><input required type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
        <Field label="Monthly budget (Rs, 0 = unlimited)"><input type="number" min="0" value={f.monthlyBudget} onChange={(e) => setF({ ...f, monthlyBudget: e.target.value })} /></Field>
      </FormBox>
      {error && <div className="err">{error}</div>}
      {data && <Table rows={data} cols={[
        { head: 'Company', cell: (c: any) => <>{c.name}{c.isTestData && <span className="test">test</span>}</> }, { head: 'Industry', cell: (c: any) => c.industry }, { head: 'Billing', cell: (c: any) => c.billingEmail },
        { head: 'Employees', cell: (c: any) => c.employees }, { head: 'Budget', cell: (c: any) => (c.monthlyBudget ? money(c.monthlyBudget) : 'unlimited') }, { head: 'Status', cell: (c: any) => <Badge v={c.status} /> },
        { head: 'Actions', cell: (c: any) => (c.status === 'ACTIVE'
          ? <ReasonButton danger label="Suspend" method="PATCH" path={`/admin/corporate-accounts/${c.id}`} extra={{ status: 'SUSPENDED' }} onDone={reload} />
          : <ReasonButton label="Reactivate" method="PATCH" path={`/admin/corporate-accounts/${c.id}`} extra={{ status: 'ACTIVE' }} onDone={reload} />) },
      ]} />}
    </>
  );
}
