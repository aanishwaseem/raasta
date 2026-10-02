import { post } from './api';
import { useFetch } from './hooks';
import { Badge, Stat, Table, when } from './ui';

const secs = (n: number | null | undefined) => (n == null ? '–' : `${n}s`);

/** Section 47: operational AI view. Accuracy comes from logged predictions compared with what actually happened. */
export function AiOps() {
  const ops = useFetch<any>('/admin/ops/ai', 60000);
  const mon = useFetch<any>('/admin/ai/monitoring');
  const models = useFetch<any>('/admin/ai/models');
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); models.reload(); mon.reload(); } catch (e) { window.alert((e as Error).message); } };
  const o = ops.data;
  return (
    <>
      <h2>AI / ML monitoring</h2>
      {(ops.error || mon.error) && <div className="err">{ops.error ?? mon.error}</div>}
      {o && (
        <div className="grid">
          <Stat label="Match success (7d)" value={o.matching.successRate == null ? '–' : `${Math.round(o.matching.successRate * 100)}%`} />
          <Stat label="Avg match time" value={secs(o.matching.avgSeconds)} /><Stat label="No-driver outcomes" value={o.matching.noDrivers} />
          {o.etaError.map((e: any) => <Stat key={e.kind} label={`${e.kind.replace('_', ' ')} error (MAE, ${e.resolved} resolved)`} value={secs(e.maeSeconds)} />)}
          <Stat label="Expected-match-time error" value={secs(o.expectedMatchTimeError.maeSeconds)} /><Stat label="Open fraud flags" value={o.fraud.open} alert={o.fraud.high > 0} />
          <Stat label="Live socket connections" value={o.liveSockets} />
        </div>
      )}
      {o && <><h3>Predicted shortages</h3>{o.forecast.predictedShortages.length ? <Table rows={o.forecast.predictedShortages.map((s: any) => ({ ...s, id: s.zone }))} cols={[{ head: 'Zone', cell: (s: any) => s.zone }, { head: 'Level', cell: (s: any) => s.level }, { head: 'Supply gap', cell: (s: any) => s.supplyGap }]} /> : <p className="muted">No zone currently predicted short of drivers.</p>}
        <h3>Safety events by type (7d)</h3><Table rows={o.safetyByType.map((s: any) => ({ ...s, id: `${s.type}${s.severity}` }))} cols={[{ head: 'Type', cell: (s: any) => s.type.replaceAll('_', ' ') }, { head: 'Severity', cell: (s: any) => s.severity }, { head: 'Count', cell: (s: any) => s.count }]} /></>}
      <h3>Per-model accuracy and latency</h3>
      {mon.data && <>
        <Table rows={mon.data.perModel.map((m: any) => ({ ...m, id: `${m.kind}${m.model}${m.version}` }))} cols={[
          { head: 'Kind', cell: (m: any) => m.kind }, { head: 'Model', cell: (m: any) => `${m.model}@${m.version}` }, { head: 'Predictions', cell: (m: any) => m.predictions },
          { head: 'Resolved', cell: (m: any) => m.resolved }, { head: 'MAE', cell: (m: any) => m.mae ?? '–' }, { head: 'Fallback %', cell: (m: any) => m.fallbackPct }, { head: 'p50 / p95 ms', cell: (m: any) => `${m.p50Ms ?? '–'} / ${m.p95Ms ?? '–'}` },
        ]} />
        {mon.data.caveats.map((c: string) => <div className="note" key={c}>{c}</div>)}
      </>}
      <h3>Model registry</h3>
      <div className="toolbar">
        <button className="primary" onClick={() => act(() => post('/admin/ai/train', { models: ['eta', 'demand', 'cancellation'] }))}>Train candidates from recorded rides</button>
        {models.data?.serving?.available === false && <span className="muted">{models.data.serving.note}</span>}
      </div>
      {models.data && <Table rows={models.data.registry} cols={[
        { head: 'Model', cell: (m: any) => `${m.name}@${m.version}` }, { head: 'Algorithm', cell: (m: any) => m.algorithm }, { head: 'Status', cell: (m: any) => <Badge v={m.status} /> },
        { head: 'Trained', cell: (m: any) => when(m.trainingDate) }, { head: 'Rows', cell: (m: any) => m.datasetRows ?? '–' },
        { head: 'Data', cell: (m: any) => (m.trainedOnSynthetic ? <span className="badge warn">simulated</span> : 'real') },
        { head: 'Metrics vs baseline', cell: (m: any) => <code>{JSON.stringify(m.metrics)} vs {JSON.stringify(m.baselineMetrics)}</code> },
        { head: '', cell: (m: any) => (m.status === 'CANDIDATE' ? <button onClick={() => { const reason = window.prompt('Activate — reason (audited):'); if (reason && reason.trim().length >= 3) void act(() => post(`/admin/ai/models/${m.id}/activate`, { reason: reason.trim() })); }}>Activate</button> : null) },
      ]} />}
    </>
  );
}
