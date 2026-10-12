# Mini Invoice Approval Desk

An accounts-payable approval desk: a TypeScript REST API and a React dashboard
for triaging supplier invoices through `processing → needs review → approved /
rejected`, with duplicate detection and a full audit trail.

Built as a take-home exercise.

---

## Quick start

Requires **Node 20+**. No database to provision — SQLite is a file.

```bash
# 1. API  (terminal 1)
cd api
npm install
cp .env.example .env
npm run db:seed          # creates invoices.db and seeds 6 invoices
npm run dev              # http://localhost:4000

# 2. Web  (terminal 2)
cd web
npm install
npm run dev              # http://localhost:5173
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the Express
server, so the browser stays on one origin and CORS is not in play locally.

Re-run `npm run db:seed` at any point to reset to a known state.

### All commands

| Where | Command | Does |
|---|---|---|
| `api` | `npm run dev` | Express with hot reload on :4000 |
| `api` | `npm run db:seed` | Recreate the schema and seed 6 invoices |
| `api` | `npm test` | 22 unit tests |
| `api` | `npm run build` | Compile to `dist/` |
| `api` | `npm start` | Run the compiled server |
| `web` | `npm run dev` | Vite dev server on :5173 |
| `web` | `npm test` | 22 unit + component tests |
| `web` | `npm run typecheck` | `tsc --noEmit` |
| `web` | `npm run lint` | ESLint, zero warnings tolerated |
| `web` | `npm run build` | Type-check then production build |
| `web` | `npm run preview` | Serve the production build |

---

## The design decision that matters

The brief asks for a **Needs review** tab and for the seed to contain **one
duplicate**, but never says what puts an invoice into Needs review.

Those are the same requirement. A duplicate sitting inertly in Processing
satisfies the wording and misses the point — so the desk runs duplicate
detection at ingestion and routes a suspected duplicate into Needs review, with
a pointer to the invoice it matched and a plain-English reason shown in the UI.

### The rules

Two, in priority order:

| Rule | Matches on | Why |
|---|---|---|
| `EXACT_REFERENCE` | vendor + invoice number | An invoice number is unique per vendor by convention. A repeat almost always means the same document was submitted twice. |
| `SAME_VENDOR_AMOUNT_DATE` | vendor + amount + invoice date, invoice numbers differing | Catches re-issues and rekeyed entries, where the same bill was re-entered under a new reference. Weaker signal, so it ranks second. |

Vendor names are compared **normalised** — case, punctuation and company
suffixes folded — so `Baytown Electrical Contractors, Inc.` and
`Baytown Electrical Contractors` are the same vendor. The seeded duplicate uses
exactly that variation, because that is how duplicates actually arrive: the same
bill resubmitted with the legal entity spelled out and the line item reworded.

### Flag, never auto-reject

Detection marks an invoice for a human; it does not decide. Legitimate repeat
billing exists — a monthly retainer at a fixed amount would trip
`SAME_VENDOR_AMOUNT_DATE` every month. Auto-rejecting would turn a false
positive into an unpaid supplier. The desk surfaces the match and the reason; a
reviewer decides.

`findDuplicate()` is pure and synchronous, with no database access, so the rule
is unit-testable in isolation and reusable anywhere a batch of invoices is
considered.

**What this is not:** there is no fuzzy matching. `Baytown Electric` would not
match `Baytown Electrical` today. See *With more time* below.

---

## Status model

```
                 ┌──────────────┐
   ingested ───► │  processing  │ ──┐
                 └──────────────┘   │
                                    ├──► approved   (terminal)
                 ┌──────────────┐   │
   ingested ───► │ needs_review │ ──┘──► rejected   (terminal)
   (flagged)     └──────────────┘
