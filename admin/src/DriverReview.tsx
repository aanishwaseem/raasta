import { useState } from 'react';
import { fileUrl, post } from './api';
import { useFetch } from './hooks';
import { Badge, when } from './ui';

const ask = (label: string) => {
  const r = window.prompt(`${label} — reason (kept in the audit log):`);
  return r && r.trim().length >= 3 ? r.trim() : null;
};

/** Modal for reviewing a driver application: documents (viewable, approve/reject), vehicles, then the driver decision. */
export function DriverReview({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: d, error, reload } = useFetch<any>(`/admin/drivers/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (path: string, body: object, close = false) => {
    setBusy(true); setMsg(null);
    try { await post(path, body); reload(); onChanged(); if (close) onClose(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const view = async (docId: string) => {
    try { window.open(await fileUrl(`/admin/documents/${docId}/file`), '_blank', 'noopener'); } catch (e) { setMsg((e as Error).message); }
  };
  const review = (path: string, label: string, decision: 'APPROVED' | 'REJECTED') => {
    const reason = decision === 'APPROVED' ? `${label} checked` : ask(`Reject ${label}`);
    if (reason) void act(path, { decision, reason });
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Driver review">
        <div className="toolbar"><h2 style={{ margin: 0, flex: 1 }}>{d?.fullName ?? 'Driver'}</h2><button onClick={onClose}>Close</button></div>
        {error && <div className="err">{error}</div>}
        {msg && <div className="err">{msg}</div>}
        {!d ? <p className="muted">Loading…</p> : (
          <>
            <p className="muted">{d.phone ?? '–'} · CNIC ending {d.cnicLast4 ?? '–'} · status <Badge v={d.status} /></p>
            <h3>Documents</h3>
            {d.documents.length === 0 && <p className="muted">No documents uploaded.</p>}
            <div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Uploaded</th><th /></tr></thead><tbody>
              {d.documents.map((x: any) => (
                <tr key={x.id}>
                  <td>{x.docType.replaceAll('_', ' ')}</td>
                  <td><Badge v={x.status} />{x.rejectionReason && <div className="muted">{x.rejectionReason}</div>}</td>
                  <td>{when(x.uploadedAt)}</td>
                  <td><div className="toolbar">
                    <button onClick={() => view(x.id)}>View</button>
                    {x.status === 'PENDING' && <>
                      <button className="primary" disabled={busy} onClick={() => review(`/admin/documents/${x.id}/review`, x.docType, 'APPROVED')}>Approve</button>
                      <button className="danger" disabled={busy} onClick={() => review(`/admin/documents/${x.id}/review`, x.docType, 'REJECTED')}>Reject</button>
                    </>}
                  </div></td>
                </tr>
              ))}
            </tbody></table></div>
            <h3>Vehicles</h3>
            {d.vehicles.length === 0 && <p className="muted">No vehicle added.</p>}
            {d.vehicles.map((v: any) => (
              <div key={v.id} className="toolbar">
                <span>{v.year} {v.make} {v.model} · {v.color} · {v.plateNumber} · {v.vehicleClass}</span> <Badge v={v.status} />
                {v.status === 'PENDING' && <>
                  <button className="primary" disabled={busy} onClick={() => review(`/admin/vehicles/${v.id}/review`, 'vehicle', 'APPROVED')}>Approve</button>
                  <button className="danger" disabled={busy} onClick={() => review(`/admin/vehicles/${v.id}/review`, 'vehicle', 'REJECTED')}>Reject</button>
                </>}
              </div>
            ))}
            {d.status === 'PENDING_REVIEW' && (
              <div className="toolbar" style={{ marginTop: 16 }}>
                <button className="primary" disabled={busy} onClick={() => { const r = ask('Approve driver'); if (r) void act(`/admin/drivers/${id}/approve`, { reason: r }, true); }}>Approve driver</button>
                <button className="danger" disabled={busy} onClick={() => { const r = ask('Reject driver'); if (r) void act(`/admin/drivers/${id}/reject`, { reason: r }, true); }}>Reject driver</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
