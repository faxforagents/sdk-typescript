/**
 * Errors of the Fax for Agents client.
 *
 * Every API refusal is one envelope: {"error": {"code", "message", "retryable", "correlation_id",
 * "details"}}. The client throws `APIError` (or the subclass for the status) with those fields. The
 * `code` is the stable thing to branch on: quote_expired, insufficient_balance, approval_required and
 * so on. Quote the correlation_id when you write to hello@faxforagents.com.
 */

import type { InsufficientBalance } from './schema.js';

/**
 * `details.one_time_offer` of 402 insufficient_balance: the card path for this exact send. A pointer,
 * never a promise: `oneTimeSends.createFromQuote` runs every check again.
 */
export type OneTimeOffer = NonNullable<InsufficientBalance['error']['details']['one_time_offer']>;

export class FaxForAgentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The API could not be reached, or the connection dropped. */
export class APIConnectionError extends FaxForAgentsError {}

/** The request ran past its timeout. */
export class APITimeoutError extends APIConnectionError {}

export interface APIErrorFields {
  status: number;
  code: string;
  message: string;
  retryable?: boolean;
  correlationId?: string | null;
  details?: unknown;
  retryAfter?: number | null;
}

/** The API answered with an error envelope. */
export class APIError extends FaxForAgentsError {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly correlationId: string | null;
  readonly details: unknown;
  /** Seconds the API asked us to wait (429), when it said. */
  readonly retryAfter: number | null;

  constructor(f: APIErrorFields) {
    super(`${f.code}: ${f.message}${f.correlationId ? ` (correlation ${f.correlationId})` : ''}`);
    this.status = f.status;
    this.code = f.code;
    this.retryable = f.retryable ?? false;
    this.correlationId = f.correlationId ?? null;
    this.details = f.details;
    this.retryAfter = f.retryAfter ?? null;
  }
}

/** 400 or 422: the request did not pass validation. */
export class InvalidRequestError extends APIError {}
/** 401 invalid_token: no key, or a revoked or expired one. */
export class AuthenticationError extends APIError {}
/** 402 insufficient_balance: the wallet does not cover the fax. A person tops up. */
export class PaymentRequiredError extends APIError {
  /**
   * `details.top_up_url`: the dashboard page where a person adds funds, else null. A key cannot top up.
   * Servers send it since API 1.17.0.
   */
  get topUpUrl(): string | null {
    const details = this.details as { top_up_url?: unknown } | null | undefined;
    const url = details && typeof details === 'object' ? details.top_up_url : null;
    return typeof url === 'string' ? url : null;
  }
  /**
   * `details.one_time_offer` when the server sent one, else null. Present when this exact send can be
   * paid by card: it names the one-time price in `amount_micro`, the page counts and the `approval_id`
   * that authorizes the order. Pass the quote to `oneTimeSends.createFromQuote`. Servers send it since
   * API 1.17.0.
   */
  get oneTimeOffer(): OneTimeOffer | null {
    const details = this.details as { one_time_offer?: unknown } | null | undefined;
    const offer = details && typeof details === 'object' ? details.one_time_offer : null;
    return offer && typeof offer === 'object' ? (offer as OneTimeOffer) : null;
  }
}
/** 403: the key lacks the scope (details.scope), or an agent key tried to administer. */
export class ScopeError extends APIError {}
/** 404 not_found: not an id of this organization, or deleted. */
export class NotFoundError extends APIError {}
/** 409: the resource refuses this change (quote_consumed, not_cancelable). */
export class ConflictError extends APIError {}
/** 429 rate_limited. retryAfter is the seconds the API asked for. */
export class RateLimitedError extends APIError {}
/** 5xx: the API failed. The client already retried. */
export class ServerError extends APIError {}

const BY_STATUS: Record<number, new (f: APIErrorFields) => APIError> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  402: PaymentRequiredError,
  403: ScopeError,
  404: NotFoundError,
  409: ConflictError,
  422: InvalidRequestError,
  429: RateLimitedError,
};

export function errorFor(
  status: number,
  payload: unknown,
  opts: { retryAfter?: number | null; text?: string } = {},
): APIError {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  let err = body && body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : null;
  if (!err) {
    err = {
      code: `http_${status}`,
      message: (opts.text ?? '').slice(0, 200) || `HTTP ${status}`,
      details: body?.detail,
    };
  }
  const Cls = status >= 500 ? ServerError : (BY_STATUS[status] ?? APIError);
  return new Cls({
    status,
    code: String(err.code ?? `http_${status}`),
    message: String(err.message ?? `HTTP ${status}`),
    retryable: typeof err.retryable === 'boolean' ? err.retryable : [429, 502, 503, 504].includes(status),
    correlationId: typeof err.correlation_id === 'string' ? err.correlation_id : null,
    details: err.details,
    retryAfter: opts.retryAfter ?? null,
  });
}
