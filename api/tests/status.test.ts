import { describe, it, expect } from 'vitest';
import { STATUSES, type Status } from '../src/db/schema.js';
import {
  canTransition,
  assertTransition,
  isTerminal,
  TransitionError,
  TAB_STATUSES,
} from '../src/lib/status.js';

describe('status transitions', () => {
  it('allows a reviewer decision from processing', () => {
    expect(canTransition('processing', 'approved')).toBe(true);
    expect(canTransition('processing', 'rejected')).toBe(true);
  });

  it('allows a reviewer decision from needs_review', () => {
    expect(canTransition('needs_review', 'approved')).toBe(true);
    expect(canTransition('needs_review', 'rejected')).toBe(true);
  });

  it('treats approved and rejected as terminal', () => {
    expect(isTerminal('approved')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
    expect(canTransition('approved', 'rejected')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('approved', 'processing')).toBe(false);
  });

  it('does not let an invoice move back into a queue', () => {
    expect(canTransition('needs_review', 'processing')).toBe(false);
    expect(canTransition('processing', 'needs_review')).toBe(false);
  });

  it('rejects setting the same status twice', () => {
    expect(canTransition('processing', 'processing')).toBe(false);
    expect(canTransition('approved', 'approved')).toBe(false);
  });

  it('throws TransitionError carrying both ends of the attempted move', () => {
    expect(() => assertTransition('approved', 'rejected')).toThrow(TransitionError);

    try {
      assertTransition('approved', 'rejected');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TransitionError);
      expect((err as TransitionError).message).toContain('terminal');
      expect((err as TransitionError).from).toBe('approved');
      expect((err as TransitionError).to).toBe('rejected');
    }
  });

  it('does not throw on a legal move', () => {
    expect(() => assertTransition('processing', 'approved')).not.toThrow();
    expect(() => assertTransition('needs_review', 'rejected')).not.toThrow();
  });
});

describe('tab mapping', () => {
  it('maps the three tabs named in the brief', () => {
    expect(TAB_STATUSES['processing']).toEqual(['processing']);
    expect(TAB_STATUSES['needs-review']).toEqual(['needs_review']);
    expect(TAB_STATUSES['approved-rejected']).toEqual(['approved', 'rejected']);
  });

  it('covers every status across the three tabs, with none appearing twice', () => {
    const all = Object.values(TAB_STATUSES).flat() as Status[];
    expect(new Set(all).size).toBe(all.length);
    for (const s of STATUSES) expect(all).toContain(s);
  });
});
