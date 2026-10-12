/**
 * Wire types, mirroring the API's responses.
 *
 * The four statuses and the three tabs are defined once here and reused by the
 * client, exactly as the API defines them once in src/db/schema.ts and
 * src/lib/status.ts. Keeping each side to a single definition is what stops a
 * tab filter and a status value drifting apart.
 */

export const STATUSES = ['processing', 'needs_review', 'approved', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

export const TABS = ['processing', 'needs-review', 'approved-rejected'] as const;
export type TabKey = (typeof TABS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
  processing: 'Processing',
  'needs-review': 'Needs review',
  'approved-rejected': 'Approved / Rejected',
};

export const STATUS_LABELS: Record<Status, string> = {
  processing: 'Processing',
  needs_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export interface InvoiceRef {
  id: string;
  vendorName: string;
  invoiceNumber: string;
  status: Status;
}

export interface StatusEvent {
  id: string;
  invoiceId: string;
  fromStatus: Status | null;
  toStatus: Status;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  vendorName: string;
  invoiceNumber: string;
  amountCents: number;
  /** Decimal convenience field computed by the API from amountCents. */
  amount: number;
  currency: string;
  invoiceDate: string;
  dueDate: string | null;
  description: string | null;
  status: Status;
  duplicateOfId: string | null;
  duplicateReason: string | null;
  duplicateOf?: InvoiceRef | Invoice | null;
  duplicates?: InvoiceRef[];
  events?: StatusEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface TabCounts {
  processing: number;
  needsReview: number;
  approvedRejected: number;
}

export interface ListResponse {
  invoices: Invoice[];
  counts: TabCounts;
}

export interface DetailResponse {
  invoice: Invoice;
  allowedTransitions: Status[];
}

export interface UpdateResponse extends DetailResponse {
  counts: TabCounts;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  from?: Status;
  to?: Status;
  allowedFrom?: Status[];
  details?: Record<string, string[]>;
}
