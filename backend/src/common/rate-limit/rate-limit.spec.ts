import { canonicalSubject } from './rate-limit';

describe('canonicalSubject', () => {
  it('maps every spelling of one phone number to one bucket', () => {
    const a = canonicalSubject('0300 1234567');
    expect(canonicalSubject('+92 300 1234567')).toBe(a);
    expect(canonicalSubject('+923001234567')).toBe(a);
    expect(canonicalSubject('03001234567')).toBe(a);
  });
  it('is case and whitespace insensitive for emails', () => {
    expect(canonicalSubject('  Bilal@Raasta.Test ')).toBe('bilal@raasta.test');
  });
  it('does not throw on junk', () => {
    expect(canonicalSubject('   ')).toBe('');
    expect(canonicalSubject('a b c')).toBe('abc');
  });
});
