/**
 * The HTTP layer under the client: one key, one base URL, idempotency keys, retries, the error envelope.
 *
 * - Every mutating call (POST, PATCH, DELETE) carries an Idempotency-Key. When the caller passes none, a
 *   UUID is minted once per call and reused on every retry, so a retried send never creates a second fax.
 * - 429 and 5xx answers are retried up to `maxRetries` times. Retry-After is honoured (seconds or an
 *   HTTP date, capped at `maxRetryAfter` seconds). Otherwise the wait is exponential with full jitter
 *   from `backoffBase`. Network errors and timeouts are retried the same way.
 * - An error status throws APIError or the subclass for that status (errors.ts).
 *
 * Only `fetch` is used, so it runs on Node 18+, Deno, Bun, browsers and edge runtimes.
 */

import { APIConnectionError, APITimeoutError, errorFor } from './errors.js';
import { VERSION } from './version.js';

export const DEFAULT_BASE_URL = 'https://api.faxforagents.com';
const MUTATING = new Set(['POST', 'PATCH', 'DELETE']);
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface ClientOptions {
  /** ffa_live_... or ffa_test_... Defaults to FAXFORAGENTS_API_KEY (then FFA_API_KEY) in the environment. */
  apiKey?: string;
  /** Defaults to FAXFORAGENTS_API_URL in the environment, then https://api.faxforagents.com. */
  baseUrl?: string;
  /** Per attempt, in milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Retries after the first attempt for 429, 5xx and network errors. Default 3. */
  maxRetries?: number;
  /** Base of the exponential backoff in seconds. Default 0.5. */
  backoffBase?: number;
  /** The longest Retry-After honoured, in seconds. Default 30. */
  maxRetryAfter?: number;
  /** A fetch to use instead of the global one (tests, custom agents). */
  fetch?: typeof fetch;
  /** Headers added to every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

function env(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name];
}

export function resolveKey(key: string | undefined): string {
  const value = (key ?? env('FAXFORAGENTS_API_KEY') ?? env('FFA_API_KEY') ?? '').trim();
  if (!value) {
    throw new Error(
      'no API key: pass apiKey or set FAXFORAGENTS_API_KEY. Keys are created in the Fax for Agents dashboard or with POST /v1/api-keys.',
    );
  }
  return value;
}

export function retryAfterSeconds(value: string | null, cap: number): number | null {
  if (!value) return null;
  const n = Number(value.trim());
  if (Number.isFinite(n)) return Math.min(Math.max(n, 0), cap);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.min((at - Date.now()) / 1000, cap));
}

export function cleanParams(params: RequestOptions['params']): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function stripNulls(json: unknown): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, s * 1000)));

export class Http {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBase: number;
  private readonly maxRetryAfter: number;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = resolveKey(opts.apiKey);
    this.baseUrl = (opts.baseUrl ?? env('FAXFORAGENTS_API_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 3);
    this.backoffBase = opts.backoffBase ?? 0.5;
    this.maxRetryAfter = opts.maxRetryAfter ?? 30;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.extraHeaders = opts.headers ?? {};
  }

  private waitFor(attempt: number, retryAfter: string | null): number {
    const explicit = retryAfterSeconds(retryAfter, this.maxRetryAfter);
    if (explicit !== null) return explicit;
    return Math.random() * this.backoffBase * 2 ** attempt;
  }

  /** The raw Response of a successful call. Throws APIError on 4xx/5xx after the retries. */
  async send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const m = method.toUpperCase();
    const url = (path.startsWith('http') ? path : this.baseUrl + path) + cleanParams(opts.params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `faxforagents-js/${VERSION}`,
      ...this.extraHeaders,
      ...(opts.headers ?? {}),
    };
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(stripNulls(opts.json));
    }
    if (MUTATING.has(m) && !('Idempotency-Key' in headers)) {
      headers['Idempotency-Key'] = opts.idempotencyKey ?? crypto.randomUUID();
    }

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let resp: Response;
      try {
        resp = await this.fetchImpl(url, { method: m, headers, body, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        const timedOut = (err as { name?: string })?.name === 'AbortError';
        if (attempt >= this.maxRetries) {
          if (timedOut) throw new APITimeoutError(`${m} ${path} timed out after ${this.timeoutMs} ms`);
          throw new APIConnectionError(`${this.baseUrl} not reachable (${(err as Error)?.message ?? err})`);
        }
        await sleep(this.waitFor(attempt, null));
        attempt += 1;
        continue;
      }
      clearTimeout(timer);
      if (RETRY_STATUSES.has(resp.status) && attempt < this.maxRetries) {
        await resp.text().catch(() => undefined);
        await sleep(this.waitFor(attempt, resp.headers.get('retry-after')));
        attempt += 1;
        continue;
      }
      if (resp.status >= 400) {
        const text = await resp.text();
        let payload: unknown = null;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
        throw errorFor(resp.status, payload, {
          retryAfter: retryAfterSeconds(resp.headers.get('retry-after'), this.maxRetryAfter),
          text,
        });
      }
      return resp;
    }
  }

  /** The parsed JSON of a successful call, typed by the caller. */
  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const resp = await this.send(method, path, opts);
    const ctype = resp.headers.get('content-type') ?? '';
    if (resp.status === 204 || !ctype.startsWith('application/json')) {
      const text = await resp.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    return (await resp.json()) as T;
  }

  /** The bytes of a successful call (signed download URLs). */
  async bytes(method: string, path: string, opts: RequestOptions = {}): Promise<Uint8Array> {
    const resp = await this.send(method, path, opts);
    return new Uint8Array(await resp.arrayBuffer());
  }
}

/** Follow next_cursor until the API returns none. */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; next_cursor?: string | null }>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items ?? []) yield item;
    if (!page.next_cursor) return;
    cursor = page.next_cursor;
  }
}
