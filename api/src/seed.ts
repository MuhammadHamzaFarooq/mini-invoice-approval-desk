/**
 * Deterministic seed: six invoices, one of which is a duplicate.
 *
 * Invoices are inserted through the same detection path the API uses, so the
 * duplicate is *found*, not hard-coded into needs_review. Running the seed
 * exercises the rule rather than faking its result — if detection regresses,
 * the seed stops producing a flagged invoice and it is immediately visible.
 *
 * Expected end state — six invoices covering all four statuses, so every tab
 * shows something meaningful on first load:
 *   processing    3   (#1 #2 #3)
 *   needs_review  1   (#6, flagged against #2 by EXACT_REFERENCE)
 *   approved      1   (#5)
 *   rejected      1   (#4)
 */

import { eq } from 'drizzle-orm';
import { db, sqlite, initialiseSchema, newId } from './db/index.js';
import { invoices, statusEvents, type Status } from './db/schema.js';
import { findDuplicate, type InvoiceLike } from './lib/duplicates.js';

interface SeedRow {
  vendorName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  description: string;
  /**
   * Applied after ingestion so the Approved-Rejected tab shows both outcomes
   * on first load rather than only one.
   */
  preDecision?: 'approved' | 'rejected';
  /** Reason recorded on the pre-applied decision, for the audit trail. */
  preDecisionReason?: string;
}

const SEED: SeedRow[] = [
  {
    vendorName: 'Northside Concrete Supply',
    invoiceNumber: 'NCS-2041',
    amountCents: 1_284_500,
    currency: 'USD',
    invoiceDate: '2026-09-28',
    dueDate: '2026-10-28',
    description: 'Ready-mix concrete, 14 cubic yards — Lot 7 foundation pour',
  },
  {
    vendorName: 'Baytown Electrical Contractors',
    invoiceNumber: 'BEC-7781',
    amountCents: 862_000,
    currency: 'USD',
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-31',
    description: 'Rough-in electrical, floors 2-4',
  },
  {
    vendorName: 'Harlow Plumbing & Mechanical',
    invoiceNumber: 'HPM-0455',
    amountCents: 439_900,
    currency: 'USD',
    invoiceDate: '2026-10-03',
    dueDate: '2026-11-02',
    description: 'Supply and install, main stack risers',
  },
  {
    vendorName: 'Cedar Ridge Lumber Co.',
    invoiceNumber: 'CRL-9920',
    amountCents: 2_175_000,
    currency: 'USD',
    invoiceDate: '2026-10-06',
    dueDate: '2026-11-05',
    description: 'Framing package — engineered joists and sheathing',
    preDecision: 'rejected',
    preDecisionReason: 'Quantities do not match the signed delivery note. Vendor to reissue.',
  },
  {
    vendorName: 'Summit Crane Services',
    invoiceNumber: 'SCS-3312',
    amountCents: 640_000,
    currency: 'USD',
    invoiceDate: '2026-09-21',
    dueDate: '2026-10-21',
    description: 'Mobile crane hire, 3 days including operator',
    preDecision: 'approved',
    preDecisionReason: 'Matched to PO-4471 and the signed timesheet.',
  },
  // The duplicate. Same vendor and same invoice number as #2, resubmitted with
  // a slightly different vendor spelling and a reworded line item — which is
  // how duplicates actually arrive. Vendor normalisation means it still matches
  // on EXACT_REFERENCE.
  {
    vendorName: 'Baytown Electrical Contractors, Inc.',
    invoiceNumber: 'BEC-7781',
    amountCents: 862_000,
    currency: 'USD',
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-31',
    description: 'Electrical rough-in, levels 2 through 4',
  },
];

function run() {
  initialiseSchema();

  sqlite.exec('DELETE FROM status_events;');
  sqlite.exec('DELETE FROM invoices;');

  const ingested: (InvoiceLike & { id: string })[] = [];

  for (const row of SEED) {
    const candidate: InvoiceLike = {
      vendorName: row.vendorName,
      invoiceNumber: row.invoiceNumber,
      amountCents: row.amountCents,
      invoiceDate: new Date(row.invoiceDate),
    };

    const match = findDuplicate(candidate, ingested);
    const status: Status = match ? 'needs_review' : 'processing';
    const id = newId();
    const now = new Date();

    db.insert(invoices)
      .values({
        id,
        vendorName: row.vendorName,
        invoiceNumber: row.invoiceNumber,
        amountCents: row.amountCents,
        currency: row.currency,
        invoiceDate: new Date(row.invoiceDate),
        dueDate: new Date(row.dueDate),
        description: row.description,
        status,
        duplicateOfId: match?.matchedInvoiceId ?? null,
        duplicateReason: match?.reason ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(statusEvents)
      .values({
        id: newId('evt'),
        invoiceId: id,
        fromStatus: null,
        toStatus: status,
        actor: 'system',
        reason: match
          ? `Flagged on ingestion by rule ${match.rule}. ${match.reason}`
          : 'Ingested — no duplicate match.',
        createdAt: now,
      })
      .run();

    ingested.push({ id, ...candidate });

    if (row.preDecision) {
      db.update(invoices)
        .set({ status: row.preDecision, updatedAt: now })
        .where(eq(invoices.id, id))
        .run();

      db.insert(statusEvents)
        .values({
          id: newId('evt'),
          invoiceId: id,
          fromStatus: status,
          toStatus: row.preDecision,
          actor: 'reviewer',
          reason: row.preDecisionReason ?? null,
          createdAt: now,
        })
        .run();
    }
  }

  report();
}

function report() {
  const rows = sqlite
    .prepare('SELECT status, COUNT(*) AS n FROM invoices GROUP BY status ORDER BY status')
    .all() as { status: string; n: number }[];

  console.log('Seed complete:');
  for (const r of rows) console.log(`  ${r.status.padEnd(13)} ${r.n}`);

  const flagged = sqlite
    .prepare(
      `SELECT d.vendor_name AS vendor, d.invoice_number AS ref,
              o.invoice_number AS matched, d.duplicate_reason AS reason
         FROM invoices d
         JOIN invoices o ON o.id = d.duplicate_of_id
        WHERE d.status = 'needs_review'`,
    )
    .all() as { vendor: string; ref: string; matched: string; reason: string }[];

  for (const f of flagged) {
    console.log(`  flagged: ${f.vendor} ${f.ref} -> duplicate of ${f.matched}`);
    console.log(`           ${f.reason}`);
  }
}

run();
sqlite.close();
