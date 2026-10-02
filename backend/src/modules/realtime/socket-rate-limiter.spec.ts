import { SocketRateLimiter } from './realtime.gateway';

describe('SocketRateLimiter', () => {
  it('allows up to the limit, drops beyond it, then flags abuse', () => {
    const l = new SocketRateLimiter(5, 1000);
    const r = Array.from({ length: 5 }, () => l.hit(0));
    expect(r.every((x) => x === 'ok')).toBe(true);
    expect(l.hit(1)).toBe('limited');
    let last = 'limited';
    for (let i = 0; i < 200; i++) last = l.hit(2);
    expect(last).toBe('abusive');
  });
  it('resets in the next window', () => {
    const l = new SocketRateLimiter(2, 1000);
    l.hit(0); l.hit(0); expect(l.hit(0)).toBe('limited');
    expect(l.hit(1000)).toBe('ok');
  });
});
