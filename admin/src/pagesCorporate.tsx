import { useState } from 'react';
import { api, patch, post } from './api';
import { Bars } from './charts';
import { Field, FormBox } from './forms';
import { useFetch } from './hooks';
import { Badge, ListPage, Stat, Table, money, when } from './ui';

/** Corporate portal: a company administrator sees only their own account; the API enforces that, not this UI. */
export function CorpOverview() {
  const { data: d, error } = useFetch<any>('/corporate/overview', 60000);
  if (error) return <div className="err">{error}</div>;
  if (!d) return <p className="muted">Loading…</p>;
  const m = d.month;
  return (
    <>
      <h2>{d.name} <Badge v={d.status} /></h2>
      <div className="grid">
        <Stat label="Rides this month" value={m.rides} /><Stat label="Spend this month" value={money(m.spend)} />
        <Stat label="Monthly budget" value={m.budget ? money(m.budget) : 'Unlimited'} /><Stat label="Budget used" value={m.budgetUsedPct == null ? '–' : `${m.budgetUsedPct}%`} alert={(m.budgetUsedPct ?? 0) >= 90} />
        <Stat label="Scheduled rides pending" value={d.scheduledPending} />
      </div>
      <div className="two">
        <div><h3>Top spenders</h3><Bars rows={d.topEmployees.map((e: any) => ({ label: e.name, value: e.spend }))} unit=" Rs" /></div>
        <div><h3>Spend by trip purpose</h3><Bars rows={d.byPurpose.map((e: any) => ({ label: e.purpose, value: e.spend }))} unit=" Rs" /></div>
      </div>
    </>
  );
}

export function CorpEmployees() {
  const { data, error, reload } = useFetch<any[]>('/corporate/employees');
  const [f, setF] = useState({ email: '', phone: '', employeeCode: '', monthlyLimit: '0' });
  const add = async () => {
    await post('/corporate/employees', { email: f.email || undefined, phone: f.phone || undefined, employeeCode: f.employeeCode || undefined, monthlyLimit: Number(f.monthlyLimit) });
    setF({ email: '', phone: '', employeeCode: '', monthlyLimit: '0' }); reload();
  };
  const update = async (id: string, body: object) => { try { await patch(`/corporate/employees/${id}`, body); reload(); } catch (e) { window.alert((e as Error).message); } };
  return (
    <>
      <h2>Employees</h2>
      <FormBox title="Add an employee (must already have a Raasta account)" submit="Add employee" onSubmit={add}>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="or phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+92300..." /></Field>
        <Field label="Employee code"><input value={f.employeeCode} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} /></Field>
        <Field label="Monthly limit (Rs, 0 = none)"><input type="number" min="0" value={f.monthlyLimit} onChange={(e) => setF({ ...f, monthlyLimit: e.target.value })} /></Field>
      </FormBox>
      {error && <div className="err">{error}</div>}
      {data && <Table rows={data.map((e) => ({ ...e, id: e.userId }))} cols={[
        { head: 'Name', cell: (e: any) => e.name }, { head: 'Contact', cell: (e: any) => e.email ?? e.phone ?? '–' }, { head: 'Code', cell: (e: any) => e.employeeCode ?? '–' }, { head: 'Role', cell: (e: any) => e.role },
        { head: 'Spent this month', cell: (e: any) => money(e.spentThisMonth) },
        { head: 'Monthly limit', cell: (e: any) => <input type="number" min="0" defaultValue={e.monthlyLimit} style={{ width: 90 }} aria-label={`Limit for ${e.name}`} onBlur={(ev) => { if (Number(ev.target.value) !== e.monthlyLimit) void update(e.userId, { monthlyLimit: Number(ev.target.value) }); }} /> },
        { head: 'Active', cell: (e: any) => <input type="checkbox" checked={e.active} aria-label={`Active ${e.name}`} onChange={(ev) => update(e.userId, { active: ev.target.checked })} /> },
      ]} />}
    </>
  );
}

