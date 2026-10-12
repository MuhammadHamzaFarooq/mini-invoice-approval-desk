import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { Invoice, ListResponse, DetailResponse, UpdateResponse } from './types';

/**
 * These tests drive the real component against a stubbed fetch. The point is
 * the contract the brief cares about: the tabs exist, the duplicate is visibly
 * flagged, and Approve/Reject only change what is on screen after the API
 * confirms the write — never optimistically.
 */

const baseInvoice: Invoice = {
  id: 'inv_1',
  vendorName: 'Baytown Electrical Contractors',
  invoiceNumber: 'BEC-7781',
  amountCents: 862_000,
  amount: 8620,
  currency: 'USD',
  invoiceDate: '2026-10-01T00:00:00.000Z',
  dueDate: '2026-10-31T00:00:00.000Z',
  description: 'Rough-in electrical, floors 2-4',
  status: 'processing',
  duplicateOfId: null,
  duplicateReason: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const duplicateInvoice: Invoice = {
  ...baseInvoice,
  id: 'inv_6',
  vendorName: 'Baytown Electrical Contractors, Inc.',
  status: 'needs_review',
  duplicateOfId: 'inv_1',
  duplicateReason:
    'Same vendor (Baytown Electrical Contractors) and same invoice number (BEC-7781) as an invoice already on the desk.',
  duplicateOf: {
    id: 'inv_1',
    vendorName: 'Baytown Electrical Contractors',
    invoiceNumber: 'BEC-7781',
    status: 'processing',
  },
};

const counts = { processing: 3, needsReview: 1, approvedRejected: 2 };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubList(invoices: Invoice[]) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/status')) throw new Error(`unexpected PATCH to ${url}`);
    if (/\/api\/invoices\/[^?]+$/.test(url)) {
      const id = url.split('/').pop()!;
      const invoice = invoices.find((i) => i.id === id) ?? invoices[0]!;
      return Promise.resolve(
        jsonResponse({ invoice, allowedTransitions: ['approved', 'rejected'] } as DetailResponse),
      );
    }
    return Promise.resolve(jsonResponse({ invoices, counts } as ListResponse));
  });
}

describe('dashboard', () => {
  it('renders the three tabs named in the brief', async () => {
    stubList([baseInvoice]);
    render(<App />);

    expect(await screen.findByRole('tab', { name: /Processing/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Needs review/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Approved \/ Rejected/ })).toBeInTheDocument();
  });

  it('shows per-tab counts from the API', async () => {
    stubList([baseInvoice]);
    render(<App />);

    const tab = await screen.findByRole('tab', { name: /Needs review/ });
    expect(tab).toHaveTextContent('1');
  });

  it('renders an invoice with vendor, number and formatted amount', async () => {
    stubList([baseInvoice]);
    render(<App />);

    expect(await screen.findByText('Baytown Electrical Contractors')).toBeInTheDocument();
    expect(screen.getByText('BEC-7781')).toBeInTheDocument();
    expect(screen.getByText('$8,620.00')).toBeInTheDocument();
  });

  it('shows an empty state when a tab has no invoices', async () => {
    stubList([]);
    render(<App />);

    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
  });

  it('shows an error state and a retry button when the API fails', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' }, 500),
    );
    render(<App />);

    expect(await screen.findByText('Could not load invoices')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('flags the duplicate in the list', async () => {
    stubList([duplicateInvoice]);
    render(<App />);

    expect(await screen.findByText('Duplicate')).toBeInTheDocument();
  });
});

describe('detail drawer', () => {
  it('opens on click and explains why an invoice was flagged', async () => {
    stubList([duplicateInvoice]);
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /Open invoice BEC-7781/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      await screen.findByText(/Same vendor .* and same invoice number/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Flagged as a suspected duplicate/)).toBeInTheDocument();
  });

  it('hides the decision buttons when the invoice is in a terminal state', async () => {
    const approved: Invoice = { ...baseInvoice, status: 'approved' };
    fetchMock.mockImplementation((url: string) => {
      if (/\/api\/invoices\/[^?]+$/.test(url)) {
        return Promise.resolve(
          jsonResponse({ invoice: approved, allowedTransitions: [] } as DetailResponse),
        );
      }
      return Promise.resolve(jsonResponse({ invoices: [approved], counts } as ListResponse));
    });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Open invoice BEC-7781/ }));

    expect(await screen.findByText('No further action')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('approve and reject', () => {
  it('sends a PATCH and reports success', async () => {
    const approved: Invoice = { ...baseInvoice, status: 'approved' };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ status: 'approved' });
        return Promise.resolve(
          jsonResponse({
            invoice: approved,
            allowedTransitions: [],
            counts: { ...counts, processing: 2, approvedRejected: 3 },
          } as UpdateResponse),
        );
      }
      if (/\/api\/invoices\/[^?]+$/.test(url)) {
        return Promise.resolve(
          jsonResponse({
            invoice: baseInvoice,
            allowedTransitions: ['approved', 'rejected'],
          } as DetailResponse),
        );
      }
      return Promise.resolve(jsonResponse({ invoices: [baseInvoice], counts } as ListResponse));
    });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Open invoice BEC-7781/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/BEC-7781 approved\./)).toBeInTheDocument();

    const patches = fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'PATCH');
    expect(patches).toHaveLength(1);
  });

  it('includes the typed note in the request body', async () => {
    let sentBody: unknown = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        sentBody = JSON.parse(String(init.body));
        return Promise.resolve(
          jsonResponse({
            invoice: { ...baseInvoice, status: 'rejected' },
            allowedTransitions: [],
            counts,
          } as UpdateResponse),
        );
      }
      if (/\/api\/invoices\/[^?]+$/.test(url)) {
        return Promise.resolve(
          jsonResponse({
            invoice: baseInvoice,
            allowedTransitions: ['approved', 'rejected'],
          } as DetailResponse),
        );
      }
      return Promise.resolve(jsonResponse({ invoices: [baseInvoice], counts } as ListResponse));
    });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Open invoice BEC-7781/ }));
    await userEvent.type(await screen.findByRole('textbox'), 'Duplicate of BEC-7781.');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(sentBody).toEqual({ status: 'rejected', reason: 'Duplicate of BEC-7781.' }),
    );
  });

  it('surfaces a 409 and does not claim success', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse(
            {
              error: 'ILLEGAL_TRANSITION',
              message: 'Invoice is already approved and cannot be changed.',
            },
            409,
          ),
        );
      }
      if (/\/api\/invoices\/[^?]+$/.test(url)) {
        return Promise.resolve(
          jsonResponse({
            invoice: baseInvoice,
            allowedTransitions: ['approved', 'rejected'],
          } as DetailResponse),
        );
      }
      return Promise.resolve(jsonResponse({ invoices: [baseInvoice], counts } as ListResponse));
    });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Open invoice BEC-7781/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    const toast = await screen.findByText(/already approved and cannot be changed/);
    expect(toast).toBeInTheDocument();
    // The failure is reported as an error, and no success toast is rendered.
    expect(toast).toHaveClass('toast-error');
    expect(document.querySelector('.toast-success')).toBeNull();
  });
});
