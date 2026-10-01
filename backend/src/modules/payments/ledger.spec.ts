import { assertBalanced } from './ledger.service';
import { computeDiscount } from '../promotions/promotions.service';
import { platformFee } from '../pricing/pricing.engine';

describe('ledger invariants', () => {
  it('accepts balanced postings', () => {
    expect(() =>
      assertBalanced([
        { walletId: 'passenger', amount: -400 },
        { walletId: 'driver', amount: 340, bucket: 'PENDING' },
        { walletId: 'revenue', amount: 60 },
      ]),
    ).not.toThrow();
  });

  it('rejects unbalanced, single-entry and fractional postings', () => {
    expect(() => assertBalanced([{ walletId: 'a', amount: -10 }, { walletId: 'b', amount: 9 }])).toThrow(/Unbalanced/);
    expect(() => assertBalanced([{ walletId: 'a', amount: 10 }])).toThrow(/two/);
    expect(() => assertBalanced([{ walletId: 'a', amount: -0.5 }, { walletId: 'b', amount: 0.5 }])).toThrow(/integers/);
  });

  it('wallet ride settlement with a promo balances and pays the driver the full fare minus fee', () => {
    const fare = 400;
    const discount = computeDiscount({ discount_type: 'PERCENT', discount_value: 20, max_discount: 50 }, fare);
    expect(discount).toBe(50); // 20% = 80, capped at 50
    const fee = platformFee(fare, 15);
    const entries = [
      { walletId: 'passenger', amount: -(fare - discount) },
      { walletId: 'promotions', amount: -discount },
      { walletId: 'driver', amount: fare - fee },
      { walletId: 'revenue', amount: fee },
    ];
    expect(() => assertBalanced(entries)).not.toThrow();
    expect(entries[2].amount).toBe(340);
  });

  it('cash ride: driver owes the fee and is reimbursed the promo', () => {
    const fare = 300;
    const discount = computeDiscount({ discount_type: 'FLAT', discount_value: 100, max_discount: null }, fare);
    const fee = platformFee(fare, 15);
    expect(() =>
      assertBalanced([
        { walletId: 'driver', amount: -fee + discount },
        { walletId: 'revenue', amount: fee },
        { walletId: 'promotions', amount: -discount },
      ]),
    ).not.toThrow();
  });

  it('discount never exceeds the fare', () => {
    expect(computeDiscount({ discount_type: 'FLAT', discount_value: 500, max_discount: null }, 300)).toBe(300);
  });
});
