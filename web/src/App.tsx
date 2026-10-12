import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getInvoice, listInvoices, updateInvoiceStatus } from './api';
import type { DetailResponse, Invoice, Status, TabCounts, TabKey } from './types';
import { TABS, TAB_LABELS } from './types';
import { InvoiceCard } from './components/InvoiceCard';
import { InvoiceDrawer } from './components/InvoiceDrawer';
import { Toasts, type Toast } from './components/Toasts';

const EMPTY_COUNTS: TabCounts = { processing: 0, needsReview: 0, approvedRejected: 0 };

function countFor(tab: TabKey, counts: TabCounts): number {
  if (tab === 'processing') return counts.processing;
  if (tab === 'needs-review') return counts.needsReview;
  return counts.approvedRejected;
}

const EMPTY_COPY: Record<TabKey, { title: string; body: string }> = {
  processing: {
    title: 'Nothing waiting',
    body: 'No invoices are currently being processed.',
  },
  'needs-review': {
    title: 'Nothing flagged',
    body: 'No invoices have been flagged as suspected duplicates.',
  },
  'approved-rejected': {
    title: 'No decisions yet',
    body: 'Approved and rejected invoices will appear here.',
  },
};

export default function App() {
  const [tab, setTab] = useState<TabKey>('processing');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [counts, setCounts] = useState<TabCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  /** Reloads the current tab. Aborts in flight when the tab changes. */
  const loadList = useCallback(
    async (which: TabKey, signal?: AbortSignal) => {
      setLoading(true);
      setListError(null);
      try {
        const res = await listInvoices(which, signal);
        if (signal?.aborted) return;
        setInvoices(res.invoices);
        setCounts(res.counts);
      } catch (err) {
        if (signal?.aborted || (err as Error).name === 'AbortError') return;
        setListError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setInvoices([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadList(tab, ctrl.signal);
    return () => ctrl.abort();
  }, [tab, loadList]);

  // Fetch the detail fresh whenever a card is opened, so the drawer always
  // reflects the database rather than the possibly-stale list row.
  useEffect(() => {
    if (!openId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const ctrl = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    getInvoice(openId, ctrl.signal)
      .then((res) => {
        if (!ctrl.signal.aborted) setDetail(res);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || (err as Error).name === 'AbortError') return;
        setDetailError(err instanceof ApiError ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setDetailLoading(false);
      });
    return () => ctrl.abort();
  }, [openId]);

  /**
   * Approve or reject. The UI is updated only from the API's response — never
   * optimistically — so what is on screen always matches what was persisted.
   */
  const decide = useCallback(
    async (status: Extract<Status, 'approved' | 'rejected'>, reason: string) => {
      if (!openId || submitting) return;
      setSubmitting(true);
      try {
        const res = await updateInvoiceStatus(openId, status, reason);
        setDetail({ invoice: res.invoice, allowedTransitions: res.allowedTransitions });
        setCounts(res.counts);
        pushToast(
          'success',
          `${res.invoice.invoiceNumber} ${status === 'approved' ? 'approved' : 'rejected'}.`,
        );
        setOpenId(null);
        // Reconcile the list against the server rather than splicing locally.
        await loadList(tab);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not save the change. Please try again.';
        pushToast('error', message);
        // A 409 means our view of the status was stale — refetch the truth.
        if (err instanceof ApiError && err.status === 409 && openId) {
          try {
            setDetail(await getInvoice(openId));
          } catch {
            /* leave the drawer as-is; the toast already reported the failure */
          }
          await loadList(tab);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [openId, submitting, pushToast, loadList, tab],
  );

  return (
    <div className="app">
      <header className="masthead">
        <h1>Invoice Approval Desk</h1>
        <p>Review supplier invoices, check flagged duplicates, and approve or reject.</p>
      </header>

      <div className="tabs" role="tablist" aria-label="Invoice status">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            className="tab"
            aria-selected={tab === t}
            aria-controls="invoice-list"
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            <span className="tab-count">{countFor(t, counts)}</span>
          </button>
        ))}
      </div>

      <div id="invoice-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {loading && (
          <div className="list" aria-busy="true" aria-label="Loading invoices">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        )}

        {!loading && listError && (
          <div className="state state-error">
            <h2>Could not load invoices</h2>
            <p>{listError}</p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 14 }}
              onClick={() => void loadList(tab)}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !listError && invoices.length === 0 && (
          <div className="state">
            <h2>{EMPTY_COPY[tab].title}</h2>
            <p>{EMPTY_COPY[tab].body}</p>
          </div>
        )}

        {!loading && !listError && invoices.length > 0 && (
          <div className="list">
            {invoices.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} onOpen={setOpenId} />
            ))}
          </div>
        )}
      </div>

      {openId && (
        <InvoiceDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          submitting={submitting}
          onClose={() => setOpenId(null)}
          onDecide={(status, reason) => void decide(status, reason)}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
