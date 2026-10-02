import { useMemo, useState } from 'react';
import { Bars, LineChart } from './charts';
import { useFetch } from './hooks';
import { Stat, Table, money } from './ui';

const METRICS: Record<string, string> = { requests: 'Ride requests', completed: 'Completed', cancelled: 'Cancelled', no_drivers: 'No drivers found', gmv: 'GMV (Rs)', avg_match_seconds: 'Avg match time (s)' };
const DAYS = [7, 14, 30];
const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 1000) / 10}%`);

export function Analytics() {
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState('requests');
  const from = useMemo(() => since(days), [days]);
  const kpi = useFetch<any>(`/admin/analytics/kpis?from=${from}`);
  const ts = useFetch<any>(`/admin/analytics/timeseries?metric=${metric}&interval=day&from=${from}`);
  const can = useFetch<any>(`/admin/analytics/cancellations?from=${from}`);
  const k = kpi.data;
  return (
    <>
      <h2>Analytics</h2>
      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{DAYS.map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>{Object.entries(METRICS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {kpi.error && <div className="err">{kpi.error}</div>}
      {k && (
        <div className="grid">
          <Stat label="Requested" value={k.rides.requested} /><Stat label="Completed" value={k.rides.completed} /><Stat label="Completion rate" value={pct(k.rides.completionRate)} />
          <Stat label="GMV" value={money(k.money.gmv)} /><Stat label="Platform revenue" value={money(k.money.platformRevenue)} /><Stat label="Discounts given" value={money(k.money.discounts)} />
          <Stat label="Avg match time" value={k.rides.avgMatchSeconds == null ? '–' : `${k.rides.avgMatchSeconds}s`} /><Stat label="p90 match time" value={k.rides.p90MatchSeconds == null ? '–' : `${k.rides.p90MatchSeconds}s`} />
          <Stat label="Active drivers" value={k.rides.activeDrivers} /><Stat label="Active passengers" value={k.rides.activePassengers} /><Stat label="Avg rating" value={k.quality.avgPassengerRating ?? '–'} />
          <Stat label="Safety events / 1,000 rides" value={k.quality.safetyEventsPer1000Rides ?? '–'} /><Stat label="Support tickets / 1,000 rides" value={k.quality.supportTicketsPer1000Rides ?? '–'} />
        </div>
      )}
      <h3>{METRICS[metric]} per day</h3>
      {ts.data && <LineChart points={ts.data.points.map((p: any) => ({ label: new Date(p.t).toLocaleDateString(), value: p.value }))} />}
      <h3>Cancellations</h3>
      {can.data && (
        <>
          <p className="muted">{can.data.cancelled} of {can.data.total} rides cancelled ({pct(can.data.cancelRate)}). {can.data.avgSecondsFromAssignToPassengerCancel != null && `Passengers who cancel do so ${can.data.avgSecondsFromAssignToPassengerCancel}s after a driver is assigned, on average.`}</p>
          <div className="two">
            <div><h3>By reason</h3><Bars rows={can.data.byReason.map((r: any) => ({ label: r.reason.replaceAll('_', ' '), value: r.count }))} /></div>
            <div><h3>By who cancelled</h3><Bars rows={can.data.byActor.map((r: any) => ({ label: r.cancelledBy, value: r.count }))} /></div>
          </div>
          <h3>Cancellation hotspots (zones with 5+ rides)</h3>
          <Table rows={can.data.hotspots.map((h: any) => ({ ...h, id: h.zoneId }))} cols={[
            { head: 'Zone', cell: (h: any) => h.name }, { head: 'Rides', cell: (h: any) => h.total }, { head: 'Cancelled', cell: (h: any) => h.cancelled }, { head: 'Rate', cell: (h: any) => `${h.cancelPct}%` },
          ]} />
          <p className="muted">{can.data.note}</p>
        </>
      )}
    </>
  );
}

export function Demand() {
  const { data, error } = useFetch<any>('/admin/demand/forecast', 60000);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const zones: any[] = data.zones;
  const tone = (l: string) => (l === 'HIGH' ? 'var(--danger)' : l === 'MEDIUM' ? 'var(--warn)' : 'var(--brand)');
  return (
    <>
      <h2>Demand forecast</h2>
      <p className="muted">Expected ride requests per zone for the next hour, compared with drivers online now. A positive gap means predicted shortage. Confidence stays low until enough real rides exist.</p>
      <Bars rows={zones.map((z) => ({ label: `${z.name} (${z.level})`, value: z.expectedRequests }))} tone={(p) => tone(zones.find((z) => p.label.startsWith(z.name))?.level)} />
      <Table rows={zones.map((z) => ({ ...z, id: z.zoneId }))} cols={[
        { head: 'Zone', cell: (z: any) => z.name }, { head: 'Level', cell: (z: any) => z.level }, { head: 'Expected requests', cell: (z: any) => z.expectedRequests },
        { head: 'Requests last hour', cell: (z: any) => z.recentRequests1h }, { head: 'Drivers online', cell: (z: any) => z.onlineDrivers },
        { head: 'Supply gap', cell: (z: any) => z.supplyGap }, { head: 'Confidence', cell: (z: any) => z.confidence }, { head: 'Model', cell: (z: any) => `${z.model}@${z.version}` },
      ]} />
    </>
  );
}

export function SystemHealth() {
  const { data, error } = useFetch<any>('/admin/system/health', 15000);
  const [page] = useState(1);
  const audit = useFetch<any>(`/admin/audit-logs?page=${page}&pageSize=15`);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const up = (v: unknown) => (v ? 'Up' : 'Down');
  return (
    <>
      <h2>System health</h2>
      <div className="grid">
        <Stat label="Postgres" value={up(data.postgres)} alert={!data.postgres} /><Stat label="Redis" value={up(data.redis)} alert={!data.redis} />
        <Stat label="AI service" value={data.aiService ? 'Up' : 'Down (fallbacks)'} alert={!data.aiService} /><Stat label="Uptime" value={`${Math.round(data.uptimeS / 60)} min`} />
        <Stat label="Memory" value={`${data.memoryMb} MB`} /><Stat label="Migrations" value={data.migrations?.n ?? '–'} />
      </div>
      <h3>Queues</h3>
      <Table rows={Object.entries(data.queues ?? {}).map(([name, c]: [string, any]) => ({ id: name, name, ...c }))} cols={['name', 'waiting', 'active', 'delayed', 'failed'].map((h) => ({ head: h, cell: (r: any) => r[h] ?? 0 }))} />
      <p className="muted">Prometheus metrics (HTTP latency, matching latency, sockets, payment failures, AI latency, queue jobs) are served at <code>/metrics</code>.</p>
      <h3>Recent staff actions</h3>
      {audit.data && <Table rows={audit.data.items} cols={[
        { head: 'When', cell: (a: any) => new Date(a.createdAt).toLocaleString() }, { head: 'Who', cell: (a: any) => a.actorName ?? 'system' },
        { head: 'Action', cell: (a: any) => a.action }, { head: 'Entity', cell: (a: any) => `${a.entityType} ${String(a.entityId ?? '').slice(0, 8)}` }, { head: 'Reason', cell: (a: any) => a.reason ?? '–' },
      ]} />}
    </>
  );
}