const PRODUCTS = ['BIKE', 'ECONOMY', 'COMFORT', 'PREMIUM', 'XL'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function CorpPolicy() {
  const { data, error, reload } = useFetch<any>('/corporate/policy');
  const budget = useFetch<any>('/corporate/overview');
  const [p, setP] = useState<any | null>(null);
  const cur = p ?? data;
  const toggle = (key: 'allowedProducts' | 'allowedWeekdays', v: string | number) => setP({ ...cur, [key]: cur[key].includes(v) ? cur[key].filter((x: unknown) => x !== v) : [...cur[key], v] });
  const save = async () => { await api('/corporate/policy', { method: 'PUT', body: JSON.stringify({ allowedProducts: cur.allowedProducts, maxFarePerRide: Number(cur.maxFarePerRide), allowedWeekdays: cur.allowedWeekdays, allowedStart: cur.allowedStart, allowedEnd: cur.allowedEnd, requirePurpose: cur.requirePurpose }) }); setP(null); reload(); };
  const setBudget = async () => { const v = window.prompt('Monthly budget in Rs (0 = unlimited):', String(budget.data?.month?.budget ?? 0)); if (v === null) return; try { await patch('/corporate/budget', { monthlyBudget: Number(v) }); budget.reload(); } catch (e) { window.alert((e as Error).message); } };
  return (
    <>
      <h2>Ride policy and budget</h2>
      <div className="toolbar"><span>Monthly budget: <b>{budget.data?.month?.budget ? money(budget.data.month.budget) : 'unlimited'}</b></span><button onClick={setBudget}>Change budget</button></div>
      {error && <div className="err">{error}</div>}
      {cur && (
        <FormBox title="Who can ride, when and how much" submit="Save policy" onSubmit={save}>
          <Field label="Allowed ride types"><span>{PRODUCTS.map((x) => <label key={x} style={{ flexDirection: 'row', gap: 4 }}><input type="checkbox" checked={cur.allowedProducts.includes(x)} onChange={() => toggle('allowedProducts', x)} />{x}</label>)}</span></Field>
          <Field label="Allowed days"><span>{DAYS.map((x, i) => <label key={x} style={{ flexDirection: 'row', gap: 4 }}><input type="checkbox" checked={cur.allowedWeekdays.includes(i + 1)} onChange={() => toggle('allowedWeekdays', i + 1)} />{x}</label>)}</span></Field>
          <Field label="Max fare per ride (Rs, 0 = none)"><input type="number" min="0" value={cur.maxFarePerRide} onChange={(e) => setP({ ...cur, maxFarePerRide: e.target.value })} /></Field>
          <Field label="Allowed from"><input type="time" value={cur.allowedStart} onChange={(e) => setP({ ...cur, allowedStart: e.target.value })} /></Field>
          <Field label="Allowed until"><input type="time" value={cur.allowedEnd} onChange={(e) => setP({ ...cur, allowedEnd: e.target.value })} /></Field>
          <Field label="Require trip purpose"><input type="checkbox" checked={cur.requirePurpose} onChange={(e) => setP({ ...cur, requirePurpose: e.target.checked })} /></Field>
        </FormBox>
      )}
    </>
  );
}

export const CorpRides = () => (
  <ListPage<any> title="Company rides" path="/corporate/rides"
    cols={() => [
      { head: 'Requested', cell: (r) => when(r.requestedAt) }, { head: 'Employee', cell: (r) => r.employee }, { head: 'Route', cell: (r) => `${r.pickupAddress ?? '?'} → ${r.dropoffAddress ?? '?'}` },
      { head: 'Purpose', cell: (r) => r.purpose ?? '–' }, { head: 'Type', cell: (r) => r.productCode }, { head: 'Fare', cell: (r) => money(r.fare) }, { head: 'Status', cell: (r) => <Badge v={r.status} /> },
    ]} />
);

export function CorpInvoices() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error } = useFetch<any>(`/corporate/invoices?month=${month}`);
  const csv = () => {
    const rows = [['Date', 'Employee', 'Purpose', 'Pickup', 'Dropoff', 'Fare', 'Cancellation fee'], ...data.lines.map((l: any) => [l.date, l.employee, l.purpose ?? '', l.pickup, l.dropoff, l.fare, l.cancellationFee])];
    const text = rows.map((r) => r.map((c: unknown) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `${data.invoiceNumber}.csv`; a.click();
  };
  return (
    <>
      <h2>Invoices</h2>
      <div className="toolbar"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />{data && <><button onClick={csv}>Download CSV</button><button onClick={() => window.print()}>Print</button></>}</div>
      {error && <div className="err">{error}</div>}
      {data && <>
        <p><b>{data.invoiceNumber}</b> · {data.company} · {data.totals.rides} rides · <b>{money(data.totals.amount)}</b></p>
        <Table rows={data.lines.map((l: any) => ({ ...l, id: l.rideId }))} cols={[
          { head: 'Date', cell: (l: any) => when(l.date) }, { head: 'Employee', cell: (l: any) => l.employee }, { head: 'Route', cell: (l: any) => `${l.pickup} → ${l.dropoff}` }, { head: 'Fare', cell: (l: any) => money(l.fare + l.cancellationFee) },
        ]} />
        {data.notes.map((n: string) => <p className="muted" key={n}>{n}</p>)}
      </>}
    </>
  );
}
