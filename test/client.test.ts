/** The HTTP layer: headers, idempotency keys, retries, the error envelope, the upload path. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  AuthenticationError,
  ConflictError,
  FaxForAgents,
  NotFoundError,
  PaymentRequiredError,
  RateLimitedError,
  ScopeError,
  ServerError,
} from '../src/index.js';
import { BASE, HttpResponse, KEY, apiError, document, faxJob, http, quote, sequence, server } from './helpers.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = (opts = {}) => new FaxForAgents({ apiKey: KEY, baseUrl: BASE, backoffBase: 0, maxRetryAfter: 0, ...opts });

describe('headers', () => {
  it('sends the bearer key and a user agent, no idempotency key on GET', async () => {
    let seen: Headers | undefined;
    server.use(
      http.get(`${BASE}/v1/me`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({
          org_id: 'org_1',
          project_id: 'proj_1',
          key_id: 'key_1',
          key_prefix: 'ffa_test_aaaa',
          environment: 'test',
          scopes: ['fax:send'],
          actor: 'key:ffa_test_aaaa',
        });
      }),
    );
    const me = await client().me();
    expect(me.environment).toBe('test');
    expect(seen?.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(seen?.get('user-agent')).toMatch(/^faxforagents-js\//);
    expect(seen?.get('idempotency-key')).toBeNull();
  });

  it('reads the key from the environment and refuses without one', () => {
    const saved = process.env.FAXFORAGENTS_API_KEY;
    process.env.FAXFORAGENTS_API_KEY = KEY;
    expect(() => new FaxForAgents({ baseUrl: BASE })).not.toThrow();
    delete process.env.FAXFORAGENTS_API_KEY;
    process.env.FFA_API_KEY = KEY;
    expect(() => new FaxForAgents({ baseUrl: BASE })).not.toThrow();
    delete process.env.FFA_API_KEY;
    expect(() => new FaxForAgents({ baseUrl: BASE })).toThrow(/FAXFORAGENTS_API_KEY/);
    if (saved) process.env.FAXFORAGENTS_API_KEY = saved;
  });
});

describe('idempotency', () => {
  it('mints a UUID per mutating call and honours an explicit key', async () => {
    const keys: string[] = [];
    let body: unknown;
    server.use(
      http.post(`${BASE}/v1/faxes`, async ({ request }) => {
        keys.push(request.headers.get('idempotency-key') ?? '');
        body = await request.json();
        return HttpResponse.json(faxJob(), { status: 201 });
      }),
    );
    const c = client();
    await c.faxes.create({ quote_id: 'quote_1' });
    await c.faxes.create({ quote_id: 'quote_1' });
    await c.faxes.create({ quote_id: 'quote_1', client_reference: null }, { idempotencyKey: 'order-42' });
    expect(keys[0]).toHaveLength(36);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe('order-42');
    expect(body).toEqual({ quote_id: 'quote_1' });
  });

  it('reuses the same key on a 429 retry', async () => {
    const keys: string[] = [];
    const answer = sequence(
      () => HttpResponse.json(apiError('rate_limited'), { status: 429, headers: { 'Retry-After': '0' } }),
      () => HttpResponse.json(faxJob(), { status: 201 }),
    );
    server.use(
      http.post(`${BASE}/v1/faxes`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key') ?? '');
        return answer();
      }),
    );
    const job = await client().faxes.create({ quote_id: 'quote_1' });
    expect(job.state).toBe('queued');
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('retries', () => {
  it('retries 503 then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/balance`, () => {
        calls += 1;
        if (calls < 3) return HttpResponse.text('upstream', { status: 503 });
        return HttpResponse.json({ environment: 'test', currency: 'USD', available_micro: 100_000_000, held_micro: 0 });
      }),
    );
    const b = await client().billing.balance();
    expect(b.available_micro).toBe(100_000_000);
    expect(calls).toBe(3);
  });

  it('is bounded by maxRetries and throws ServerError', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/balance`, () => {
        calls += 1;
        return HttpResponse.json(apiError('temporarily_unavailable'), { status: 503 });
      }),
    );
    await expect(client({ maxRetries: 2 }).billing.balance()).rejects.toBeInstanceOf(ServerError);
    expect(calls).toBe(3);
  });

  it('carries retryAfter and the correlation id on a 429 without retries', async () => {
    server.use(
      http.get(`${BASE}/v1/balance`, () =>
        HttpResponse.json(apiError('rate_limited'), { status: 429, headers: { 'Retry-After': '7' } }),
      ),
    );
    const err = await client({ maxRetries: 0, maxRetryAfter: 30 })
      .billing.balance()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfter).toBe(7);
    expect((err as RateLimitedError).correlationId).toBe('req_1');
  });

  it('retries network errors then throws APIConnectionError', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/balance`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    await expect(client({ maxRetries: 1 }).billing.balance()).rejects.toBeInstanceOf(APIConnectionError);
    expect(calls).toBe(2);
  });
});

describe('errors', () => {
  it.each([
    [401, 'invalid_token', AuthenticationError],
    [403, 'scope_missing', ScopeError],
    [404, 'not_found', NotFoundError],
    [409, 'quote_consumed', ConflictError],
    [402, 'insufficient_balance', PaymentRequiredError],
  ])('%i %s maps to a typed error', async (status, code, cls) => {
    server.use(
      http.get(`${BASE}/v1/faxes/fax_x`, () => HttpResponse.json(apiError(code, 'no', { scope: 'fax:read' }), { status })),
    );
    const err = await client()
      .faxes.get('fax_x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(cls);
    const e = err as InstanceType<typeof cls>;
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    expect(e.details).toEqual({ scope: 'fax:read' });
    expect(e.message).toContain('req_1');
  });

  it('handles a non-JSON error body', async () => {
    server.use(http.get(`${BASE}/v1/faxes/fax_x`, () => HttpResponse.text('<html>not here</html>', { status: 404 })));
    const err = await client()
      .faxes.get('fax_x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('http_404');
  });
});

describe('documents', () => {
  it('upload runs the whole PDF path with the sha256', async () => {
    const data = new TextEncoder().encode('%PDF-1.4 fake');
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const session = {
      id: 'upl_' + '4'.repeat(32),
      status: 'open',
      filename: 'letter.pdf',
      content_type: 'application/pdf',
      declared_size: data.byteLength,
      received_size: 0,
      sha256: null,
      created_at: '2026-10-28T00:00:00Z',
      expires_at: '2026-10-28T01:00:00Z',
      completed_at: null,
      upload_url: `${BASE}/v1/uploads/upl_4444/content?exp=1&sig=abc`,
      upload_method: 'PUT',
      upload_url_expires_at: '2026-10-28T00:10:00Z',
    };
    const seen: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/v1/uploads`, async ({ request }) => {
        seen.create = await request.json();
        return HttpResponse.json(session, { status: 201 });
      }),
      http.put(`${BASE}/v1/uploads/upl_4444/content`, async ({ request }) => {
        seen.put = new Uint8Array(await request.arrayBuffer());
        seen.putType = request.headers.get('content-type');
        seen.putIdem = request.headers.get('idempotency-key');
        return HttpResponse.json({ ...session, received_size: data.byteLength });
      }),
      http.post(`${BASE}/v1/uploads/${session.id}/complete`, async ({ request }) => {
        seen.complete = await request.json();
        return HttpResponse.json({ ...session, status: 'completed', sha256: sha });
      }),
      http.post(`${BASE}/v1/documents`, async ({ request }) => {
        seen.doc = await request.json();
        return HttpResponse.json(document({ source: 'upload', upload_id: session.id }), { status: 201 });
      }),
    );
    const out = await client().documents.upload(data, { filename: 'letter.pdf' });
    expect(out.upload_id).toBe(session.id);
    expect(seen.create).toEqual({ filename: 'letter.pdf', content_type: 'application/pdf', size_bytes: data.byteLength });
    expect(seen.put).toEqual(data);
    expect(seen.putType).toBe('application/pdf');
    expect(seen.putIdem).toBeNull();
    expect(seen.complete).toEqual({ sha256: sha });
    expect(seen.doc).toEqual({ upload_id: session.id, filename: 'letter.pdf' });
  });

  it('upload names the image type from the filename', async () => {
    const data = new TextEncoder().encode('\x89PNG fake');
    const session = {
      id: 'upl_' + '5'.repeat(32),
      status: 'open',
      filename: 'scan.png',
      content_type: 'image/png',
      declared_size: data.byteLength,
      received_size: 0,
      sha256: null,
      created_at: '2026-10-28T00:00:00Z',
      expires_at: '2026-10-28T01:00:00Z',
      completed_at: null,
      upload_url: `${BASE}/v1/uploads/upl_5555/content?exp=1&sig=abc`,
      upload_method: 'PUT',
      upload_url_expires_at: '2026-10-28T00:10:00Z',
    };
    const seen: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/v1/uploads`, async ({ request }) => {
        seen.create = await request.json();
        return HttpResponse.json(session, { status: 201 });
      }),
      http.put(`${BASE}/v1/uploads/upl_5555/content`, ({ request }) => {
        seen.putType = request.headers.get('content-type');
        return HttpResponse.json({ ...session, received_size: data.byteLength });
      }),
      http.post(`${BASE}/v1/uploads/${session.id}/complete`, () => HttpResponse.json({ ...session, status: 'completed' })),
      http.post(`${BASE}/v1/documents`, () =>
        HttpResponse.json(document({ source: 'upload', upload_id: session.id }), { status: 201 }),
      ),
    );
    await client().documents.upload(data, { filename: 'scan.png' });
    expect((seen.create as { content_type: string }).content_type).toBe('image/png');
    expect(seen.putType).toBe('image/png');
  });

  it('download follows the signed URL', async () => {
    server.use(
      http.get(`${BASE}/v1/documents/doc_1/download`, () =>
        HttpResponse.json({ url: `${BASE}/v1/documents/doc_1/content?exp=1&sig=s`, expires_at: 'x', content_type: 'application/pdf' }),
      ),
      http.get(`${BASE}/v1/documents/doc_1/content`, () =>
        new HttpResponse(new TextEncoder().encode('%PDF'), { headers: { 'content-type': 'application/pdf' } }),
      ),
    );
    const bytes = await client().documents.download('doc_1');
    expect(new TextDecoder().decode(bytes)).toBe('%PDF');
  });
});

describe('faxes', () => {
  it('wait polls until a terminal state', async () => {
    server.use(
      http.get(
        `${BASE}/v1/faxes/fax_1`,
        sequence(
          () => HttpResponse.json(faxJob({ id: 'fax_1', state: 'queued' })),
          () => HttpResponse.json(faxJob({ id: 'fax_1', state: 'active' })),
          () => HttpResponse.json(faxJob({ id: 'fax_1', state: 'delivered', pages_sent: 1, evidence: { pages: 1 } })),
        ),
      ),
    );
    const job = await client().faxes.wait('fax_1', { intervalMs: 0 });
    expect(job.state).toBe('delivered');
    expect(job.evidence).toEqual({ pages: 1 });
  });

  it('drops null and undefined query params', async () => {
    let url = '';
    server.use(
      http.get(`${BASE}/v1/faxes`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    await client().faxes.list({ state: 'failed', cursor: undefined });
    expect(url).toBe(`${BASE}/v1/faxes?state=failed`);
  });

  it('quote body keeps the API field names', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/v1/fax-quotes`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(quote(), { status: 201 });
      }),
    );
    await client().quotes.create({ document_id: 'doc_1', to: '+15550000001', from: '+12025550100' });
    expect(body).toEqual({ document_id: 'doc_1', to: '+15550000001', from: '+12025550100' });
  });
});
