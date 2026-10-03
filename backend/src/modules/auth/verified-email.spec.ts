import { verifiedEmail } from './auth.service';

describe('verifiedEmail', () => {
  it('trusts only provider-verified addresses', () => {
    expect(verifiedEmail({ email: 'A@B.com', email_verified: true })).toBe('a@b.com');
    expect(verifiedEmail({ email: 'A@B.com', email_verified: 'true' })).toBe('a@b.com');
    expect(verifiedEmail({ email: 'a@b.com' })).toBeNull();
    expect(verifiedEmail({ email: 'a@b.com', email_verified: false })).toBeNull();
    expect(verifiedEmail({ email: 'a@b.com', email_verified: 'false' })).toBeNull();
    expect(verifiedEmail({ email_verified: true })).toBeNull();
  });
});
