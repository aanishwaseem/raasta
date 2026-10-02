import { JsonLogger } from './json-logger';

describe('JsonLogger', () => {
  it('writes one parseable JSON object per line, keeps context, and honours the minimum level', () => {
    const out: string[] = [];
    const err: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    const l = new JsonLogger('warn');
    l.log('hidden', 'X');
    l.warn('careful', 'Matching');
    l.error(new Error('boom'), undefined, 'Pay');
    l.access({ requestId: 'req-1', status: 200, durationMs: 12 });
    jest.restoreAllMocks();
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0])).toMatchObject({ level: 'warn', context: 'Matching', msg: 'careful' });
    expect(JSON.parse(out[1])).toMatchObject({ context: 'http', requestId: 'req-1', status: 200 });
    expect(JSON.parse(err[0])).toMatchObject({ level: 'error', msg: 'boom', context: 'Pay' });
    expect(JSON.parse(err[0]).stack).toContain('boom');
  });
});
