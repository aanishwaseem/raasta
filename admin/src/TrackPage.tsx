import { useEffect, useState } from 'react';
import { publicGet } from './api';

const LABEL: Record<string, string> = {
  DRIVER_ASSIGNED: 'A driver is on the way to pick them up',
  DRIVER_ARRIVING: 'The driver is arriving at the pickup point',
  DRIVER_ARRIVED: 'The driver has arrived at the pickup point',
  IN_PROGRESS: 'The trip is in progress',
  COMPLETED: 'The trip has finished',
};

/** Public live-trip page for the link a rider shares with family or trusted contacts. Needs no sign-in; the link expires. */
export function TrackPage({ token }: { token: string }) {
  const [t, setT] = useState<any | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => publicGet(`/public/track/${encodeURIComponent(token)}`)
      .then((d) => { if (live) { setT(d); setErr(''); } })
      .catch((e: Error & { status?: number }) => { if (live) setErr(e.status === 404 ? 'This tracking link has expired or is no longer valid.' : 'We could not load the trip right now. Retrying…'); });
    void load();
    const id = setInterval(load, 5000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  const pts = t ? [t.pickup, t.dropoff, t.location].filter((p) => p && Number.isFinite(p.lat)) : [];
  const xs = pts.map((p: any) => p.lng); const ys = pts.map((p: any) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => 30 + ((v - minX) / (maxX - minX || 1)) * 540;
  const sy = (v: number) => 210 - ((v - minY) / (maxY - minY || 1)) * 190;
  const updated = t?.location?.updatedAt ? Math.max(0, Math.round((Date.now() - new Date(t.location.updatedAt).getTime()) / 1000)) : null;

  return (
    <main className="track">
      <h1>Raasta live trip</h1>
      {err && !t && <div className="note">{err}</div>}
      {t && (
        <>
          <p className="lead"><b>{t.passengerFirstName}</b>: {LABEL[t.status] ?? t.status.replaceAll('_', ' ').toLowerCase()}</p>
          {err && <div className="note">{err}</div>}
          <svg className="map" viewBox="0 0 600 230" role="img" aria-label="Trip map">
            <line x1={sx(t.pickup.lng)} y1={sy(t.pickup.lat)} x2={sx(t.dropoff.lng)} y2={sy(t.dropoff.lat)} stroke="var(--muted)" strokeDasharray="5 5" />
            <circle cx={sx(t.pickup.lng)} cy={sy(t.pickup.lat)} r="8" fill="var(--warn)"><title>Pickup</title></circle>
            <rect x={sx(t.dropoff.lng) - 8} y={sy(t.dropoff.lat) - 8} width="16" height="16" fill="var(--danger)"><title>Destination</title></rect>
            {t.location && <circle cx={sx(t.location.lng)} cy={sy(t.location.lat)} r="9" fill="var(--brand)" stroke="#fff" strokeWidth="2"><title>Driver</title></circle>}
          </svg>
          <p className="muted">● driver · <span style={{ color: 'var(--warn)' }}>●</span> pickup · <span style={{ color: 'var(--danger)' }}>■</span> destination{updated != null ? ` · location updated ${updated}s ago` : ''}</p>
          <dl className="kv">
            <dt>From</dt><dd>{t.pickup.address}</dd>
            <dt>To</dt><dd>{t.dropoff.address}</dd>
            {t.driver && <><dt>Driver</dt><dd>{t.driver.firstName}</dd><dt>Vehicle</dt><dd>{t.driver.vehicle}, plate {t.driver.plateNumber}</dd></>}
            {t.etaS != null && t.status !== 'COMPLETED' && <><dt>Estimated time</dt><dd>about {Math.max(1, Math.round(t.etaS / 60))} min</dd></>}
          </dl>
          <p className="muted">Shared by the rider. This page updates every few seconds and stops working when the trip ends.</p>
        </>
      )}
    </main>
  );
}
