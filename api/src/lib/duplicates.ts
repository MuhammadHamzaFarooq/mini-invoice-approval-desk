/**
 * Duplicate detection.
 *
 * The brief asks for a "Needs review" tab and for the seed to include one
 * duplicate, but never states what puts an invoice into Needs review. Those two
 * requirements are the same requirement: the duplicate is what the tab is for.
 * So detection runs at ingestion and routes a suspected duplicate to
 * NEEDS_REVIEW with a pointer to the invoice it matched.
 *
 * Two rules, in priority order:
 *
 *   1. EXACT_REFERENCE  same vendor + same invoice number.
 *      The strongest signal there is. An invoice number is unique per vendor by
 *      convention, so a repeat almost always means the document was submitted
 *      twice.
 *
 *   2. SAME_VENDOR_AMOUNT_DATE  same vendor + same amount + same invoice date,
 *      where the invoice numbers differ.
 *      Catches re-issues and rekeyed entries, where someone re-entered the same
 *      bill under a new reference. Weaker, which is why it ranks second.
 *
 * Flag, never auto-reject. A duplicate is a question for a human, not a verdict:
 * legitimate repeat billing exists — a monthly retainer at a fixed amount can
 * trip rule 2 every month. Auto-rejecting would turn a false positive into an
 * unpaid supplier. The desk surfaces it; a reviewer decides.
 *
 * Vendor names are compared normalised (case, whitespace and common suffixes
 * folded) so "Acme Corp." and "ACME CORP" are the same vendor.
 */

export type DuplicateRule = 'EXACT_REFERENCE' | 'SAME_VENDOR_AMOUNT_DATE';

export interface InvoiceLike {
  id?: string;
  vendorName: string;
  invoiceNumber: string;
  amountCents: number;
  invoiceDate: Date;
}

export interface DuplicateMatch {
  rule: DuplicateRule;
  matchedInvoiceId: string;
  reason: string;
}

/** Lowercase, collapse whitespace, strip punctuation and common company suffixes. */
export function normaliseVendor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|bv|plc|pvt)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same calendar day, ignoring time-of-day. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Checks a candidate invoice against already-ingested ones.
 * Returns the first match by rule priority, or null.
 *
 * Pure and synchronous by design — no database access — so the rule can be unit
 * tested directly and reused wherever a batch of invoices is being considered.
 */
export function findDuplicate(
  candidate: InvoiceLike,
  existing: InvoiceLike[],
): DuplicateMatch | null {
  const candidateVendor = normaliseVendor(candidate.vendorName);
  const candidateRef = candidate.invoiceNumber.trim().toLowerCase();

  const pool = existing.filter((e) => e.id && e.id !== candidate.id);

  for (const other of pool) {
    if (normaliseVendor(other.vendorName) !== candidateVendor) continue;
    if (other.invoiceNumber.trim().toLowerCase() !== candidateRef) continue;

    return {
      rule: 'EXACT_REFERENCE',
      matchedInvoiceId: other.id!,
      reason: `Same vendor (${other.vendorName}) and same invoice number (${other.invoiceNumber}) as an invoice already on the desk.`,
    };
  }

  for (const other of pool) {
    if (normaliseVendor(other.vendorName) !== candidateVendor) continue;
    if (other.amountCents !== candidate.amountCents) continue;
    if (!sameDay(other.invoiceDate, candidate.invoiceDate)) continue;

    return {
      rule: 'SAME_VENDOR_AMOUNT_DATE',
      matchedInvoiceId: other.id!,
      reason: `Same vendor (${other.vendorName}), same amount (${formatAmount(
        other.amountCents,
      )}) and same invoice date as ${other.invoiceNumber}, under a different invoice number.`,
    };
  }

  return null;
}
