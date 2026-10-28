/**
 * Verify the signature on a webhook delivery (Standard Webhooks, https://www.standardwebhooks.com).
 *
 * Copied from the server's webhooks/signing.py (the reference implementation, 2026-10-28). The server
 * sends three headers on every delivery. `webhook-id` is the event id, stable across retries and
 * replays. `webhook-timestamp` is unix seconds. `webhook-signature` is one or more space-separated
 * `v1,<base64(HMAC-SHA256(secret, "{id}.{timestamp}.{body}"))>` values. During a secret rotation two
 * signatures are sent, one per live secret, for 24 hours. Secrets are `whsec_` followed by base64.
 *
 *   const eventId = await verifyWebhook(secret, req.headers, rawBody);   // throws SignatureError
 *   const event = parseEvent(rawBody);
 *
 * Verify on the raw bytes, before any JSON parsing. Web Crypto is used, so this is async and runs on
 * Node 18+, browsers and edge runtimes alike.
 */

export const SECRET_PREFIX = 'whsec_';
export const TOLERANCE_S = 300;

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

export interface WebhookEvent {
  id: string;
  type: string;
  created_at: string;
  schema_version: number;
  org_id: string;
  environment: string;
  project_id: string | null;
  resource: { type: string; id: string };
  fax_job_id: string | null;
  correlation_id: string | null;
  data: Record<string, unknown>;
  [extra: string]: unknown;
}

type HeaderSource =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null }
  | Iterable<[string, string]>;

const enc = new TextEncoder();

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return b64decode(raw);
}

function toBytes(body: string | Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  if (typeof body === 'string') return enc.encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(body);
}

function headerLookup(headers: HeaderSource): (name: string) => string {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const h = headers as { get(name: string): string | null };
    return (name) => h.get(name) ?? '';
  }
  const map = new Map<string, string>();
  const entries: Iterable<[string, unknown]> =
    typeof (headers as Iterable<[string, string]>)[Symbol.iterator] === 'function'
      ? (headers as Iterable<[string, string]>)
      : Object.entries(headers as Record<string, string | string[] | undefined>);
  for (const [k, v] of entries) {
    const value = Array.isArray(v) ? v.join(' ') : v;
    if (typeof value === 'string') map.set(k.toLowerCase(), value);
  }
  return (name) => map.get(name) ?? '';
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

/** The signature the server computes. Exposed so a test receiver can forge a valid delivery. */
export async function sign(
  secret: string,
  msgId: string,
  timestamp: number,
  body: string | Uint8Array | ArrayBuffer,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const prefix = enc.encode(`${msgId}.${timestamp}.`);
  const payload = toBytes(body);
  const toSign = new Uint8Array(prefix.length + payload.length);
  toSign.set(prefix, 0);
  toSign.set(payload, prefix.length);
  const digest = await crypto.subtle.sign('HMAC', key, toSign);
  return 'v1,' + b64encode(new Uint8Array(digest));
}

/** The three headers of a delivery, for tests and local tooling. */
export async function signatureHeaders(
  secrets: string[],
  msgId: string,
  body: string | Uint8Array | ArrayBuffer,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const sigs = await Promise.all(secrets.map((s) => sign(s, msgId, timestamp, body)));
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': sigs.join(' '),
    'content-type': 'application/json',
  };
}

/**
 * Return the event id when a signature matches and the timestamp is fresh. Throw SignatureError
 * otherwise. `headers` may be a Headers object, a plain object (Node's IncomingMessage.headers) or
 * entries. `body` is the raw request body.
 */
export async function verifyWebhook(
  secret: string,
  headers: HeaderSource,
  body: string | Uint8Array | ArrayBuffer,
  opts: { now?: number; toleranceS?: number } = {},
): Promise<string> {
  const get = headerLookup(headers);
  const msgId = get('webhook-id');
  const tsRaw = get('webhook-timestamp');
  const sigs = get('webhook-signature');
  if (!msgId || !tsRaw || !sigs) throw new SignatureError('missing webhook headers');
  if (!/^\d+$/.test(tsRaw.trim())) throw new SignatureError('bad timestamp');
  const ts = Number(tsRaw);
  const now = opts.now ?? Date.now() / 1000;
  if (Math.abs(now - ts) > (opts.toleranceS ?? TOLERANCE_S)) throw new SignatureError('timestamp outside tolerance');
  const expected = await sign(secret, msgId, ts, body);
  for (const candidate of sigs.split(/\s+/)) {
    if (candidate.startsWith('v1,') && timingSafeEqual(candidate, expected)) return msgId;
  }
  throw new SignatureError('no matching signature');
}

/** Parse a verified body. Call verifyWebhook first. */
export function parseEvent(body: string | Uint8Array | ArrayBuffer): WebhookEvent {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(toBytes(body));
  return JSON.parse(text) as WebhookEvent;
}
