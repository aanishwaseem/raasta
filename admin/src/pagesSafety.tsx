import { post } from './api';
import { ListPage, Badge, when } from './ui';

const ask = (msg: string) => { const n = window.prompt(msg); return n && n.trim().length >= 3 ? n.trim() : null; };

export const Safety = () => (
  <ListPage<any> title="Safety events" path="/admin/safety/events"
    filters={[{ key: 'status', label: 'Status', options: ['OPEN', 'ESCALATED', 'RESOLVED', 'FALSE_POSITIVE'] }]}
    cols={(reload) => [
      { head: 'When', cell: (r) => when(r.createdAt) },
      { head: 'Type', cell: (r) => r.type.replaceAll('_', ' ') },
      { head: 'Severity', cell: (r) => <Badge v={r.severity === 'CRITICAL' ? 'URGENT' : r.severity} /> },
      { head: 'Passenger', cell: (r) => r.userName ?? '–' },
      { head: 'Passenger said', cell: (r) => r.passengerResponse ?? 'no response yet' },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Actions', cell: (r) => !['OPEN', 'ESCALATED'].includes(r.status) ? (r.resolutionNote ?? null) : (
        <div className="toolbar">
          {(['RESOLVED', 'FALSE_POSITIVE', 'ESCALATED'] as const).filter((s) => s !== r.status).map((status) => (
            <button key={status} className={status === 'ESCALATED' ? 'danger' : ''} onClick={async () => {
              const note = ask(`${status.replace('_', ' ')} — note for the record:`);
              if (!note) return;
              try { await post(`/admin/safety/events/${r.id}/resolve`, { status, note }); reload(); } catch (e) { window.alert((e as Error).message); }
            }}>{status === 'FALSE_POSITIVE' ? 'False alarm' : status === 'RESOLVED' ? 'Resolve' : 'Escalate'}</button>))}
        </div>) },
    ]} />
);

/** Fraud flags are signals for a human: the decision is always an admin's, and is audited. */
export const Fraud = () => (
  <ListPage<any> title="Fraud and abuse flags" path="/admin/fraud/events"
    filters={[{ key: 'status', label: 'Status', options: ['OPEN', 'DISMISSED', 'ACTIONED'] }, { key: 'level', label: 'Risk', options: ['LOW', 'MEDIUM', 'HIGH'] }]}
    extra={<button onClick={async () => { try { const r = await post('/admin/fraud/scan', {}); window.alert(`Scan finished: ${JSON.stringify(r)}`); } catch (e) { window.alert((e as Error).message); } }}>Run rule scan</button>}
    cols={(reload) => [
      { head: 'When', cell: (r) => when(r.createdAt) },
      { head: 'User', cell: (r) => r.userName },
      { head: 'Rule', cell: (r) => r.rule },
      { head: 'Risk', cell: (r) => <Badge v={r.level} /> },
      { head: 'Evidence', cell: (r) => <code>{JSON.stringify(r.details)}</code> },
      { head: 'Status', cell: (r) => <Badge v={r.status} /> },
      { head: 'Actions', cell: (r) => r.status !== 'OPEN' ? (r.reviewNote ?? null) : (
        <div className="toolbar">
          {(['DISMISSED', 'ACTIONED'] as const).map((decision) => (
            <button key={decision} className={decision === 'ACTIONED' ? 'danger' : ''} onClick={async () => {
              const note = ask(`${decision === 'ACTIONED' ? 'Mark as actioned' : 'Dismiss'} — reason:`);
              if (!note) return;
              try { await post(`/admin/fraud/events/${r.id}/review`, { decision, note }); reload(); } catch (e) { window.alert((e as Error).message); }
            }}>{decision === 'ACTIONED' ? 'Actioned' : 'Dismiss'}</button>))}
        </div>) },
    ]} />
);
