import { useState } from 'react';
import { api, post } from './api';
import { Field, FormBox } from './forms';
import { useFetch } from './hooks';

interface Place { name: string; address: string | null; location: { lat: number; lng: number } }

/** Type-ahead against the places search API; the chosen place supplies the coordinates the ride needs. */
function PlacePick({ label, value, onPick }: { label: string; value: Place | null; onPick: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Place[]>([]);
  const search = async (text: string) => { setQ(text); setRes(text.trim().length >= 2 ? await api<Place[]>(`/places/search?q=${encodeURIComponent(text)}`).catch(() => []) : []); };
  return (
    <Field label={label}>
      <input value={value && !q ? value.name : q} onChange={(e) => void search(e.target.value)} placeholder="Search a place" />
      {res.length > 0 && <select size={Math.min(res.length, 5)} onChange={(e) => { onPick(res[Number(e.target.value)]); setQ(''); setRes([]); }}>{res.map((p, i) => <option key={`${p.name}${i}`} value={i}>{p.name}{p.address ? `, ${p.address}` : ''}</option>)}</select>}
    </Field>
  );
}

/** Office commute: schedule a company-paid ride for an employee (policy and budget are enforced by the API). */
export function CorpSchedule() {
  const emps = useFetch<any[]>('/corporate/employees');
  const [f, setF] = useState({ employeeId: '', productCode: 'ECONOMY', pickupAt: '', tripPurpose: '' });
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [done, setDone] = useState('');
  const submit = async () => {
    if (!pickup || !dropoff) throw new Error('Choose a pickup and a drop-off place.');
    const pl = (p: Place) => ({ lat: p.location.lat, lng: p.location.lng, address: p.address ?? p.name });
    await post('/corporate/scheduled-rides', { employeeId: f.employeeId, productCode: f.productCode, pickupAt: new Date(f.pickupAt).toISOString(), tripPurpose: f.tripPurpose || undefined, pickup: pl(pickup), dropoff: pl(dropoff) });
    setDone('Scheduled. The employee has been notified and the ride dispatches automatically before pickup time.');
  };
  return (
    <>
      <h2>Schedule an employee ride</h2>
      {done && <div className="note">{done}</div>}
      <FormBox title="Company-paid ride" submit="Schedule" onSubmit={submit}>
        <Field label="Employee"><select required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{(emps.data ?? []).filter((e) => e.active).map((e) => <option key={e.userId} value={e.userId}>{e.name}</option>)}</select></Field>
        <PlacePick label="Pickup" value={pickup} onPick={setPickup} />
        <PlacePick label="Drop-off" value={dropoff} onPick={setDropoff} />
        <Field label="Ride type"><select value={f.productCode} onChange={(e) => setF({ ...f, productCode: e.target.value })}>{['BIKE', 'ECONOMY', 'COMFORT', 'PREMIUM', 'XL'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Pickup time"><input required type="datetime-local" value={f.pickupAt} onChange={(e) => setF({ ...f, pickupAt: e.target.value })} /></Field>
        <Field label="Trip purpose"><input value={f.tripPurpose} onChange={(e) => setF({ ...f, tripPurpose: e.target.value })} /></Field>
      </FormBox>
    </>
  );
}
