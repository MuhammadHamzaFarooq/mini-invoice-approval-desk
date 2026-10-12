import { useEffect, useRef, useState } from 'react';
import type { DetailResponse, Status } from '../types';
import { STATUS_LABELS } from '../types';
import { formatDate, formatDateTime, formatMoney } from '../format';
import { StatusBadge, DuplicateBadge } from './Badges';

interface Props {
  detail: DetailResponse | null;
  loading: boolean;
  error: string | null;
  /** True while a PATCH is in flight — blocks repeat clicks. */
  submitting: boolean;
  onClose: () => void;
  onDecide: (status: Extract<Status, 'approved' | 'rejected'>, reason: string) => void;
}

export function InvoiceDrawer({ detail, loading, error, submitting, onClose, onDecide }: Props) {
  const [reason, setReason] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reset the note whenever a different invoice is opened, so a reason typed
  // for one invoice cannot be submitted against another.
  useEffect(() => {
    setReason('');
  }, [detail?.invoice.id]);

  // Escape closes; focus moves into the drawer on open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Prevent the page behind the drawer from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const invoice = detail?.invoice;
  const canDecide = (detail?.allowedTransitions.length ?? 0) > 0;

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice details'}
      >
        <div className="drawer-head">
          <div>
            {loading && !invoice && <h2>Loading…</h2>}
            {invoice && (
              <>
                <h2>{invoice.vendorName}</h2>
                <p className="card-meta">
                  <span>{invoice.invoiceNumber}</span>
                  <span className="sep" aria-hidden="true">·</span>
                  <StatusBadge status={invoice.status} />
                  {invoice.duplicateOfId && <DuplicateBadge />}
                </p>
              </>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="state state-error">
            <h2>Could not load this invoice</h2>
            <p>{error}</p>
          </div>
        )}

        {invoice && (
          <>
            <dl className="field-grid">
              <div className="field">
                <dt>Amount</dt>
                <dd>{formatMoney(invoice.amount, invoice.currency)}</dd>
              </div>
              <div className="field">
                <dt>Currency</dt>
                <dd>{invoice.currency}</dd>
              </div>
              <div className="field">
                <dt>Invoice date</dt>
                <dd>{formatDate(invoice.invoiceDate)}</dd>
              </div>
              <div className="field">
                <dt>Due date</dt>
                <dd>{formatDate(invoice.dueDate)}</dd>
              </div>
            </dl>

            {invoice.description && (
              <div className="panel">
                <h3>Description</h3>
                <p>{invoice.description}</p>
              </div>
            )}

            {invoice.duplicateOfId && (
              <div className="panel panel-warn">
                <h3>Flagged as a suspected duplicate</h3>
                <p>{invoice.duplicateReason ?? 'Matched an invoice already on the desk.'}</p>
                {invoice.duplicateOf && (
                  <p style={{ marginTop: 6 }}>
                    Original:{' '}
                    <strong>
                      {invoice.duplicateOf.vendorName} {invoice.duplicateOf.invoiceNumber}
                    </strong>{' '}
                    ({STATUS_LABELS[invoice.duplicateOf.status]})
                  </p>
                )}
              </div>
            )}

            {invoice.duplicates && invoice.duplicates.length > 0 && (
              <div className="panel panel-warn">
                <h3>
                  {invoice.duplicates.length} invoice
                  {invoice.duplicates.length === 1 ? '' : 's'} flagged against this one
                </h3>
                {invoice.duplicates.map((d) => (
                  <p key={d.id}>
                    {d.vendorName} {d.invoiceNumber} ({STATUS_LABELS[d.status]})
                  </p>
                ))}
              </div>
            )}

            {invoice.events && invoice.events.length > 0 && (
              <div>
                <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>History</h3>
                <ul className="timeline">
                  {invoice.events.map((e) => (
                    <li key={e.id}>
                      <span className="when">
                        {formatDateTime(e.createdAt)} · {e.actor}
                      </span>
                      <span className="what">
                        {e.fromStatus
                          ? `${STATUS_LABELS[e.fromStatus]} → ${STATUS_LABELS[e.toStatus]}`
                          : `Ingested as ${STATUS_LABELS[e.toStatus]}`}
                      </span>
                      {e.reason && <span className="why">{e.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canDecide ? (
              <>
                <label>
                  <span className="field" style={{ display: 'block', marginBottom: 6 }}>
                    <dt style={{ fontSize: 12, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>
                      Note (optional)
                    </dt>
                  </span>
                  <textarea
                    className="reason-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you approving or rejecting this?"
                    maxLength={500}
                    disabled={submitting}
                  />
                </label>

                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-approve"
                    disabled={submitting}
                    onClick={() => onDecide('approved', reason)}
                  >
                    {submitting ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-reject"
                    disabled={submitting}
                    onClick={() => onDecide('rejected', reason)}
                  >
                    {submitting ? 'Saving…' : 'Reject'}
                  </button>
                </div>
              </>
            ) : (
              <div className="panel">
                <h3>No further action</h3>
                <p>
                  This invoice is {STATUS_LABELS[invoice.status].toLowerCase()}, which is a final
                  state. Reversing it would mean issuing a corrective document.
                </p>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
