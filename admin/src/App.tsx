import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { getSession, login, logout } from './api';
import { Drivers, LiveMap, Overview, Rides, Tickets, Users, Withdrawals } from './pages';
import { Analytics, Demand, SystemHealth } from './pagesInsight';
import { AiOps } from './pagesAi';
import { Corporate, Pricing, ServiceAreas, Vehicles } from './pagesConfig';
import { CorpInvoices, CorpOverview, CorpEmployees, CorpPolicy, CorpRides } from './pagesCorporate';
import { CorpSchedule } from './CorpSchedule';
import { Deliveries } from './pagesDetail';
import { Payments, Promotions, Wallets } from './pagesMoney';
import { Fraud, Safety } from './pagesSafety';

type RouteDef = { label: string; el: () => JSX.Element; group?: string };

const STAFF: Record<string, RouteDef> = {
  overview: { label: 'Overview', el: Overview, group: 'Operations' },
  map: { label: 'Live map', el: LiveMap },
  rides: { label: 'Rides', el: Rides },
  deliveries: { label: 'Deliveries', el: Deliveries },
  safety: { label: 'Safety', el: Safety },
  support: { label: 'Support', el: Tickets },
  users: { label: 'Users', el: Users, group: 'People' },
  drivers: { label: 'Drivers', el: Drivers },
  vehicles: { label: 'Vehicles', el: Vehicles },
  fraud: { label: 'Fraud', el: Fraud },
  payments: { label: 'Payments', el: Payments, group: 'Money' },
  wallets: { label: 'Wallets', el: Wallets },
  withdrawals: { label: 'Withdrawals', el: Withdrawals },
  promotions: { label: 'Promotions', el: Promotions },
  analytics: { label: 'Analytics', el: Analytics, group: 'Intelligence' },
  demand: { label: 'Demand', el: Demand },
  ai: { label: 'AI / ML monitoring', el: AiOps },
  pricing: { label: 'Pricing', el: Pricing, group: 'Configuration' },
  areas: { label: 'Service areas', el: ServiceAreas },
  corporate: { label: 'Corporate accounts', el: Corporate },
  health: { label: 'System health', el: SystemHealth },
};

const CORPORATE: Record<string, RouteDef> = {
  overview: { label: 'Overview', el: CorpOverview, group: 'Company' },
  employees: { label: 'Employees', el: CorpEmployees },
  policy: { label: 'Policy and budget', el: CorpPolicy },
  schedule: { label: 'Schedule a ride', el: CorpSchedule },
  rides: { label: 'Rides', el: CorpRides },
  invoices: { label: 'Invoices', el: CorpInvoices },
};

/** Staff see the operations console; a company administrator (without staff roles) sees only the corporate portal. */
const SUPPORT_PAGES = ['map', 'rides', 'deliveries', 'safety', 'support', 'users', 'drivers', 'vehicles'];
const SUPPORT: Record<string, RouteDef> = { ...Object.fromEntries(SUPPORT_PAGES.map((k) => [k, STAFF[k]])), };
SUPPORT.map = { ...STAFF.map, group: 'Operations' };
SUPPORT.users = { ...STAFF.users, group: 'People' };

/** Support agents get the pages their API permissions allow (no money, pricing, AI or configuration). */
export const routesFor = (roles: string[] = []) => (roles.includes('ADMIN') || !roles.length ? STAFF : roles.includes('SUPPORT') ? SUPPORT : CORPORATE);

function Login({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(id, pw); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>Raasta Console</h1>
      <input placeholder="Email or phone" value={id} onChange={(e) => setId(e.target.value)} autoFocus />
      <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button className="primary" disabled={busy || !id || !pw}>Sign in</button>
    </form>
  );
}

export function App() {
  const [session, setSession] = useState(getSession());
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'overview');
  useEffect(() => {
    const h = () => setRoute(location.hash.slice(1) || 'overview');
    const out = () => setSession(null);
    window.addEventListener('hashchange', h);
    window.addEventListener('raasta:logout', out);
    return () => { window.removeEventListener('hashchange', h); window.removeEventListener('raasta:logout', out); };
  }, []);
  if (!session) return <Login onDone={() => setSession(getSession())} />;
  const routes = routesFor(session.roles);
  const Page = (routes[route] ?? Object.values(routes)[0]).el;
  return (
    <div className="shell">
      <nav>
        <h1>Raasta</h1>
        {Object.entries(routes).map(([k, v]) => <Fragment key={k}>{v.group && <div className="grp">{v.group}</div>}<a href={`#${k}`} className={k === route ? 'on' : ''}>{v.label}</a></Fragment>)}
        <div className="who">{session.name}<br /><a href="#" onClick={async (e) => { e.preventDefault(); await logout(); setSession(null); }}>Sign out</a></div>
      </nav>
      <main><Page /></main>
    </div>
  );
}
