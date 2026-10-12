import { describe, it, expect } from 'vitest';
import { formatMoney, formatDate, formatDateTime, daysUntilDue } from './format';

describe('formatMoney', () => {
  it('formats USD with two decimals and a thousands separator', () => {
    expect(formatMoney(8620, 'USD')).toBe('$8,620.00');
  });

  it('keeps cents visible', () => {
    expect(formatMoney(4399.5, 'USD')).toBe('$4,399.50');
  });

  it('degrades gracefully on an unknown currency code', () => {
    expect(formatMoney(100, 'NOTACURRENCY')).toBe('100.00 NOTACURRENCY');
  });
});

describe('formatDate', () => {
  it('formats an ISO date', () => {
    expect(formatDate('2026-10-01T00:00:00.000Z')).toBe('1 Oct 2026');
  });

  it('renders an em dash for null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('renders an em dash for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('includes the time', () => {
    expect(formatDateTime('2026-10-01T14:30:00.000Z')).toContain('1 Oct 2026');
    expect(formatDateTime('2026-10-01T14:30:00.000Z')).toContain('14:30');
  });
});

describe('daysUntilDue', () => {
  const now = new Date('2026-10-12T09:00:00.000Z');

  it('returns a positive number for a future due date', () => {
    expect(daysUntilDue('2026-10-22T00:00:00.000Z', now)).toBe(10);
  });

  it('returns a negative number when overdue', () => {
    expect(daysUntilDue('2026-10-02T00:00:00.000Z', now)).toBe(-10);
  });

  it('returns zero on the due date itself, ignoring time of day', () => {
    expect(daysUntilDue('2026-10-12T23:00:00.000Z', now)).toBe(0);
  });

  it('returns null when there is no due date', () => {
    expect(daysUntilDue(null, now)).toBeNull();
  });
});
