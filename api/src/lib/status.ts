import type { Status } from '../db/schema.js';

/**
 * Status transition rules.
 *
 * The brief names three tabs (Processing, Needs review, Approved-Rejected) but
 * does not say which moves between them are legal. Modelling it explicitly —
 * rather than letting any status overwrite any other — is the point of this
 * file: an approved invoice must not silently flip back to processing because a
 * stale browser tab fired a PATCH.
 *
 * approved and rejected are terminal. Reversing a decision in a real AP system
 * means issuing a corrective document, not editing the original.
 */
export const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  processing: ['approved', 'rejected'],
  needs_review: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

/** Statuses a reviewer may set directly through the API. */
export const REVIEWER_SETTABLE: Status[] = ['approved', 'rejected'];

export function isTerminal(status: Status): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {
  readonly from: Status;
  readonly to: Status;

  constructor(from: Status, to: Status) {
    super(
      isTerminal(from)
        ? `Invoice is already ${from} and cannot be changed — ${from} is a terminal state.`
        : `Cannot move an invoice from ${from} to ${to}. Allowed from ${from}: ${
            ALLOWED_TRANSITIONS[from].join(', ') || 'none'
          }.`,
    );
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Throws TransitionError if the move is not permitted. */
export function assertTransition(from: Status, to: Status): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/**
 * Maps a UI tab to the statuses it contains.
 * "Approved-Rejected" is one tab covering two statuses, per the brief.
 */
export const TAB_STATUSES = {
  processing: ['processing'],
  'needs-review': ['needs_review'],
  'approved-rejected': ['approved', 'rejected'],
} as const satisfies Record<string, readonly Status[]>;

export type TabKey = keyof typeof TAB_STATUSES;
