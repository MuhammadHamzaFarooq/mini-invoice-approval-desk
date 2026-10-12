import type { Invoice } from '../types';
import { formatDate, formatMoney, daysUntilDue } from '../format';
import { StatusBadge, DuplicateBadge } from './Badges';

interface Props {
  invoice: Invoice;
  onOpen: (id: string) => void;
}

export function InvoiceCard({ invoice, onOpen }: Props) {
  const due = daysUntilDue(invoice.dueDate);
  const overdue = due !== null && due < 0 && invoice.status !== 'approved' && invoice.status !== 'rejected';

  return (
    <button
      type="button"
      className="card"
      onClick={() => onOpen(invoice.id)}
      aria-label={`Open invoice ${invoice.invoiceNumber} from ${invoice.vendorName}`}
    >
      <div className="card-main">
        <p className="card-vendor">
          {invoice.vendorName}
          {invoice.duplicateOfId && <DuplicateBadge />}
        </p>
        <p className="card-meta">
          <span>{invoice.invoiceNumber}</span>
          <span className="sep" aria-hidden="true">·</span>
          <span>Issued {formatDate(invoice.invoiceDate)}</span>
          {invoice.dueDate && (
            <>
              <span className="sep" aria-hidden="true">·</span>
              <span className={overdue ? 'overdue' : undefined}>
                Due {formatDate(invoice.dueDate)}
                {overdue && ` (${Math.abs(due)}d overdue)`}
              </span>
            </>
          )}
        </p>
        {invoice.description && <p className="card-desc">{invoice.description}</p>}
      </div>

      <div className="card-side">
        <span className="card-amount">{formatMoney(invoice.amount, invoice.currency)}</span>
        <StatusBadge status={invoice.status} />
      </div>
    </button>
  );
}
