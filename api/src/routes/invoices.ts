import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, inArray, desc, asc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, newId } from '../db/index.js';
import { invoices, statusEvents, STATUSES, type Status } from '../db/schema.js';
import {
  assertTransition,
  TransitionError,
  ALLOWED_TRANSITIONS,
  REVIEWER_SETTABLE,
  TAB_STATUSES,
} from '../lib/status.js';

export const invoicesRouter = Router();

const statusEnum = z.enum(STATUSES);

const listQuerySchema = z.object({
  status: z.union([statusEnum, z.array(statusEnum)]).optional(),
  tab: z.enum(['processing', 'needs-review', 'approved-rejected']).optional(),
});

const updateStatusSchema = z.object({
  status: statusEnum.refine((s) => REVIEWER_SETTABLE.includes(s), {
    message: `A reviewer may only set: ${REVIEWER_SETTABLE.join(' or ')}.`,
  }),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Money is stored as integer cents; the wire format exposes a decimal `amount`
 * alongside it so the UI never has to know about the storage choice.
 */
function serialise<T extends { amountCents: number }>(row: T) {
  return { ...row, amount: row.amountCents / 100 };
}

async function tabCounts() {
  const rows = await db
    .select({ status: invoices.status, count: sql<number>`count(*)` })
    .from(invoices)
    .groupBy(invoices.status);

  const of = (s: Status) => Number(rows.find((r) => r.status === s)?.count ?? 0);

  return {
    processing: of('processing'),
    needsReview: of('needs_review'),
    approvedRejected: of('approved') + of('rejected'),
  };
}

/**
 * GET /api/invoices
 * Optional filter: ?tab=needs-review  or  ?status=processing (repeatable)
 *
 * Returns the list plus per-tab counts, so the UI renders badges without three
 * extra round trips.
 */
invoicesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'INVALID_QUERY',
        message: `Unrecognised filter. status must be one of ${STATUSES.join(', ')}; tab must be one of ${Object.keys(TAB_STATUSES).join(', ')}.`,
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { status, tab } = parsed.data;
    let wanted: readonly Status[] | undefined;
    if (tab) wanted = TAB_STATUSES[tab];
    else if (status) wanted = Array.isArray(status) ? status : [status];

    const rows = await db.query.invoices.findMany({
      where: wanted ? inArray(invoices.status, [...wanted]) : undefined,
      orderBy: [desc(invoices.invoiceDate)],
      with: {
        duplicateOf: {
          columns: { id: true, vendorName: true, invoiceNumber: true, status: true },
        },
      },
    });

    res.json({ invoices: rows.map(serialise), counts: await tabCounts() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/invoices/:id
 * Detail view. Includes the invoice this one was flagged against (when
 * applicable), anything flagged against it, and the full audit trail.
 */
invoicesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db.query.invoices.findFirst({
      where: eq(invoices.id, req.params.id),
      with: {
        duplicateOf: true,
        duplicates: {
          columns: { id: true, vendorName: true, invoiceNumber: true, status: true },
        },
        events: { orderBy: [asc(statusEvents.createdAt)] },
      },
    });

    if (!row) {
      return res
        .status(404)
        .json({ error: 'NOT_FOUND', message: `No invoice with id ${req.params.id}.` });
    }

    res.json({
      invoice: serialise(row),
      allowedTransitions: ALLOWED_TRANSITIONS[row.status],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/invoices/:id/status
 * Body: { status: "approved" | "rejected", reason?: string }
 *
 * Validates the move against the state machine, then writes the new status and
 * its audit event in one transaction — so a status can never change without a
 * matching event, and vice versa.
 *
 *   400  malformed body, or a status a reviewer may not set
 *   404  unknown invoice
 *   409  valid status, illegal move (e.g. already approved)
 */
invoicesRouter.patch(
  '/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'INVALID_BODY',
          message: 'Body must be { status: "approved" | "rejected", reason?: string }.',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { status: next_, reason } = parsed.data;

      const current = await db.query.invoices.findFirst({
        where: eq(invoices.id, req.params.id),
        columns: { id: true, status: true },
      });

      if (!current) {
        return res
          .status(404)
          .json({ error: 'NOT_FOUND', message: `No invoice with id ${req.params.id}.` });
      }

      assertTransition(current.status, next_);

      // The status change and its audit row are one transaction: an approval
      // that is not recorded in the trail, or a trail entry for a change that
      // did not land, are both worse than a failed request.
      await db.transaction(async (tx) => {
        await tx
          .update(invoices)
          .set({ status: next_, updatedAt: new Date() })
          .where(eq(invoices.id, current.id))
          .run();

        await tx
          .insert(statusEvents)
          .values({
            id: newId('evt'),
            invoiceId: current.id,
            fromStatus: current.status,
            toStatus: next_,
            reason: reason ?? null,
            actor: 'reviewer',
            createdAt: new Date(),
          })
          .run();
      });

      const updated = await db.query.invoices.findFirst({
        where: eq(invoices.id, current.id),
        with: {
          duplicateOf: true,
          events: { orderBy: [asc(statusEvents.createdAt)] },
        },
      });

      res.json({
        invoice: serialise(updated!),
        allowedTransitions: ALLOWED_TRANSITIONS[updated!.status],
        counts: await tabCounts(),
      });
    } catch (err) {
      if (err instanceof TransitionError) {
        return res.status(409).json({
          error: 'ILLEGAL_TRANSITION',
          message: err.message,
          from: err.from,
          to: err.to,
          allowedFrom: ALLOWED_TRANSITIONS[err.from],
        });
      }
      next(err);
    }
  },
);
