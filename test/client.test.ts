/** The HTTP layer: headers, idempotency keys, retries, the error envelope, the upload path. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  AuthenticationError,
  ConflictError,
  FaxForAgents,
  InvalidRequestError,
  NotFoundError,
  PaymentRequiredError,
  RateLimitedError,
  ScopeError,
  ServerError,
} from '../src/index.js';
import type {
  DataRequest,
  Delivery,
  DeliveryDetail,
  Invitation,
  NumberOrder,
  PolicyVerdict,
  StatementLine,
  Subscription,
  TopupSession,
  WorkspacePlan,
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

  it('throws the envelope of a 422 and of a 429 upload_queue as the documented error types', async () => {
    // API 1.18.0 declares every error as the envelope. A field that fails validation is no other shape.
    server.use(
      http.post(`${BASE}/v1/fax-quotes`, () =>
        HttpResponse.json(
          { error: { code: 'invalid_request', message: 'to is not a number', retryable: false, correlation_id: null, details: { field: 'to' } } },
          { status: 422 },
        ),
      ),
      http.post(`${BASE}/v1/one-time-sends`, () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'uploads are queued', retryable: true, correlation_id: 'req_2', details: { cap: 'upload_queue' } } },
          { status: 429, headers: { 'Retry-After': '5' } },
        ),
      ),
    );
    const invalid = await client({ maxRetries: 0 })
      .quotes.create({ document_id: 'doc_1', to: 'x' })
      .catch((e: unknown) => e);
    expect(invalid).toBeInstanceOf(InvalidRequestError);
    expect(invalid).toMatchObject({ status: 422, code: 'invalid_request', retryable: false, correlationId: null, details: { field: 'to' } });
    const queued = await client({ maxRetries: 0, maxRetryAfter: 30 })
      .oneTimeSends.create({ text: 'x', to: '+12025550100', email: 'a@example.com', sender_name: 'Ada', accept_aup: true })
      .catch((e: unknown) => e);
    expect(queued).toBeInstanceOf(RateLimitedError);
    expect(queued).toMatchObject({ status: 429, retryable: true, retryAfter: 5, correlationId: 'req_2', details: { cap: 'upload_queue' } });
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


it('completeUpload sends an empty JSON object without a checksum', async () => {
  let body = '';
  let contentType: string | null = null;
  server.use(http.post(`${BASE}/v1/uploads/upl_1/complete`, async ({ request }) => {
    body = await request.text();
    contentType = request.headers.get('content-type');
    return HttpResponse.json({ id: 'upl_1', status: 'completed' });
  }));
  const ffa = new FaxForAgents({ apiKey: KEY, baseUrl: BASE });
  await ffa.documents.completeUpload('upl_1');
  expect(body).toBe('{}');
  expect(contentType).toBe('application/json');
});

describe('operations added with API 1.12.0', () => {
  it('getReceiptPdf returns the bytes', async () => {
    server.use(
      http.get(`${BASE}/v1/faxes/fax_1/receipt.pdf`, () =>
        new HttpResponse(new TextEncoder().encode('%PDF'), { headers: { 'content-type': 'application/pdf' } }),
      ),
    );
    const bytes = await client().faxes.getReceiptPdf('fax_1');
    expect(new TextDecoder().decode(bytes)).toBe('%PDF');
  });

  it('numbers.listOrders reads the order list', async () => {
    server.use(http.get(`${BASE}/v1/number-orders`, () => HttpResponse.json({ items: [] })));
    expect((await client().numbers.listOrders()).items).toEqual([]);
  });

  it('numbers.update sends email_pdf only when given', async () => {
    const number = {
      id: 'num_1', environment: 'live', e164: '+15550001001', country: 'US', number_type: 'local', locality: null,
      status: 'active', label: null, project_id: null, inbound_webhook_id: null, inbound_status: 'enabled',
      email_pdf: false, provider: 'carrier', monthly_micro: 2000000, currency: 'USD', order_id: 'nord_1',
      created_at: '2026-11-13T00:00:00Z', activated_at: '2026-11-13T00:00:00Z', renews_at: null, released_at: null,
    };
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${BASE}/v1/numbers/num_1`, async ({ request }) => {
        const body = (await request.json()) as { email_pdf?: boolean };
        bodies.push(body);
        return HttpResponse.json({ ...number, email_pdf: body.email_pdf ?? number.email_pdf });
      }),
    );
    expect((await client().numbers.update('num_1', { email_pdf: true })).email_pdf).toBe(true);
    // false is a value, not an omission: it switches the attachment off.
    expect((await client().numbers.update('num_1', { email_pdf: false })).email_pdf).toBe(false);
    await client().numbers.update('num_1', { label: 'front desk' });
    expect(bodies).toEqual([{ email_pdf: true }, { email_pdf: false }, { label: 'front desk' }]);
  });

  it('extractions.get reads an extraction without the provider cost', async () => {
    // API 1.19.0 stopped sending provider_cost_micro and the cost_micro of each page.
    const extraction = {
      id: 'ext_1', kind: 'extract', status: 'completed', environment: 'test', document_id: 'doc_1',
      inbox_item_id: null, schema_id: null, schema: null, options: {}, pages_requested: 1, pages_processed: 1,
      pages_escalated: 0, document_pages: 1, confidence: 0.95,
      pages: [{ page: 1, text: 'Fixture text', confidence: 0.95, status: 'ok', model: 'sandbox', warnings: [] }],
      output: null, models: {}, price_micro: 0, currency: 'USD', error_code: null, created_by: 'key:ffa_test_aaaa',
      created_at: '2026-11-13T00:00:00Z', started_at: '2026-11-13T00:00:00Z', completed_at: '2026-11-13T00:00:01Z',
    };
    server.use(http.get(`${BASE}/v1/extractions/ext_1`, () => HttpResponse.json(extraction)));
    const got = await client().extractions.get('ext_1');
    expect(got.price_micro).toBe(0);
    expect(got).not.toHaveProperty('provider_cost_micro');
    expect(got.pages[0]).not.toHaveProperty('cost_micro');
  });

  it('setAutoSend puts the body with an idempotency key', async () => {
    const setting = { environment: 'test', enabled: true, max_amount_micro: 5000000, daily_max_jobs: 5, policy_id: 'pol_1', version: 1 };
    let body: unknown;
    const keys: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/v1/organizations/current/auto-send`, () => HttpResponse.json({ ...setting, enabled: false })),
      http.put(`${BASE}/v1/organizations/current/auto-send`, async ({ request }) => {
        body = await request.json();
        keys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json(setting);
      }),
    );
    const ffa = client();
    expect((await ffa.policies.getAutoSend()).enabled).toBe(false);
    const out = await ffa.policies.setAutoSend({ enabled: true, daily_max_jobs: 5 });
    expect(out.version).toBe(1);
    expect(body).toEqual({ enabled: true, daily_max_jobs: 5 });
    await ffa.policies.setAutoSend({ enabled: true }, { idempotencyKey: 'k1' });
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe('k1');
  });

  it('downloadExportArchive sends the signed values', async () => {
    let url = '';
    server.use(
      http.get(`${BASE}/v1/organization/export-archives/org_1.arc_1`, ({ request }) => {
        url = request.url;
        return new HttpResponse(new TextEncoder().encode('PK'), { headers: { 'content-type': 'application/zip' } });
      }),
    );
    const bytes = await client().organizations.downloadExportArchive('org_1.arc_1', { exp: '1', sig: 's' });
    expect(new TextDecoder().decode(bytes)).toBe('PK');
    expect(url).toBe(`${BASE}/v1/organization/export-archives/org_1.arc_1?exp=1&sig=s`);
  });

  it('oauth.revokeGrant deletes with the given key', async () => {
    let key: string | null = null;
    server.use(
      http.delete(`${BASE}/v1/oauth/grants/grant_1`, ({ request }) => {
        key = request.headers.get('idempotency-key');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await client().oauth.revokeGrant('grant_1', { idempotencyKey: 'k1' });
    expect(key).toBe('k1');
  });
});

describe('filters added in 0.3.1', () => {
  it('faxes.list sends idempotency_key as a query filter, not a header', async () => {
    let url = '';
    let header: string | null = 'unset';
    server.use(
      http.get(`${BASE}/v1/faxes`, ({ request }) => {
        url = request.url;
        header = request.headers.get('idempotency-key');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    await client().faxes.list({ idempotency_key: 'order-42' });
    expect(url).toBe(`${BASE}/v1/faxes?idempotency_key=order-42`);
    expect(header).toBeNull();
  });

  it('policies.effective can ask about a connected app', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BASE}/v1/policies/effective`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({});
      }),
    );
    await client().policies.effective({ connection_id: 'ogr_1' });
    await client().policies.effective();
    expect(urls).toEqual([`${BASE}/v1/policies/effective?connection_id=ogr_1`, `${BASE}/v1/policies/effective`]);
  });
});

describe('API 1.20.5', () => {
  const session = {
    id: 'upl_' + '6'.repeat(32),
    status: 'open',
    filename: 'scan.png',
    content_type: 'image/png',
    declared_size: 9,
    received_size: 0,
    sha256: null,
    created_at: '2026-11-14T00:00:00Z',
    expires_at: '2026-11-14T01:00:00Z',
    completed_at: null,
  };
  const receipt = {
    url: 'https://pay.example.test/receipts/1',
    pdf_url: 'https://pay.example.test/receipts/1/pdf',
    amount_micro: 25_000_000,
    amount_refunded_micro: 0,
    currency: 'USD',
    payment_intent_id: 'pi_1',
    paid_at: '2026-11-14T19:15:26Z',
  };

  it('createUpload needs no content_type and sends none', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/v1/uploads`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(session, { status: 201 });
      }),
    );
    const opened = await client().documents.createUpload({ filename: 'scan.png', size_bytes: 9 });
    expect(opened.content_type).toBe('image/png');
    await client().documents.createUpload({ filename: 'scan.png', size_bytes: 9, content_type: 'image/png' });
    expect(bodies).toEqual([
      { filename: 'scan.png', size_bytes: 9 },
      { filename: 'scan.png', size_bytes: 9, content_type: 'image/png' },
    ]);
  });

  it('createUpload refuses an office filename at once', async () => {
    server.use(http.post(`${BASE}/v1/uploads`, () => HttpResponse.json(apiError('unsupported_format', 'letter.docx is not a PDF or an image'), { status: 422 })));
    const err = await client({ maxRetries: 0 })
      .documents.createUpload({ filename: 'letter.docx', size_bytes: 9 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect((err as InvalidRequestError).code).toBe('unsupported_format');
  });

  it('reads the payment receipt of an invoice and of a top-up', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${BASE}/v1/invoices/in_1/receipt`, ({ request }) => {
        seen.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('idempotency-key')}`);
        return HttpResponse.json({ ...receipt, invoice_id: 'in_1' });
      }),
      http.get(`${BASE}/v1/topup-sessions/tus_1/receipt`, ({ request }) => {
        seen.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('idempotency-key')}`);
        return HttpResponse.json({ ...receipt, topup_session_id: 'tus_1' });
      }),
    );
    const paid = await client().billing.getInvoiceReceipt('in_1');
    expect(paid).toMatchObject({ url: receipt.url, amount_micro: 25_000_000, invoice_id: 'in_1' });
    expect(paid.topup_session_id).toBeUndefined();
    const added = await client().billing.getTopupReceipt('tus_1');
    expect(added.topup_session_id).toBe('tus_1');
    expect(added.pdf_url).toBe(receipt.pdf_url);
    expect(seen).toEqual(['GET /v1/invoices/in_1/receipt null', 'GET /v1/topup-sessions/tus_1/receipt null']);
  });

  it('an unpaid top-up has no receipt', async () => {
    server.use(http.get(`${BASE}/v1/topup-sessions/tus_2/receipt`, () => HttpResponse.json(apiError('conflict', 'this top-up was not paid', { status: 'open' }), { status: 409 })));
    const err = await client()
      .billing.getTopupReceipt('tus_2')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).details).toEqual({ status: 'open' });
    expect((err as ConflictError).state).toBeNull();
  });

  it('NotFoundError.field names the id a quote did not find', async () => {
    server.use(
      http.post(`${BASE}/v1/fax-quotes`, async ({ request }) => {
        const body = (await request.json()) as { from?: string };
        return HttpResponse.json(apiError('not_found', 'no', { field: body.from ? 'from' : 'document_id' }), { status: 404 });
      }),
      http.get(`${BASE}/v1/faxes/fax_x`, () => HttpResponse.json(apiError('not_found', 'no', null), { status: 404 })),
    );
    const doc = await client()
      .quotes.create({ document_id: 'doc_' + '0'.repeat(32), to: '+15550000001' })
      .catch((e: unknown) => e);
    expect(doc).toBeInstanceOf(NotFoundError);
    expect((doc as NotFoundError).field).toBe('document_id');
    const sender = await client()
      .quotes.create({ document_id: 'doc_' + '2'.repeat(32), to: '+15550000001', from: '+14155550199' })
      .catch((e: unknown) => e);
    expect((sender as NotFoundError).field).toBe('from');
    // an older server sends no details, and a field that is not a name is not returned
    const plain = await client()
      .faxes.get('fax_x')
      .catch((e: unknown) => e);
    expect((plain as NotFoundError).field).toBeNull();
    expect(new NotFoundError({ status: 404, code: 'not_found', message: 'no', details: { field: 7 } }).field).toBeNull();
  });

  it('ConflictError.state names the fax state of an early receipt', async () => {
    server.use(http.get(`${BASE}/v1/faxes/fax_y/receipt`, () => HttpResponse.json(apiError('conflict', 'no receipt yet: the fax is active', { state: 'active' }), { status: 409 })));
    const err = await client()
      .faxes.getReceipt('fax_y')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ state: 'active', code: 'conflict', retryable: false });
    expect(new ConflictError({ status: 409, code: 'quote_consumed', message: 'used' }).state).toBeNull();
  });
});

describe('API 1.20.6', () => {
  const line: StatementLine = {
    id: 'led_9',
    created_at: '2026-11-15T09:00:00Z',
    type: 'topup',
    description: 'Top-up',
    amount_micro: 25_000_000,
    balance_after_micro: 125_000_000,
    ref_type: 'topup_session',
    ref_id: 'tus_1',
  };

  it('reads the statement as pages, follows the cursor and returns the CSV as text', async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${BASE}/v1/statement`, ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        if (!url.searchParams.get('cursor')) {
          return HttpResponse.json({ items: [line], next_cursor: 'led_9' });
        }
        return HttpResponse.json({ items: [{ ...line, id: 'led_8', type: 'fax' }], next_cursor: null });
      }),
      http.get(`${BASE}/v1/statement.csv`, ({ request }) => {
        queries.push(new URL(request.url).search);
        return new HttpResponse('date,type,amount\n2026-11-15,topup,25.00\n', {
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        });
      }),
    );
    const page = await client().billing.statement({ kind: 'topup', from: '2026-11-01', to: '2026-11-15', limit: 10 });
    expect(page.items[0]?.balance_after_micro).toBe(125_000_000);
    expect(page.next_cursor).toBe('led_9');
    const ids: string[] = [];
    for await (const item of client().billing.iterStatement({ from: '2026-11-01' })) ids.push(item.id);
    expect(ids).toEqual(['led_9', 'led_8']);
    const csv = await client().billing.statementCsv({ to: '2026-11-15' });
    expect(csv.split('\n')[1]).toBe('2026-11-15,topup,25.00');
    expect(queries).toEqual([
      '?kind=topup&from=2026-11-01&to=2026-11-15&limit=10',
      '?from=2026-11-01',
      '?from=2026-11-01&cursor=led_9',
      '?to=2026-11-15',
    ]);
  });

  it('renames a document and filters the list by source and text', async () => {
    const id = document().id;
    let sent: { body: unknown; key: string | null } | undefined;
    const searches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/documents/${id}`, async ({ request }) => {
        sent = { body: await request.json(), key: request.headers.get('idempotency-key') };
        return HttpResponse.json(document({ filename: 'contract.pdf' }));
      }),
      http.get(`${BASE}/v1/documents`, ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json({ items: [document({ source: 'inbound' })], next_cursor: null, total: 1 });
      }),
    );
    const renamed = await client().documents.rename(id, { filename: 'contract' }, { idempotencyKey: 'k-rename' });
    expect(renamed.filename).toBe('contract.pdf');
    expect(sent).toEqual({ body: { filename: 'contract' }, key: 'k-rename' });
    const page = await client().documents.list({ source: 'inbound', q: '+1415' });
    expect(page.total).toBe(1);
    const all = [];
    for await (const doc of client().documents.iter({ exclude_source: 'inbound', limit: 5 })) all.push(doc);
    expect(all).toHaveLength(1);
    expect(searches).toEqual(['?source=inbound&q=%2B1415', '?exclude_source=inbound&limit=5']);
  });

  it('finds faxes by number or job id and filters the inbox by archived', async () => {
    const searches: string[] = [];
    server.use(
      http.get(`${BASE}/v1/faxes`, ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json({ items: [faxJob({ state: 'failed' })], next_cursor: null });
      }),
      http.get(`${BASE}/v1/inbox`, ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json({ items: [], next_cursor: null, unread: 3 });
      }),
    );
    const page = await client().faxes.list({ q: 'fax_1111', state: 'failed' });
    expect(page.items[0]?.state).toBe('failed');
    for await (const job of client().faxes.iter({ q: '(555) 000-0001' })) expect(job.state).toBe('failed');
    const inbox = await client().inbox.list({ archived: false });
    expect(inbox.unread).toBe(3);
    expect(searches).toEqual(['?q=fax_1111&state=failed', '?q=%28555%29+000-0001', '?archived=false']);
  });

  it('reads one webhook delivery with what was sent', async () => {
    const detail: DeliveryDetail = {
      id: 'dlv_1',
      webhook_id: 'wh_1',
      webhook_url: 'https://example.com/hooks/fax',
      event_id: 'evt_1',
      event_type: 'fax.delivered',
      attempt: 1,
      status: 'delivered',
      response_status: 200,
      error: null,
      duration_ms: 84,
      replay_of: null,
      schedule_s: [0, 60, 300],
      next_attempt_at: null,
      created_at: '2026-11-15T09:00:00Z',
      delivered_at: '2026-11-15T09:00:01Z',
      webhook_deleted: false,
      request_headers: { 'webhook-id': 'evt_1' },
      payload: { type: 'fax.delivered' },
    };
    server.use(http.get(`${BASE}/v1/webhook-deliveries/dlv_1`, () => HttpResponse.json(detail)));
    const got = await client().webhooks.getDelivery('dlv_1');
    expect(got.request_headers['webhook-id']).toBe('evt_1');
    expect(got.payload).toEqual({ type: 'fax.delivered' });
  });

  it('removes a budget, archives an agent and lists the archived ones', async () => {
    const calls: string[] = [];
    server.use(
      http.delete(`${BASE}/v1/budgets/bud_1`, ({ request }) => {
        calls.push(`DELETE budget ${request.headers.get('idempotency-key')?.length}`);
        return HttpResponse.json({ id: 'bud_1', deleted: false, archived: true });
      }),
      http.delete(`${BASE}/v1/agents/agent_1`, ({ request }) => {
        calls.push(`DELETE agent ${request.headers.get('idempotency-key')}`);
        return HttpResponse.json({ id: 'agent_1', deleted: false, archived: true, keys_revoked: 2 });
      }),
      http.get(`${BASE}/v1/budgets`, ({ request }) => {
        calls.push(`GET budgets ${new URL(request.url).search}`);
        return HttpResponse.json({ items: [] });
      }),
      http.get(`${BASE}/v1/agents`, ({ request }) => {
        calls.push(`GET agents ${new URL(request.url).search}`);
        return HttpResponse.json({ items: [] });
      }),
    );
    expect(await client().billing.deleteBudget('bud_1')).toEqual({ id: 'bud_1', deleted: false, archived: true });
    expect((await client().agents.archive('agent_1', { idempotencyKey: 'k-archive' })).keys_revoked).toBe(2);
    await client().billing.listBudgets({ include_archived: true });
    await client().billing.listBudgets();
    await client().agents.list({ include_archived: true });
    expect(calls).toEqual([
      'DELETE budget 36',
      'DELETE agent k-archive',
      'GET budgets ?include_archived=true',
      'GET budgets ',
      'GET agents ?include_archived=true',
    ]);
  });

  it('dismisses a failed number order, and a conflict for any other', async () => {
    const order: NumberOrder = {
      id: 'nor_1',
      environment: 'test',
      status: 'failed',
      e164: '+15550001000',
      country: 'US',
      number_type: 'local',
      number_id: null,
      number: null,
      provider: 'sandbox',
      recurring_charge_micro: 2_000_000,
      recurring_period: 'month',
      first_month_hold_micro: 2_000_000,
      currency: 'USD',
      error: 'Sandbox carrier refused this number order.',
      created_at: '2026-11-15T09:00:00Z',
      completed_at: '2026-11-15T09:00:05Z',
      dismissed_at: '2026-11-15T10:00:00Z',
    };
    let body: string | undefined;
    server.use(
      http.post(
        `${BASE}/v1/number-orders/nor_1/dismissals`,
        sequence(
          () => HttpResponse.json(order),
          () => HttpResponse.json(apiError('conflict', 'this order did not fail'), { status: 409 }),
        ),
      ),
      http.post(`${BASE}/v1/number-orders/nor_2/dismissals`, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json(order);
      }),
    );
    expect((await client().numbers.dismissOrder('nor_1')).dismissed_at).toBe('2026-11-15T10:00:00Z');
    const err = await client()
      .numbers.dismissOrder('nor_1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    await client().numbers.dismissOrder('nor_2');
    expect(body).toBe('');
  });

  it('checks the lists of a draft policy and evaluates a plan for an agent', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/v1/policy-rule-checks`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ already_allowed: [{ number: '+14155550100', countries: ['US'], prefixes: [] }] });
      }),
      http.post(`${BASE}/v1/policy-evaluations`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          decision: 'allow',
          rule: null,
          reason: 'allowed by policy',
          policy_id: 'pol_1',
          policy_version_id: 'polv_1',
          policy_name: 'US only',
          version: 1,
          denials: [],
          plan: {},
          subject: 'agent_1',
          under_policy: true,
          approval_required: false,
        });
      }),
    );
    const check = await client().policies.checkRules({
      allowed_destinations: ['+14155550100', '+447700900123'],
      allowed_countries: ['US'],
    });
    expect(check.already_allowed[0]?.number).toBe('+14155550100');
    const result = await client().policies.evaluate({ to: '+15550000001', agent_id: 'agent_1' });
    expect(result).toMatchObject({ subject: 'agent_1', under_policy: true, approval_required: false });
    expect(bodies).toEqual([
      { allowed_destinations: ['+14155550100', '+447700900123'], allowed_countries: ['US'] },
      { to: '+15550000001', agent_id: 'agent_1' },
    ]);
  });

  it('mails an invitation again and makes a link to hand over', async () => {
    const invitation: Invitation = {
      id: 'inv_1',
      email: 'sam@example.com',
      role: 'member',
      invited_by: 'user_1',
      created_at: '2026-11-15T09:00:00Z',
      expires_at: '2026-11-22T09:00:00Z',
      accepted_at: null,
    };
    const keys: Array<string | null> = [];
    server.use(
      http.post(`${BASE}/v1/invitations/inv_1/resend`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json(invitation);
      }),
      http.post(`${BASE}/v1/invitations/inv_1/link`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json({ id: 'inv_1', url: 'https://app.example.test/join/abc', expires_at: invitation.expires_at });
      }),
    );
    expect((await client().members.resendInvitation('inv_1')).expires_at).toBe('2026-11-22T09:00:00Z');
    expect((await client().members.linkInvitation('inv_1', { idempotencyKey: 'k-link' })).url).toBe(
      'https://app.example.test/join/abc',
    );
    expect(keys[0]).toHaveLength(36);
    expect(keys[1]).toBe('k-link');
  });

  it('lists the data requests and withdraws a deletion', async () => {
    const open: DataRequest = {
      id: 'orq_1',
      kind: 'deletion',
      status: 'open',
      created_at: '2026-11-15T09:00:00Z',
      due_at: '2026-12-15T09:00:00Z',
      closed_at: null,
    };
    server.use(
      http.get(`${BASE}/v1/organizations/current/data-requests`, () => HttpResponse.json({ items: [open] })),
      http.delete(
        `${BASE}/v1/organizations/current/deletion-requests/orq_1`,
        sequence(
          () => HttpResponse.json({ ...open, status: 'withdrawn', closed_at: '2026-11-15T10:00:00Z' }),
          () => HttpResponse.json(apiError('conflict', 'not open any more', { reason: 'request_closed' }), { status: 409 }),
        ),
      ),
    );
    expect((await client().organizations.listDataRequests()).items[0]?.status).toBe('open');
    expect((await client().organizations.withdrawDataDeletion('orq_1')).status).toBe('withdrawn');
    const err = await client()
      .organizations.withdrawDataDeletion('orq_1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).details).toEqual({ reason: 'request_closed' });
  });

  it('finds the used approvals and closes a help request without a reason', async () => {
    const bodies: unknown[] = [];
    let search = '';
    server.use(
      http.get(`${BASE}/v1/approval-requests`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
      http.post(`${BASE}/v1/approval-requests/apr_1/reject`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          id: 'apr_1',
          kind: 'help',
          status: 'rejected',
          quote_id: null,
          bound: {},
          message: 'Which number should I use?',
          requested_by: 'key_1',
          decided_by: 'user_1',
          reason: null,
          consumed_by_job_id: null,
          created_at: '2026-11-15T09:00:00Z',
          expires_at: '2026-11-16T09:00:00Z',
          decided_at: '2026-11-15T09:05:00Z',
        });
      }),
    );
    await client().approvals.list({ status: 'used' });
    expect(search).toBe('?status=used');
    expect((await client().approvals.reject('apr_1')).status).toBe('rejected');
    await client().approvals.reject('apr_1', { reason: 'wrong number' });
    expect(bodies).toEqual([{}, { reason: 'wrong number' }]);
  });
});

describe('API 1.20.8', () => {
  const session: TopupSession = {
    id: 'tus_' + '8'.repeat(32),
    environment: 'live',
    kind: 'manual',
    amount_micro: 25_000_000,
    currency: 'USD',
    status: 'open',
    url: 'https://checkout.example.test/c/pay_1',
    stripe_session_id: 'cs_test_1',
    stripe_payment_intent_id: null,
    auto_topup_id: null,
    error: null,
    created_at: '2026-11-15T09:00:00Z',
    expires_at: '2026-11-16T09:00:00Z',
    completed_at: null,
  };

  it('cancels an open top-up, and a conflict for one that was paid', async () => {
    const seen: Array<{ key: string | null; body: string }> = [];
    server.use(
      http.post(
        `${BASE}/v1/topup-sessions/${session.id}/cancel`,
        sequence(
          () => HttpResponse.json({ ...session, status: 'canceled' }),
          () => HttpResponse.json(apiError('conflict', 'this top-up has no open Checkout to cancel', { status: 'completed' }), { status: 409 }),
        ),
      ),
      http.post(`${BASE}/v1/topup-sessions/tus_2/cancel`, async ({ request }) => {
        seen.push({ key: request.headers.get('idempotency-key'), body: await request.text() });
        return HttpResponse.json({ ...session, id: 'tus_2', kind: 'setup', status: 'canceled' });
      }),
    );
    expect((await client().billing.cancelTopupSession(session.id)).status).toBe('canceled');
    const err = await client()
      .billing.cancelTopupSession(session.id)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).details).toEqual({ status: 'completed' });
    expect((await client().billing.cancelTopupSession('tus_2', { idempotencyKey: 'k-cancel' })).kind).toBe('setup');
    expect(seen).toEqual([{ key: 'k-cancel', body: '' }]);
  });

  it('filters the statement by type, keeps kind, and refuses two different types', async () => {
    const queries: string[] = [];
    const hold: StatementLine = {
      id: 'led_3',
      created_at: '2026-11-15T09:00:00Z',
      type: 'release',
      description: 'Hold released',
      amount_micro: 30_000,
      balance_after_micro: 100_000_000,
      ref_type: 'extraction',
      ref_id: 'ext_1',
    };
    server.use(
      http.get(`${BASE}/v1/statement`, ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        if (url.searchParams.get('type') && url.searchParams.get('kind') && url.searchParams.get('type') !== url.searchParams.get('kind')) {
          return HttpResponse.json(apiError('invalid_request', 'type and kind are one filter: send one of them, or the same type in both', { fields: ['type', 'kind'] }), { status: 422 });
        }
        return HttpResponse.json({ items: [hold], next_cursor: null });
      }),
      http.get(`${BASE}/v1/statement.csv`, ({ request }) => {
        queries.push(new URL(request.url).search);
        return new HttpResponse('date,type\n', { headers: { 'content-type': 'text/csv; charset=utf-8' } });
      }),
    );
    const page = await client().billing.statement({ type: 'release' });
    expect(page.items[0]).toMatchObject({ ref_type: 'extraction', ref_id: 'ext_1' });
    const ids: string[] = [];
    for await (const item of client().billing.iterStatement({ type: 'release', limit: 5 })) ids.push(item.id);
    expect(ids).toEqual(['led_3']);
    await client().billing.statement({ kind: 'release' });
    const err = await client()
      .billing.statement({ type: 'fax', kind: 'topup' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect((err as InvalidRequestError).details).toEqual({ fields: ['type', 'kind'] });
    expect(await client().billing.statementCsv({ type: 'refund', from: '2026-11-01' })).toBe('date,type\n');
    expect(queries).toEqual(['?type=release', '?type=release&limit=5', '?kind=release', '?type=fax&kind=topup', '?type=refund&from=2026-11-01']);
  });

  it('refuses to rotate a key that expired', async () => {
    const details = { reason: 'key_expired', expires_at: '2026-11-01T00:00:00Z' };
    server.use(
      http.post(`${BASE}/v1/api-keys/key_1/rotate`, () =>
        HttpResponse.json(apiError('conflict', 'this key expired, so it cannot be rotated', details), { status: 409 }),
      ),
    );
    const err = await client()
      .identity.rotateApiKey('key_1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', details });
  });

  it('reads the pricing and policy verdict of a quote and what authorized a fax', async () => {
    const verdict: PolicyVerdict = {
      decision: 'allow',
      rule: null,
      reason: 'allowed by policy',
      policy_id: 'pol_1',
      policy_version_id: 'polv_2',
      policy_name: 'US only',
      version: 2,
      managed: null,
      denials: [],
      usage: { day_jobs: 3, day_amount_micro: 117_000, month_jobs: 40, month_amount_micro: 1_560_000 },
    };
    server.use(
      http.post(
        `${BASE}/v1/fax-quotes`,
        sequence(
          () => HttpResponse.json(quote({ pricing: 'one_time', policy_evaluation: verdict }), { status: 201 }),
          () => HttpResponse.json(quote(), { status: 201 }),
        ),
      ),
      http.get(`${BASE}/v1/faxes/${faxJob().id}`, () =>
        HttpResponse.json(faxJob({ approval_id: null, policy_version_id: 'polv_2', route_paused: true })),
      ),
      http.get(`${BASE}/v1/topup-sessions/tus_auto/receipt`, () =>
        HttpResponse.json({
          url: 'https://pay.example.test/receipts/payment/1',
          pdf_url: null,
          amount_micro: 25_000_000,
          amount_refunded_micro: 0,
          currency: 'USD',
          payment_intent_id: 'pi_1',
          paid_at: '2026-11-15T09:00:00Z',
          topup_session_id: 'tus_auto',
        }),
      ),
    );
    const priced = await client().quotes.create({ document_id: 'doc_' + '2'.repeat(32), to: '+15550000001' });
    expect(priced.pricing).toBe('one_time');
    expect(priced.policy_evaluation?.usage?.day_jobs).toBe(3);
    const older = await client().quotes.create({ document_id: 'doc_' + '2'.repeat(32), to: '+15550000001' });
    expect(older.pricing).toBeUndefined();
    expect(older.policy_evaluation).toBeUndefined();
    const job = await client().faxes.get(faxJob().id);
    expect(job).toMatchObject({ approval_id: null, policy_version_id: 'polv_2', route_paused: true });
    const receipt = await client().billing.getTopupReceipt('tus_auto');
    expect(receipt.pdf_url).toBeNull();
    expect(receipt.url).toMatch(/\/receipts\/payment\/1$/);
  });
});

describe('API 1.20.10', () => {
  const session: TopupSession = {
    id: 'tus_' + '8'.repeat(32),
    environment: 'live',
    kind: 'manual',
    amount_micro: 25_000_000,
    currency: 'USD',
    status: 'open',
    url: 'https://checkout.example.test/c/pay_1',
    stripe_session_id: 'cs_test_1',
    stripe_payment_intent_id: null,
    auto_topup_id: null,
    error: null,
    created_at: '2026-11-15T09:00:00Z',
    expires_at: '2026-11-16T09:00:00Z',
    completed_at: null,
  };
  const delivery: Delivery = {
    id: 'dlv_1',
    webhook_id: 'wh_1',
    webhook_url: 'https://example.com/hooks/fax',
    event_id: 'evt_1',
    event_type: 'fax.delivered',
    attempt: 1,
    status: 'failed',
    response_status: null,
    error: 'the webhook was deleted',
    duration_ms: null,
    replay_of: null,
    schedule_s: [0, 60, 300],
    next_attempt_at: null,
    created_at: '2026-11-15T09:00:00Z',
    delivered_at: null,
    webhook_deleted: true,
  };

  it('asks Stripe about the Checkout of a top-up only when told', async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${BASE}/v1/topup-sessions/${session.id}`, ({ request }) => {
        const search = new URL(request.url).search;
        queries.push(search);
        if (search) return HttpResponse.json({ ...session, checkout_status: 'complete' });
        return HttpResponse.json(queries.length === 1 ? { ...session, checkout_status: null } : session);
      }),
    );
    expect((await client().billing.getTopupSession(session.id)).checkout_status).toBeNull();
    const paid = await client().billing.getTopupSession(session.id, { check_checkout: true });
    expect(paid).toMatchObject({ status: 'open', checkout_status: 'complete' });
    expect((await client().billing.getTopupSession(session.id, { check_checkout: false })).checkout_status).toBeUndefined();
    expect(queries).toEqual(['', '?check_checkout=true', '']);
  });

  it('reads webhook_deleted on a delivery and refuses to replay one to a deleted webhook', async () => {
    const { webhook_deleted: _, ...older } = { ...delivery, id: 'dlv_2', status: 'delivered', error: null };
    const replays: string[] = [];
    server.use(
      http.get(`${BASE}/v1/webhook-deliveries`, () => HttpResponse.json({ items: [delivery, older], next_cursor: null })),
      http.post(`${BASE}/v1/webhook-deliveries/:id/replay`, ({ params }) => {
        replays.push(String(params.id));
        return HttpResponse.json(apiError('conflict', 'the webhook of this delivery was deleted', { reason: 'webhook_deleted' }), { status: 409 });
      }),
    );
    const page = await client().webhooks.listDeliveries({ webhook_id: 'wh_1' });
    expect(page.items[0]).toMatchObject({ webhook_deleted: true, next_attempt_at: null });
    expect(page.items[1]!.webhook_deleted).toBeUndefined();
    const err = await client()
      .webhooks.replayDelivery('dlv_1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', details: { reason: 'webhook_deleted' } });
    expect(replays).toEqual(['dlv_1']);
  });
});

describe('API 1.21.0', () => {
  const plan: WorkspacePlan = {
    active: true,
    credit_micro: 10_000_000,
    records_keep_days: 365,
    document_keep_days: 30,
    inbox_keep_days: 90,
    requests_per_minute: 3000,
    plan_requests_per_minute: 3000,
    standard_requests_per_minute: 600,
    included_numbers: 1,
    included_number_id: 'num_1',
    included_number: '+15550001001',
    ended_at: null,
    cleanup_at: null,
    export_open: true,
  };

  it('narrows the fax list to a created range, and refuses a reversed one', async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${BASE}/v1/faxes`, ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        if (url.searchParams.get('created_after') === '2026-11-17T00:00:00Z') {
          return HttpResponse.json(apiError('invalid_request', 'created_after is after created_before'), { status: 422 });
        }
        const cursor = url.searchParams.get('cursor');
        return HttpResponse.json({
          items: [faxJob({ id: cursor ? 'fax_b' : 'fax_a' })],
          next_cursor: cursor ? null : 'c2',
        });
      }),
    );
    const page = await client().faxes.list({
      state: 'delivered',
      created_after: '2026-11-16T00:00:00Z',
      created_before: '2026-11-17T00:00:00Z',
    });
    expect(page.next_cursor).toBe('c2');
    const ids: string[] = [];
    for await (const job of client().faxes.iter({ created_after: '2026-11-16T00:00:00Z' })) ids.push(job.id);
    expect(ids).toEqual(['fax_a', 'fax_b']);
    const err = await client()
      .faxes.list({ created_after: '2026-11-17T00:00:00Z', created_before: '2026-11-16T00:00:00Z' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err).toMatchObject({ status: 422, code: 'invalid_request' });
    expect(queries).toEqual([
      '?state=delivered&created_after=2026-11-16T00%3A00%3A00Z&created_before=2026-11-17T00%3A00%3A00Z',
      '?created_after=2026-11-16T00%3A00%3A00Z',
      '?created_after=2026-11-16T00%3A00%3A00Z&cursor=c2',
      '?created_after=2026-11-17T00%3A00%3A00Z&created_before=2026-11-16T00%3A00%3A00Z',
    ]);
  });

  it('reads what a test quote would cost live', async () => {
    server.use(
      http.post(
        `${BASE}/v1/fax-quotes`,
        sequence(
          () => HttpResponse.json(quote({ price_version: 'launch-v3', billable_pages: 2, live_amount_micro: 78_000 }), { status: 201 }),
          () => HttpResponse.json(quote({ live_amount_micro: null }), { status: 201 }),
          () => HttpResponse.json(quote(), { status: 201 }),
        ),
      ),
    );
    const body = { document_id: 'doc_' + '2'.repeat(32), to: '+15550000001' };
    const priced = await client().quotes.create(body);
    expect(priced).toMatchObject({ amount_micro: 0, live_amount_micro: 78_000 });
    expect((await client().quotes.create(body)).live_amount_micro).toBeNull();
    expect((await client().quotes.create(body)).live_amount_micro).toBeUndefined();
  });

  it('returns the records export as CSV text', async () => {
    const seen: Array<{ path: string; search: string; idempotency: string | null }> = [];
    server.use(
      http.get(`${BASE}/v1/records/:file`, ({ request, params }) => {
        const url = new URL(request.url);
        seen.push({ path: String(params.file), search: url.search, idempotency: request.headers.get('idempotency-key') });
        const text =
          params.file === 'faxes.csv'
            ? 'direction,id,created_at\noutbound,fax_1,2026-11-16T09:00:00Z\n'
            : 'created_at,actor_label\n2026-11-16,Dana Ö\n';
        return new HttpResponse(text, { headers: { 'content-type': 'text/csv; charset=utf-8' } });
      }),
    );
    const history = await client().organizations.faxHistoryCsv({ from: '2026-11-01', to: '2026-11-16' });
    expect(history.split('\n')).toEqual(['direction,id,created_at', 'outbound,fax_1,2026-11-16T09:00:00Z', '']);
    expect(await client().organizations.auditCsv()).toBe('created_at,actor_label\n2026-11-16,Dana Ö\n');
    expect(seen).toEqual([
      { path: 'faxes.csv', search: '?from=2026-11-01&to=2026-11-16', idempotency: null },
      { path: 'audit.csv', search: '', idempotency: null },
    ]);
  });

  it('refuses the records export without the workspace plan', async () => {
    const details = { ended_at: '2026-10-01T00:00:00Z', closed_at: '2026-10-31T00:00:00Z' };
    server.use(
      http.get(`${BASE}/v1/records/faxes.csv`, () =>
        HttpResponse.json(apiError('workspace_required', 'the records export comes with the plan', details), { status: 403 }),
      ),
      http.get(`${BASE}/v1/records/audit.csv`, () =>
        HttpResponse.json(apiError('scope_missing', 'this key lacks org:admin', { scope: 'org:admin' }), { status: 403 }),
      ),
    );
    const err = await client()
      .organizations.faxHistoryCsv({ from: '2026-09-01' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScopeError);
    expect(err).toMatchObject({ status: 403, code: 'workspace_required', details });
    const missing = await client()
      .organizations.auditCsv({ to: '2026-11-16' })
      .catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ScopeError);
    expect(missing).toMatchObject({ code: 'scope_missing', details: { scope: 'org:admin' } });
  });

  it('reads the workspace plan of the subscription list, absent from an older server', async () => {
    server.use(
      http.get(
        `${BASE}/v1/subscriptions`,
        sequence(
          () => HttpResponse.json({ items: [], workspace: true, plan }),
          () => HttpResponse.json({ items: [], workspace: false }),
        ),
      ),
    );
    const listed = await client().billing.listSubscriptions();
    expect(listed.plan).toMatchObject({ export_open: true, requests_per_minute: 3000, standard_requests_per_minute: 600 });
    expect((await client().billing.listSubscriptions()).plan).toBeUndefined();
  });
});

describe('API 1.21.2', () => {
  const end = '2026-12-16T23:23:27.000Z';
  /** A subscription as `sub_json` of billing/subscriptions.py writes it at API 1.21.2. */
  const subscription = (over: Partial<Subscription> = {}): Subscription => ({
    id: 'sub_1',
    product: 'workspace_monthly',
    status: 'active',
    stripe_subscription_id: 'sub_fixture',
    stripe_price_id: 'price_workspace_monthly_test',
    cancel_at_period_end: false,
    cancel_at: null,
    ends_at: null,
    current_period_end: end,
    entitled: true,
    created_at: '2026-11-16T23:23:27.000Z',
    updated_at: '2026-11-16T23:23:27.000Z',
    canceled_at: null,
    ...over,
  });

  it('reads when a subscription ends, absent from an older server', async () => {
    const renewing: Partial<Subscription> = subscription();
    delete renewing.cancel_at;
    delete renewing.ends_at;
    server.use(
      http.get(
        `${BASE}/v1/subscriptions`,
        sequence(
          () =>
            HttpResponse.json({
              items: [subscription({ cancel_at: end, ends_at: end }), subscription({ id: 'sub_2' })],
              workspace: true,
            }),
          () => HttpResponse.json({ items: [renewing], workspace: true }),
        ),
      ),
    );
    const [ending, renews] = (await client().billing.listSubscriptions()).items;
    expect(ending).toMatchObject({ cancel_at_period_end: false, cancel_at: end, ends_at: end });
    expect(renews).toMatchObject({ cancel_at: null, ends_at: null });
    const older = (await client().billing.listSubscriptions()).items[0];
    expect(older?.entitled).toBe(true);
    expect(older?.cancel_at).toBeUndefined();
    expect(older?.ends_at).toBeUndefined();
  });

  it('names the reason a second checkout of the plan is refused', async () => {
    const page = 'https://checkout.stripe.com/c/pay/cs_test_fixture';
    const expires = '2026-11-17T23:23:27.000Z';
    const active = apiError('conflict', 'The Agent workspace is already active for this organization.', {
      reason: 'plan_active',
    });
    const open = apiError('conflict', 'A payment page for the Agent workspace is already open.', {
      reason: 'checkout_open',
      url: page,
      expires_at: expires,
    });
    server.use(
      http.post(
        `${BASE}/v1/subscriptions/checkout`,
        sequence(
          () => HttpResponse.json(active, { status: 409 }),
          () => HttpResponse.json(open, { status: 409 }),
          () => HttpResponse.json({ url: page, stripe_session_id: 'cs_test_fixture', product: 'workspace_monthly' }, { status: 201 }),
        ),
      ),
    );
    const first = await client()
      .billing.createSubscriptionCheckout()
      .catch((e: unknown) => e);
    expect(first).toBeInstanceOf(ConflictError);
    expect(first).toMatchObject({ code: 'conflict', reason: 'plan_active', state: null, retryable: false });
    const second = await client()
      .billing.createSubscriptionCheckout()
      .catch((e: unknown) => e);
    expect(second).toBeInstanceOf(ConflictError);
    expect(second).toMatchObject({ reason: 'checkout_open', details: { url: page, expires_at: expires } });
    expect((await client().billing.createSubscriptionCheckout()).url).toBe(page);
    // a refusal with no details, or a reason that is not a string, has no reason
    expect(new ConflictError({ status: 409, code: 'quote_consumed', message: 'used' }).reason).toBeNull();
    expect(new ConflictError({ status: 409, code: 'conflict', message: 'x', details: { reason: 7 } }).reason).toBeNull();
    expect(new ConflictError({ status: 409, code: 'conflict', message: 'x', details: ['plan_active'] }).reason).toBeNull();
  });
});
