import { useState } from 'react';
import { patch, post } from './api';
import { FormBox, Field } from './forms';
import { useFetch } from './hooks';
import { Badge, ListPage, Table, money, when } from './ui';

export const Payments = () => (
  <ListPage<any> title="Payments" path="/admin/payments"
    filters={[{ key: 'status', label: 'Status', options: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] }, { key: 'method', label: 'Method', options: ['CASH', 'WALLET', 'CARD', 'CORPORATE'] }]}
    cols={() => [
      { head: 'When', cell: (r) => when(r.createdAt) },
      { head: 'Purpose', cell: (r) => r.purpose },
      { head: 'Method', cell: (r) => `${r.method}${r.provider ? ` · ${r.provider}` : ''}` },
      { head: 'Amount', cell: (r) => money(r.amount) },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Failure', cell: (r) => r.failureReason ?? '–' },
      { head: 'Ride', cell: (r) => (r.rideId ? r.rideId.slice(0, 8) : '–') },
    ]} />
);

/** Wallet balances come from the immutable ledger; the drawer lists the entries behind a balance. */
export function Wallets() {
  const [open, setOpen] = useState<any | null>(null);
  return (
    <>
      <ListPage<any> title="Wallets" path="/admin/wallets"
        filters={[{ key: 'ownerType', label: 'Owner', options: ['PASSENGER', 'DRIVER', 'CORPORATE', 'PLATFORM_REVENUE', 'PLATFORM_CASH_CLEARING', 'PAYMENT_GATEWAY', 'PROMOTIONS'] }]}
        cols={() => [
          { head: 'Owner', cell: (r) => r.owner },
          { head: 'Type', cell: (r) => r.ownerType.replaceAll('_', ' ') },
          { head: 'Available', cell: (r) => money(r.available) },
          { head: 'Pending', cell: (r) => money(r.pending) },
          { head: 'Entries', cell: (r) => r.entries },
          { head: '', cell: (r) => <button onClick={() => setOpen(r)}>Ledger</button> },
        ]} />
      {open && <Ledger wallet={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Ledger({ wallet, onClose }: { wallet: any; onClose: () => void }) {
  const { data, error } = useFetch<any>(`/admin/wallets/${wallet.id}/ledger?pageSize=50`);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="toolbar"><h2 style={{ margin: 0 }}>Ledger · {wallet.owner}</h2><button onClick={onClose}>Close</button></div>
        {error && <div className="err">{error}</div>}
        {data && <Table rows={(data.items ?? []).map((t: any, i: number) => ({ ...t, id: String(t.id ?? i) }))} cols={[
          { head: 'When', cell: (t: any) => when(t.createdAt) },
          { head: 'Kind', cell: (t: any) => t.kind },
          { head: 'Description', cell: (t: any) => t.description },
          { head: 'Bucket', cell: (t: any) => t.bucket },
          { head: 'Amount', cell: (t: any) => money(t.amount) },
        ]} />}
      </div>
    </div>
  );
}

const blank = { code: '', name: '', kind: 'PROMO', discountType: 'PERCENT', discountValue: '10', maxDiscount: '', minFare: '0', startsAt: '', endsAt: '', usageLimitTotal: '', usageLimitPerUser: '1', newUsersOnly: false, productCodes: '' };

export function Promotions() {
  const { data, error, reload } = useFetch<any[]>('/admin/promotions');
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank, v: string | boolean) => setF({ ...f, [k]: v });
  const num = (s: string) => (s === '' ? undefined : Number(s));
  const create = async () => {
    await post('/admin/promotions', {
      code: f.code.trim().toUpperCase(), name: f.name, kind: f.kind, discountType: f.discountType, discountValue: Number(f.discountValue), maxDiscount: num(f.maxDiscount), minFare: num(f.minFare),
      startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), usageLimitTotal: num(f.usageLimitTotal), usageLimitPerUser: num(f.usageLimitPerUser) ?? 1,
      newUsersOnly: f.newUsersOnly, productCodes: f.productCodes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    });
    setF(blank); reload();
  };
  return (
    <>
      <h2>Promotions and referrals</h2>
      <FormBox title="New promotion" submit="Create" onSubmit={create}>
        <Field label="Code (A-Z, 0-9)"><input required value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Name"><input required value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Kind"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{['PROMO', 'FIRST_RIDE', 'CORPORATE', 'CAMPAIGN', 'REFERRAL'].map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Discount type"><select value={f.discountType} onChange={(e) => set('discountType', e.target.value)}><option>PERCENT</option><option>FLAT</option></select></Field>
        <Field label="Discount value"><input required type="number" min="1" value={f.discountValue} onChange={(e) => set('discountValue', e.target.value)} /></Field>
        <Field label="Max discount (Rs)"><input type="number" min="1" value={f.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} /></Field>
        <Field label="Min fare (Rs)"><input type="number" min="0" value={f.minFare} onChange={(e) => set('minFare', e.target.value)} /></Field>
        <Field label="Starts"><input required type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
        <Field label="Ends"><input required type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
        <Field label="Total usage limit"><input type="number" min="1" value={f.usageLimitTotal} onChange={(e) => set('usageLimitTotal', e.target.value)} /></Field>
        <Field label="Per-user limit"><input type="number" min="1" value={f.usageLimitPerUser} onChange={(e) => set('usageLimitPerUser', e.target.value)} /></Field>
        <Field label="Ride types (comma, empty = all)"><input value={f.productCodes} onChange={(e) => set('productCodes', e.target.value)} placeholder="ECONOMY,COMFORT" /></Field>
        <Field label="New users only"><input type="checkbox" checked={f.newUsersOnly} onChange={(e) => set('newUsersOnly', e.target.checked)} /></Field>
      </FormBox>
      {error && <div className="err">{error}</div>}
      {data && <Table rows={data} cols={[
        { head: 'Code', cell: (p: any) => <b>{p.code}</b> }, { head: 'Name', cell: (p: any) => p.name }, { head: 'Kind', cell: (p: any) => p.kind },
        { head: 'Discount', cell: (p: any) => (p.discountType === 'PERCENT' ? `${p.discountValue}%${p.maxDiscount ? ` (max ${money(p.maxDiscount)})` : ''}` : money(p.discountValue)) },
        { head: 'Window', cell: (p: any) => `${when(p.startsAt)} → ${when(p.endsAt)}` },
        { head: 'Used', cell: (p: any) => `${p.redemptions}${p.usageLimitTotal ? ` / ${p.usageLimitTotal}` : ''}` },
        { head: 'Active', cell: (p: any) => <input type="checkbox" checked={p.active} aria-label={`Toggle ${p.code}`} onChange={async (e) => { try { await patch(`/admin/promotions/${p.id}`, { active: e.target.checked }); reload(); } catch (x) { window.alert((x as Error).message); } }} /> },
      ]} />}
    </>
  );
}