```

| From | To | Trigger |
|---|---|---|
| — | `processing` | Ingested, no duplicate match |
| — | `needs_review` | Ingested, duplicate rule matched |
| `processing` | `approved` / `rejected` | Reviewer decision |
| `needs_review` | `approved` / `rejected` | Reviewer decision |
| `approved` / `rejected` | — | Terminal |

Transitions are enforced in `api/src/lib/status.ts` and checked before any
write. Anything outside the table returns **409** with the attempted move and
the legal options — an approved invoice cannot flip back to processing because a
stale browser tab fired a `PATCH`.

`approved` and `rejected` are terminal on purpose. Reversing a decision in a
real AP system means issuing a corrective document, not quietly editing the
original — and the audit trail would be a lie if it could.

**Tabs map onto statuses** via `TAB_STATUSES`, defined once:

| Tab | Statuses |
|---|---|
| Processing | `processing` |
| Needs review | `needs_review` |
| Approved / Rejected | `approved`, `rejected` |

---

## Database schema

SQLite. Two tables. The DDL is readable in `api/src/db/index.ts`; the typed
definition is `api/src/db/schema.ts`.

### `invoices`

| Column | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | |
| `vendor_name` | TEXT | Indexed with `invoice_number` for detection lookups |
| `invoice_number` | TEXT | Vendor's own reference |
| `amount_cents` | INTEGER | Money in minor units — see below |
| `currency` | TEXT | Defaults `USD` |
| `invoice_date` | INTEGER | Unix epoch seconds |
| `due_date` | INTEGER | Nullable |
| `description` | TEXT | Nullable |
| `status` | TEXT | `CHECK` constrained to the four statuses |
| `duplicate_of_id` | TEXT FK → `invoices.id` | Self-reference; set when flagged |
| `duplicate_reason` | TEXT | Human-readable explanation shown in the UI |
| `created_at`, `updated_at` | INTEGER | |

### `status_events`

Append-only audit trail. One row per transition, including the initial
placement.

| Column | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | |
| `invoice_id` | TEXT FK | `ON DELETE CASCADE` |
| `from_status` | TEXT | Null on ingestion — there is no prior state |
| `to_status` | TEXT | |
| `reason` | TEXT | Reviewer's note, or the detection explanation |
| `actor` | TEXT | `system` or `reviewer` |
| `created_at` | INTEGER | |

### Two choices worth explaining

**Money is integer cents, not a float.** SQLite stores `REAL` as a float and
floats lose cents. That matters doubly here, because duplicate detection
compares amounts for *equality* — `8620.00 !== 8620.000000001` would silently
stop catching duplicates. The API exposes a decimal `amount` alongside
`amountCents` so the UI never has to know about the storage choice.

**Status history is a table, not an `updatedAt` column.** AP approval is an
audited process. "Who approved this, when, and why" is a question someone
eventually asks, and reconstructing it from one timestamp is impossible. It
costs one small table to answer properly.

---

## API

Base URL `http://localhost:4000`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/invoices` | `?tab=processing\|needs-review\|approved-rejected`, or `?status=` (repeatable) |
| `GET` | `/api/invoices/:id` | Detail: matched original, anything matched against it, full event history |
| `PATCH` | `/api/invoices/:id/status` | Body `{ status: "approved" \| "rejected", reason? }` |
| `GET` | `/api/health` | |

The list response carries per-tab counts, so the UI renders badges without three
extra round trips. `PATCH` writes the status change and its audit event in a
single transaction — a status can never change without a matching event.

### Status codes

| Code | When |
|---|---|
| `400` | Malformed body, or a status a reviewer may not set (`processing`, `needs_review`) |
| `404` | Unknown invoice id, or unknown route |
| `409` | Valid status, illegal move — e.g. already approved |

Every error returns a machine-readable `error` code and a message written for a
human.

### Examples

```bash
# List the Needs review tab
curl http://localhost:4000/api/invoices?tab=needs-review

# One invoice, with its duplicate link and history
curl http://localhost:4000/api/invoices/<id>

# Reject it
curl -X PATCH http://localhost:4000/api/invoices/<id>/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"rejected","reason":"Duplicate of BEC-7781."}'
```

