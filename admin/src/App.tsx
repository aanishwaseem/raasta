import { useEffect, useState, type FormEvent } from 'react';
import { getSession, login, logout } from './api';
import { Drivers, LiveMap, Overview, Rides, Tickets, Users, Withdrawals } from './pages';

const ROUTES: Record<string, { label: string; el: () => JSX.Element }> = {
  overview: { label: 'Overview', el: Overview },
  map: { label: 'Live map', el: LiveMap },
  drivers: { label: 'Drivers', el: Drivers },
  users: { label: 'Users', el: Users },
  rides: { label: 'Rides', el: Rides },
  withdrawals: { label: 'Withdrawals', el: Withdrawals },
  support: { label: 'Support', el: Tickets },
};

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
      <h1>Raasta Admin</h1>
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
  const Page = (ROUTES[route] ?? ROUTES.overview).el;
  return (
    <div className="shell">
      <nav>
        <h1>Raasta</h1>
        {Object.entries(ROUTES).map(([k, v]) => <a key={k} href={`#${k}`} className={k === route ? 'on' : ''}>{v.label}</a>)}
        <div className="who">{session.name}<br /><a href="#" onClick={async (e) => { e.preventDefault(); await logout(); setSession(null); }}>Sign out</a></div>
      </nav>
      <main><Page /></main>
    </div>
  );
}
