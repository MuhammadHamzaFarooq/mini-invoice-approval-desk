import type {
  DetailResponse,
  ListResponse,
  Status,
  TabKey,
  UpdateResponse,
  ApiErrorBody,
} from './types';

/**
 * In development this is empty, so requests go to /api/... on the Vite dev
 * server, which proxies to Express. In a deployed build, set VITE_API_BASE_URL
 * to the API's origin — the only configuration the frontend needs.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** Thrown for any non-2xx response, carrying the API's own error body. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch only rejects on a network-level failure, so this is genuinely
    // "the API is unreachable" rather than an application error.
    throw new ApiError(0, null, 'Could not reach the API. Is the server running?');
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error body; fall through to the generic message */
    }
    throw new ApiError(res.status, body, `Request failed with status ${res.status}.`);
  }

  return (await res.json()) as T;
}

export function listInvoices(tab?: TabKey, signal?: AbortSignal): Promise<ListResponse> {
  const qs = tab ? `?tab=${encodeURIComponent(tab)}` : '';
  return request<ListResponse>(`/api/invoices${qs}`, { signal });
}

export function getInvoice(id: string, signal?: AbortSignal): Promise<DetailResponse> {
  return request<DetailResponse>(`/api/invoices/${encodeURIComponent(id)}`, { signal });
}

export function updateInvoiceStatus(
  id: string,
  status: Extract<Status, 'approved' | 'rejected'>,
  reason?: string,
): Promise<UpdateResponse> {
  return request<UpdateResponse>(`/api/invoices/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(reason?.trim() ? { status, reason: reason.trim() } : { status }),
  });
}