```jsonc
// GET /api/invoices?tab=needs-review
{
  "invoices": [{
    "id": "inv_...",
    "vendorName": "Baytown Electrical Contractors, Inc.",
    "invoiceNumber": "BEC-7781",
    "amountCents": 862000,
    "amount": 8620,
    "currency": "USD",
    "status": "needs_review",
    "duplicateOfId": "inv_...",
    "duplicateReason": "Same vendor (Baytown Electrical Contractors) and same invoice number (BEC-7781) as an invoice already on the desk.",
    "duplicateOf": { "id": "inv_...", "vendorName": "Baytown Electrical Contractors", "invoiceNumber": "BEC-7781", "status": "processing" }
  }],
  "counts": { "processing": 3, "needsReview": 1, "approvedRejected": 2 }
}
```

---

## Web UI

React 18 + Vite + TypeScript. No component library — the CSS is hand-written and
about 350 lines.

- **Three tabs** with live counts from the API.
- **List** showing vendor, invoice number, issue and due dates, amount and
  currency, status, and a Duplicate badge where applicable. Overdue invoices are
  marked.
- **Detail drawer** with every field, the duplicate explanation and a link to the
  matched original, the full audit trail, and an optional note on the decision.
- **Approve / Reject** that call the API and update the screen **only from the
  server's response** — never optimistically, so what is displayed always matches
  what was persisted. Repeat clicks are blocked while a request is in flight.
- **Loading skeletons, empty states per tab, error states with retry**, and
  success/failure toasts.
- A **409** (someone else already decided) is surfaced and the drawer refetches
  the truth rather than leaving a stale view.
- Keyboard accessible: tabs use `role="tab"`, the drawer is a labelled
  `role="dialog"`, Escape closes, focus moves on open.
- Responsive to 390px. No horizontal scroll on mobile.

---

## Seed data

Six invoices from a construction-supplier context, covering all four statuses so
every tab shows something on first load:

| # | Vendor | Ref | Lands in |
|---|---|---|---|
| 1 | Northside Concrete Supply | NCS-2041 | processing |
| 2 | Baytown Electrical Contractors | BEC-7781 | processing |
| 3 | Harlow Plumbing & Mechanical | HPM-0455 | processing |
| 4 | Cedar Ridge Lumber Co. | CRL-9920 | **rejected** |
| 5 | Summit Crane Services | SCS-3312 | **approved** |
| 6 | Baytown Electrical Contractors, **Inc.** | BEC-7781 | **needs_review** — flagged against #2 |

The seed inserts through the same detection path the API uses, so the duplicate
is *found*, not hard-coded into `needs_review`. If the rule regresses, the seed
stops producing a flagged invoice and it is immediately obvious.

**Idempotent:** the seed clears both tables first, so running it repeatedly
always produces exactly these six rows — never duplicates of the duplicate.

---

## Testing

**44 tests, all passing.** 22 API + 22 web.

```bash
cd api && npm test     # 22 passed
cd web && npm test     # 22 passed
```

### API — `api/tests/`

- **`duplicates.test.ts`** (13) — both rules fire correctly; vendor
  normalisation folds suffixes and case; invoice numbers match case- and
  whitespace-insensitively; the same reference from a *different* vendor is not
  a duplicate; differing amount or date does not match; time of day is ignored
  on dates; an invoice never matches itself; `EXACT_REFERENCE` wins when both
  rules could fire.
- **`status.test.ts`** (9) — every legal move allowed and every illegal one
  refused; terminal states are terminal; no backwards moves into a queue;
  setting the same status twice is refused; `TransitionError` carries both ends
  of the attempted move; the three tabs cover all four statuses with no overlap.

### Web — `web/src/`

- **`format.test.ts`** (11) — currency and date formatting, graceful degradation
  on a bad currency code or unparseable date, overdue arithmetic.
