import { STATUS_LABELS, type Status } from '../types';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function DuplicateBadge() {
  return (
    <span className="badge badge-duplicate" title="Flagged as a suspected duplicate">
      Duplicate
    </span>
  );
}
