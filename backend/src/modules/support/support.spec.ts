import { triage } from './support.service';

describe('support triage', () => {
  it('marks safety issues urgent', () => {
    expect(triage('SAFETY', 'driver took a wrong turn')).toBe('URGENT');
    expect(triage('OTHER', 'I felt unsafe in the car')).toBe('URGENT');
  });
  it('marks payment problems high and app bugs low', () => {
    expect(triage('PAYMENT', 'refund please')).toBe('HIGH');
    expect(triage('APP_ISSUE', 'screen flickers')).toBe('LOW');
    expect(triage('FARE', 'fare was higher than expected')).toBe('NORMAL');
  });
});