- **`App.test.tsx`** (11) — the three tabs render; counts come from the API; an
  invoice renders with its formatted amount; empty and error states appear; the
  duplicate is badged; the drawer opens and explains the flag; decision buttons
  are hidden on terminal invoices; Approve sends exactly one `PATCH`; a typed
  note is included in the body; **a 409 is surfaced as an error and no success
  is claimed**.

The HTTP layer is deliberately thin — validate, delegate, map errors to codes —
so the tests sit on the logic underneath rather than on Express.

### Verified by hand, against a running server

Beyond the unit tests, the following were checked with real requests and a real
browser:

- All three endpoints return correct data; every error path returns its code
  (`400` bad body, `400` non-settable status, `400` bad filter, `404` unknown
  id, `404` unknown route, `409` terminal move).
- A status change persists: confirmed by the API response, by a fresh `GET`, by
  reading the SQLite file directly, **and after a full restart of the API
  process**.
- The built frontend was driven in headless Chromium against the live API
  cross-origin (`:5173 → :4000`, exercising CORS): tabs and counts render, the
  duplicate is badged, the drawer explains the flag and shows the audit trail,
  Reject writes through and the invoice moves tabs after a reload, and the
  layout has no horizontal scroll at 390px. Zero console errors.

---

## Architecture

```
web (React + Vite)          api (Express + TypeScript)        SQLite
  components ──fetch──►  routes/invoices.ts ──►  db/  ──►  invoices.db
  api.ts                   lib/duplicates.ts        schema.ts
  types.ts                 lib/status.ts
```

The API owns the rules. `lib/duplicates.ts` and `lib/status.ts` are pure modules
with no HTTP or database dependencies; routes validate input with Zod, call
them, and map outcomes to status codes. The frontend holds no business logic —
it renders what the API returns and re-reads after every write.

Statuses and tab mappings are each defined once per side (`api/src/db/schema.ts`
and `api/src/lib/status.ts`; `web/src/types.ts`), which is what stops a filter
and a status value drifting apart.

### Stack

| | | Why |
|---|---|---|
| API | Express + TypeScript | Small and explicit around three endpoints |
| DB | SQLite via better-sqlite3 | Zero setup for whoever clones this — no service to run |
| Queries | Drizzle ORM | Typed queries and rows, no codegen step |
| Validation | Zod | One schema per endpoint, parsed at the boundary |
| Web | React 18 + Vite | |
| Tests | Vitest + Testing Library | |

---

## Deliberately out of scope

Named explicitly, because each was a decision rather than an oversight:

- **Auth.** No users, so `actor` is the literal string `reviewer`. The audit
  table already has the column for when there is a real identity.
- **Pagination.** Six invoices. The index on `status` is there for when it is
  not six.
- **Invoice ingestion / upload.** The desk triages what is already in the
  system; the seed stands in for the ingestion pipeline.
- **Versioned migrations.** The schema is two tables and the DDL is readable in
  one file. Anything larger would want a migrations directory.
- **Deployment.** Not requested in the brief. See the note below.

## With more time

- Fuzzy vendor matching (trigram or Levenshtein) to catch `Baytown Electric`
  against `Baytown Electrical`. The current normaliser handles suffixes and
  punctuation, not genuine misspellings.
- A confidence score per match rather than a binary flag, so near-misses can be
  surfaced lower down instead of dropped.
- Detection re-run on amendment, not only at ingestion.
- Integration tests over the HTTP layer with supertest, alongside the unit tests.

## A note on deployment

This runs locally with two commands and no external services, which is the
fastest way for a reviewer to see it working.

If a hosted demo were wanted, the frontend is a static build and deploys
anywhere; the API needs a host with a **persistent writable filesystem** —
Railway, Render, Fly.io — because a SQLite file written by a serverless function
does not survive between invocations. Swapping SQLite for managed Postgres is a
small change at the Drizzle layer if a serverless target were required. Set
`VITE_API_BASE_URL` to the API's origin at build time; CORS is already enabled
on the API.
