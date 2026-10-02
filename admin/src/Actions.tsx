import { useState } from 'react';
import { patch, post } from './api';

/** Button that asks for the audit reason (required by the API for every staff action) and posts it. */
export function ReasonButton({ label, path, danger, onDone, extra, method = 'POST' }: { label: string; path: string; danger?: boolean; onDone: () => void; extra?: Record<string, unknown>; method?: 'POST' | 'PATCH' }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className={danger ? 'danger' : 'primary'} disabled={busy} onClick={async () => {
      const reason = window.prompt(`${label} — reason (kept in the audit log):`);
      if (!reason || reason.trim().length < 3) return;
      setBusy(true);
      try { await (method === 'PATCH' ? patch : post)(path, { reason: reason.trim(), ...extra }); onDone(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
    }}>{label}</button>
  );
}
