/**
 * Errors of the Fax for Agents client.
 *
 * Every API refusal is one envelope: {"error": {"code", "message", "retryable", "correlation_id",
 * "details"}}. The client throws `APIError` (or the subclass for the status) with those fields. The
 * `code` is the stable thing to branch on: quote_expired, insufficient_balance, approval_required and
 * so on. Quote the correlation_id when you write to hello@faxforagents.com.
 */

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
export class PaymentRequiredError extends APIError {}
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
