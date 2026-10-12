/**
 * Mini Invoice Approval Desk — data model.
 *
 * Two tables. `invoices` holds current state; `status_events` is an append-only
 * audit trail of every transition. Accounts-payable approval is an audited
 * process in practice, so status history is modelled explicitly rather than
 * inferred from an updatedAt column.
 *
 * SQLite via better-sqlite3. No ORM engine binary, no codegen step — the
 * reviewer runs `npm install` and the database is a file.
 */

import { sql, relations } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Lifecycle of an invoice on the desk.
 *
 *   processing    ingested, no flags raised, awaiting a decision
 *   needs_review  ingested but flagged — currently only by duplicate detection
 *   approved      terminal
 *   rejected      terminal
 *
 * SQLite has no enum type. Drizzle enforces the set in TypeScript and emits a
 * CHECK constraint, so a bad value cannot reach the table from either side.
 */
export const STATUSES = ['processing', 'needs_review', 'approved', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    vendorName: text('vendor_name').notNull(),
    invoiceNumber: text('invoice_number').notNull(),

    /**
     * Money is stored in minor units as an integer. SQLite stores REAL as a
     * float, and floats lose cents — 0.1 + 0.2 is not 0.3. Integer cents is the
     * standard fix and keeps every comparison exact, which matters here because
     * duplicate detection compares amounts for equality.
     */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),

    /** Unix epoch seconds. */
    invoiceDate: integer('invoice_date', { mode: 'timestamp' }).notNull(),
    dueDate: integer('due_date', { mode: 'timestamp' }),
    description: text('description'),

    status: text('status', { enum: STATUSES }).notNull().default('processing'),

    /**
     * Set when this invoice was flagged as a suspected duplicate: it points at
     * the invoice it matched. Self-referencing, so the detail view can show
     * "duplicate of INV-xyz" and link straight to it.
     */
    duplicateOfId: text('duplicate_of_id'),
    /** Human-readable explanation of why detection fired. */
    duplicateReason: text('duplicate_reason'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    statusIdx: index('invoices_status_idx').on(t.status),
    vendorRefIdx: index('invoices_vendor_ref_idx').on(t.vendorName, t.invoiceNumber),
  }),
);

/** Append-only. One row per transition, including the initial placement. */
export const statusEvents = sqliteTable(
  'status_events',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),

    /** Null on the ingestion event — there is no prior state. */
    fromStatus: text('from_status', { enum: STATUSES }),
    toStatus: text('to_status', { enum: STATUSES }).notNull(),
    reason: text('reason'),
    /** No auth in this exercise, so this is 'system' or 'reviewer'. */
    actor: text('actor').notNull().default('reviewer'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    invoiceCreatedIdx: index('status_events_invoice_created_idx').on(
      t.invoiceId,
      t.createdAt,
    ),
  }),
);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  duplicateOf: one(invoices, {
    fields: [invoices.duplicateOfId],
    references: [invoices.id],
    relationName: 'invoice_duplicates',
  }),
  duplicates: many(invoices, { relationName: 'invoice_duplicates' }),
  events: many(statusEvents),
}));

export const statusEventsRelations = relations(statusEvents, ({ one }) => ({
  invoice: one(invoices, {
    fields: [statusEvents.invoiceId],
    references: [invoices.id],
  }),
}));

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type StatusEvent = typeof statusEvents.$inferSelect;
