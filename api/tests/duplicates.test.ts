import { describe, it, expect } from 'vitest';
import { findDuplicate, normaliseVendor, type InvoiceLike } from '../src/lib/duplicates.js';

const base = (over: Partial<InvoiceLike> & { id: string }): InvoiceLike => ({
  vendorName: 'Baytown Electrical Contractors',
  invoiceNumber: 'BEC-7781',
  amountCents: 862000,
  invoiceDate: new Date('2026-10-01'),
  ...over,
});

describe('normaliseVendor', () => {
  it('folds case, punctuation and company suffixes', () => {
    expect(normaliseVendor('Baytown Electrical Contractors, Inc.')).toBe(
      normaliseVendor('baytown electrical contractors'),
    );
    expect(normaliseVendor('Cedar Ridge Lumber Co.')).toBe(
      normaliseVendor('CEDAR RIDGE LUMBER'),
    );
  });

  it('keeps genuinely different vendors apart', () => {
    expect(normaliseVendor('Northside Concrete')).not.toBe(
      normaliseVendor('Southside Concrete'),
    );
  });
});

describe('findDuplicate — EXACT_REFERENCE', () => {
  it('flags same vendor and same invoice number', () => {
    const existing = [base({ id: 'inv-1' })];
    const candidate = base({ id: 'inv-2' });

    const match = findDuplicate(candidate, existing);

    expect(match).not.toBeNull();
    expect(match!.rule).toBe('EXACT_REFERENCE');
    expect(match!.matchedInvoiceId).toBe('inv-1');
  });

  it('still matches when the vendor name is spelled differently', () => {
    const existing = [base({ id: 'inv-1', vendorName: 'Baytown Electrical Contractors' })];
    const candidate = base({ id: 'inv-2', vendorName: 'Baytown Electrical Contractors, Inc.' });

    expect(findDuplicate(candidate, existing)?.rule).toBe('EXACT_REFERENCE');
  });

  it('is case and whitespace insensitive on the invoice number', () => {
    const existing = [base({ id: 'inv-1', invoiceNumber: 'BEC-7781' })];
    const candidate = base({ id: 'inv-2', invoiceNumber: '  bec-7781 ' });

    expect(findDuplicate(candidate, existing)?.rule).toBe('EXACT_REFERENCE');
  });

  it('does not flag the same invoice number from a different vendor', () => {
    const existing = [base({ id: 'inv-1', vendorName: 'Northside Concrete Supply' })];
    const candidate = base({ id: 'inv-2', vendorName: 'Harlow Plumbing' });

    expect(findDuplicate(candidate, existing)).toBeNull();
  });
});

describe('findDuplicate — SAME_VENDOR_AMOUNT_DATE', () => {
  it('flags a rekeyed invoice under a new reference', () => {
    const existing = [base({ id: 'inv-1', invoiceNumber: 'BEC-7781' })];
    const candidate = base({ id: 'inv-2', invoiceNumber: 'BEC-7781-R' });

    const match = findDuplicate(candidate, existing);

    expect(match?.rule).toBe('SAME_VENDOR_AMOUNT_DATE');
    expect(match?.matchedInvoiceId).toBe('inv-1');
  });

  it('does not flag when the amount differs', () => {
    const existing = [base({ id: 'inv-1', amountCents: 862000 })];
    const candidate = base({ id: 'inv-2', invoiceNumber: 'BEC-9999', amountCents: 431000 });

    expect(findDuplicate(candidate, existing)).toBeNull();
  });

  it('does not flag the same amount on a different date', () => {
    const existing = [base({ id: 'inv-1', invoiceDate: new Date('2026-10-01') })];
    const candidate = base({
      id: 'inv-2',
      invoiceNumber: 'BEC-9999',
      invoiceDate: new Date('2026-11-01'),
    });

    expect(findDuplicate(candidate, existing)).toBeNull();
  });

  it('ignores time of day when comparing invoice dates', () => {
    const existing = [base({ id: 'inv-1', invoiceDate: new Date('2026-10-01T08:00:00Z') })];
    const candidate = base({
      id: 'inv-2',
      invoiceNumber: 'BEC-9999',
      invoiceDate: new Date('2026-10-01T19:30:00Z'),
    });

    expect(findDuplicate(candidate, existing)?.rule).toBe('SAME_VENDOR_AMOUNT_DATE');
  });
});

describe('findDuplicate — general behaviour', () => {
  it('returns null against an empty desk', () => {
    expect(findDuplicate(base({ id: 'inv-1' }), [])).toBeNull();
  });

  it('never matches an invoice against itself', () => {
    const self = base({ id: 'inv-1' });
    expect(findDuplicate(self, [self])).toBeNull();
  });

  it('prefers EXACT_REFERENCE when both rules could fire', () => {
    const weaker = base({ id: 'weak', invoiceNumber: 'BEC-0001' });
    const exact = base({ id: 'exact', invoiceNumber: 'BEC-7781' });
    const candidate = base({ id: 'new', invoiceNumber: 'BEC-7781' });

    const match = findDuplicate(candidate, [weaker, exact]);

    expect(match?.rule).toBe('EXACT_REFERENCE');
    expect(match?.matchedInvoiceId).toBe('exact');
  });
});
