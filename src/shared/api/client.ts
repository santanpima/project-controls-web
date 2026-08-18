// The typed API client (4.1.1.1.2) — targets the real Backend API this
// frontend actually talks to. One real deviation from the specification
// worth being explicit about: 1.4.2.1.3 describes attaching a Firebase
// Bearer token to every request. This backend was never built against
// Firebase/Identity Platform (see the Implementation Status Update
// document for the full reasoning behind that substitution) — it issues
// its own signed JWT from POST /api/auth/login. The Bearer-token
// *pattern* itself is unchanged; only where the token comes from differs.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// The current token is read via this injectable getter, set once by
// AuthContext at app startup, rather than this module importing
// AuthContext directly — avoids a circular dependency between the API
// client and the auth layer that consumes it.
let getToken: () => string | null = () => null;
export function setTokenGetter(fn: () => string | null): void {
  getToken = fn;
}

// One handler, called on every 401, so a session expiring mid-use is
// handled in exactly one place rather than duplicated at every call site.
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(API_BASE_URL + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<TResponse>(
  path: string,
  options: RequestOptions = {}
): Promise<TResponse> {
  const { method = "GET", body, query } = options;
  const token = getToken();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    onUnauthorized();
  }

  // 204 No Content has no body to parse — every DELETE in this backend
  // returns this, per its own established convention.
  if (response.status === 204) {
    return undefined as TResponse;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request to ${path} failed with status ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as TResponse;
}
