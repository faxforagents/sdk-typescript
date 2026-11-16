/** The one-time send: one fax paid by card. Requests and answers against fixtures/one-time.json. */
import { readFileSync } from 'node:fs';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FaxForAgents, InvalidRequestError, NotFoundError, ORDER_TOKEN_HEADER, PaymentRequiredError, ServerError } from '../src/index.js';
import type { OneTimeOrder, OneTimeOrderCreated } from '../src/index.js';
import { BASE, HttpResponse, KEY, apiError, http, sequence, server } from './helpers.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Case = { name: string; body: Record<string, unknown> };
const CASES = Object.fromEntries(
  (JSON.parse(readFileSync(new URL('./fixtures/one-time.json', import.meta.url), 'utf8')) as Case[]).map((c) => [
    c.name,
    c.body,
  ]),
) as Record<string, Record<string, unknown>>;
const created = CASES.created as unknown as OneTimeOrderCreated;
const ORDER = created.id;
const TOKEN = created.status_token as string;
const ROOT = `${BASE}/v1/one-time-sends`;

const opts = { baseUrl: BASE, backoffBase: 0, maxRetryAfter: 0 };
const keyless = () => new FaxForAgents({ ...opts, keyless: true });
const keyed = () => new FaxForAgents({ ...opts, apiKey: KEY });

describe('one-time sends', () => {
  it('reads the config with no key', async () => {
    let seen: Headers | undefined;
    server.use(
      http.get(`${ROOT}/config`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json(CASES.config);
      }),
    );
    const config = await keyless().oneTimeSends.config();
    expect(config.enabled).toBe(true);
    expect(config.price_version).toBe('launch-v2');
    expect(config.routes.us_ca?.flat_micro).toBe(2_490_000);
    expect(seen?.get('authorization')).toBeNull();
  });

  it('a keyless client ignores the key in the environment', async () => {
    const saved = process.env.FAXFORAGENTS_API_KEY;
    process.env.FAXFORAGENTS_API_KEY = KEY;
    let seen: Headers | undefined;
    server.use(
      http.get(`${ROOT}/config`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json(CASES.config);
      }),
    );
    try {
      await keyless().oneTimeSends.config();
    } finally {
      if (saved === undefined) delete process.env.FAXFORAGENTS_API_KEY;
      else process.env.FAXFORAGENTS_API_KEY = saved;
    }
    expect(seen?.get('authorization')).toBeNull();
  });

  it('creates from text as JSON', async () => {
    let seen: Request | undefined;
    let sent: unknown;
    server.use(
      http.post(ROOT, async ({ request }) => {
        seen = request;
        sent = await request.clone().json();
        return HttpResponse.json(CASES.created, { status: 201 });
      }),
    );
    const order = await keyless().oneTimeSends.create({
      to: '+12025550123',
      sender_name: 'Dana Example',
      accept_aup: true,
      email: 'sender@example.com',
      text: '# Signed form',
      text_format: 'markdown',
    });
    expect(order.id).toBe(ORDER);
    expect(order.next).toBe('checkout');
    expect(order.status_token).toBe(TOKEN);
    expect(seen?.headers.get('content-type')).toBe('application/json');
    expect(seen?.headers.get('idempotency-key')).toBeTruthy();
    expect(seen?.headers.get('authorization')).toBeNull();
    expect(sent).toEqual({
      to: '+12025550123',
      sender_name: 'Dana Example',
      accept_aup: true,
      email: 'sender@example.com',
      text: '# Signed form',
      text_format: 'markdown',
    });
  });

  it('creates from a file as multipart', async () => {
    let seen: Request | undefined;
    let form: FormData | undefined;
    server.use(
      http.post(ROOT, async ({ request }) => {
        seen = request;
        form = await request.clone().formData();
        return HttpResponse.json(CASES.created, { status: 201 });
      }),
    );
    await keyed().oneTimeSends.create(
      {
        to: '+12025550123',
        sender_name: 'Dana Example',
        accept_aup: true,
        delete_after_send: true,
        file: new TextEncoder().encode('II* scan'),
        filename: 'scan.tiff',
      },
      { idempotencyKey: 'order-1' },
    );
    expect(seen?.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen?.headers.get('idempotency-key')).toBe('order-1');
    expect(seen?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(form?.get('to')).toBe('+12025550123');
    expect(form?.get('accept_aup')).toBe('true');
    expect(form?.get('delete_after_send')).toBe('true');
    expect(form?.has('email')).toBe(false);
    expect(form?.has('filename')).toBe(false);
    const file = form?.get('file') as File;
    expect(file.name).toBe('scan.tiff');
    expect(file.type).toBe('image/tiff');
    expect(await file.text()).toBe('II* scan');
  });

  it('refuses a create without exactly one of file or text', () => {
    const c = keyed();
    const base = { to: '+12025550123', sender_name: 'Dana', accept_aup: true };
    expect(() => c.oneTimeSends.create(base)).toThrow(/exactly one/);
    expect(() => c.oneTimeSends.create({ ...base, text: 'x', file: new Uint8Array([1]) })).toThrow(/exactly one/);
  });

  it('creates from a quote', async () => {
    let sent: unknown;
    server.use(
      http.post(`${ROOT}/from-quote`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(CASES.created, { status: 201 });
      }),
    );
    const order = await keyed().oneTimeSends.createFromQuote({
      quote_id: 'quote_' + '6'.repeat(32),
      sender_name: 'Dana Example',
      accept_aup: true,
      approval_id: 'apr_1',
    });
    expect(order.status_url?.endsWith(TOKEN)).toBe(true);
    expect(sent).toEqual({
      quote_id: 'quote_' + '6'.repeat(32),
      sender_name: 'Dana Example',
      accept_aup: true,
      approval_id: 'apr_1',
    });
  });

  it('sends the order token on a read, and none with a key', async () => {
    const seen: Headers[] = [];
    server.use(
      http.get(`${ROOT}/${ORDER}`, ({ request }) => {
        seen.push(request.headers);
        return HttpResponse.json(CASES.captured);
      }),
    );
    const byToken = await keyless().oneTimeSends.get(ORDER, { orderToken: TOKEN });
    expect(byToken.next).toBe('done');
    expect(byToken.captured_micro).toBe(2_490_000);
    expect(byToken.card?.last4).toBe('4242');
    expect(seen[0]?.get(ORDER_TOKEN_HEADER)).toBe(TOKEN);
    expect(seen[0]?.get('authorization')).toBeNull();
    await keyed().oneTimeSends.get(ORDER);
    expect(seen[1]?.get(ORDER_TOKEN_HEADER)).toBeNull();
    expect(seen[1]?.get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('a wrong token is not found', async () => {
    server.use(http.get(`${ROOT}/${ORDER}`, () => HttpResponse.json(CASES.not_found, { status: 404 })));
    const err = await keyless()
      .oneTimeSends.get(ORDER, { orderToken: '0.wrong' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('not_found');
  });

  it('lists and iterates', async () => {
    let query = '';
    server.use(
      http.get(ROOT, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(CASES.page);
      }),
    );
    const page = await keyed().oneTimeSends.list({ status: 'captured', limit: 10 });
    expect(page.items.map((o) => o.id)).toEqual([ORDER]);
    expect(query).toBe('?status=captured&limit=10');
    const ids: string[] = [];
    for await (const order of keyed().oneTimeSends.iter()) ids.push(order.id);
    expect(ids).toEqual([ORDER]);
  });

  it('opens the checkout with the token', async () => {
    let seen: Headers | undefined;
    server.use(
      http.post(`${ROOT}/${ORDER}/checkout`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json(CASES.checkout, { status: 201 });
      }),
    );
    const opened = await keyless().oneTimeSends.checkout(ORDER, { orderToken: TOKEN });
    expect(opened.checkout_url).toBe(CASES.checkout?.checkout_url);
    expect(seen?.get(ORDER_TOKEN_HEADER)).toBe(TOKEN);
    expect(seen?.get('idempotency-key')).toBeTruthy();
  });

  it('sends accept_aup on a from-quote order only when given', async () => {
    let sent: unknown;
    server.use(
      http.post(`${ROOT}/from-quote`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...CASES.created, aup_accepted: false }, { status: 201 });
      }),
    );
    const order = await keyed().oneTimeSends.createFromQuote({
      quote_id: 'quote_' + '6'.repeat(32),
      sender_name: 'Dana Example',
      approval_id: 'apr_1',
    });
    expect(order.aup_accepted).toBe(false);
    expect(order.status_url).toBeTruthy();
    expect(sent).toEqual({ quote_id: 'quote_' + '6'.repeat(32), sender_name: 'Dana Example', approval_id: 'apr_1' });
  });

  it('sends accept_aup on the checkout only when given', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${ROOT}/${ORDER}/checkout`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(CASES.checkout, { status: 201 });
      }),
    );
    const c = keyless();
    await c.oneTimeSends.checkout(ORDER, { orderToken: TOKEN });
    await c.oneTimeSends.checkout(ORDER, { orderToken: TOKEN, acceptAup: true });
    expect(bodies).toEqual([{}, { accept_aup: true }]);
  });

  it('reads the queue and the new order fields', async () => {
    const queue = { queued: true, jobs_ahead: 7, estimated_wait_minutes: 14 };
    server.use(
      http.get(`${ROOT}/config`, () => HttpResponse.json({ ...CASES.config, queue })),
      http.get(`${ROOT}/${ORDER}`, () =>
        HttpResponse.json({ ...CASES.checkout_open, queue, aup_accepted: false, status_url: 'https://faxforagents.com/send/status/x' }),
      ),
    );
    const c = keyless();
    const config = await c.oneTimeSends.config();
    expect(config.queue?.queued).toBe(true);
    expect(config.queue?.estimated_wait_minutes).toBe(14);
    const order = await c.oneTimeSends.get(ORDER, { orderToken: TOKEN });
    expect(order.queue?.jobs_ahead).toBe(7);
    expect(order.aup_accepted).toBe(false);
    expect(order.status_url).toBe('https://faxforagents.com/send/status/x');
  });

  it('posts the token of a confirmation link in the body', async () => {
    let sent: unknown;
    let url = '';
    server.use(
      http.post(`${ROOT}/by-token`, async ({ request }) => {
        sent = await request.json();
        url = request.url;
        return HttpResponse.json(CASES.by_token);
      }),
    );
    const summary = await keyless().oneTimeSends.readByToken('mail-token');
    expect(summary.order_id).toBe(ORDER);
    expect(sent).toEqual({ token: 'mail-token' });
    expect(url).not.toContain('mail-token');
  });

  it('reads a confirmation link and confirms', async () => {
    let sent: unknown;
    server.use(
      http.get(`${ROOT}/by-token/mail-token`, () => HttpResponse.json(CASES.by_token)),
      http.post(`${ROOT}/${ORDER}/confirm`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(CASES.confirmed);
      }),
    );
    const c = keyless();
    const summary = await c.oneTimeSends.getByToken('mail-token');
    expect(summary.state).toBe('ok');
    const done = await c.oneTimeSends.confirm(summary.order_id, 'mail-token');
    expect(done.order.status).toBe('released');
    expect(done.order.next).toBe('wait');
    expect(done.signed_in).toBe(false);
    expect(sent).toEqual({ token: 'mail-token' });
  });

  it('reads the link of an order that was canceled', async () => {
    // API 1.21.2: the confirm link of an order a person at Fax for Agents canceled reads link_canceled.
    const canceled = { ...CASES.by_token, state: 'link_canceled', status: 'canceled' };
    server.use(http.post(`${ROOT}/by-token`, () => HttpResponse.json(canceled)));
    const summary = await keyless().oneTimeSends.readByToken('mail-token');
    expect(summary.state).toBe('link_canceled');
    expect(summary.status).toBe('canceled');
  });

  it('mails the confirmation again', async () => {
    let seen: Headers | undefined;
    server.use(
      http.post(`${ROOT}/${ORDER}/resend-confirmation`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json(CASES.awaiting_confirmation);
      }),
    );
    const order = await keyless().oneTimeSends.resendConfirmation(ORDER, { orderToken: TOKEN });
    expect(order.next).toBe('confirm');
    expect(order.resend_allowed_at).toBe('2026-11-12T09:13:05Z');
    expect(seen?.get(ORDER_TOKEN_HEADER)).toBe(TOKEN);
  });

  it('downloads the receipt', async () => {
    let seen: Headers | undefined;
    server.use(
      http.get(`${ROOT}/${ORDER}/receipt.pdf`, ({ request }) => {
        seen = request.headers;
        return new HttpResponse('%PDF-1.7 receipt', { headers: { 'content-type': 'application/pdf' } });
      }),
    );
    const pdf = await keyless().oneTimeSends.getReceiptPdf(ORDER, { orderToken: TOKEN });
    expect(new TextDecoder().decode(pdf)).toBe('%PDF-1.7 receipt');
    expect(seen?.get(ORDER_TOKEN_HEADER)).toBe(TOKEN);
  });

  it('wait follows next until done, or until the step asked for', async () => {
    const steps = () => [
      HttpResponse.json(CASES.checkout_open),
      HttpResponse.json(CASES.awaiting_confirmation),
      HttpResponse.json(CASES.captured),
    ];
    let calls = 0;
    let answers = steps();
    server.use(
      http.get(`${ROOT}/${ORDER}`, () => {
        calls += 1;
        return answers.shift() ?? HttpResponse.json(CASES.captured);
      }),
    );
    const done = await keyless().oneTimeSends.wait(ORDER, { orderToken: TOKEN, intervalMs: 0 });
    expect(done.status).toBe('captured');
    expect(calls).toBe(3);
    calls = 0;
    answers = steps();
    const paid = await keyless().oneTimeSends.wait(ORDER, { orderToken: TOKEN, until: 'confirm', intervalMs: 0 });
    expect(paid.next).toBe('confirm');
    expect(calls).toBe(2);
  });

  it('wait returns the last order on timeout', async () => {
    server.use(http.get(`${ROOT}/${ORDER}`, () => HttpResponse.json(CASES.checkout_open)));
    const order: OneTimeOrder = await keyless().oneTimeSends.wait(ORDER, { orderToken: TOKEN, timeoutMs: 0 });
    expect(order.next).toBe('checkout');
  });

  it('reads one_time_offer from a 402 when the server sends it', async () => {
    const offer = { amount_micro: 2_490_000, currency: 'USD', document_pages: 2 };
    server.use(
      http.post(
        `${BASE}/v1/faxes`,
        sequence(
          () =>
            HttpResponse.json(
              apiError('insufficient_balance', 'top up first', { available_micro: 0, needed_micro: 78_000 }),
              { status: 402 },
            ),
          () =>
            HttpResponse.json(
              apiError('insufficient_balance', 'top up first', {
                available_micro: 0,
                needed_micro: 78_000,
                top_up_url: 'https://app.faxforagents.com/app/billing',
                one_time_offer: offer,
              }),
              { status: 402 },
            ),
        ),
      ),
    );
    const c = keyed();
    const plain = await c.faxes.create({ quote_id: 'quote_1' }).catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(PaymentRequiredError);
    expect((plain as PaymentRequiredError).oneTimeOffer).toBeNull();
    expect((plain as PaymentRequiredError).topUpUrl).toBeNull();
    const withOffer = await c.faxes.create({ quote_id: 'quote_1' }).catch((e: unknown) => e);
    expect((withOffer as PaymentRequiredError).oneTimeOffer).toEqual(offer);
    const typed: number | undefined = (withOffer as PaymentRequiredError).oneTimeOffer?.amount_micro;
    expect(typed).toBe(offer.amount_micro);
    expect((withOffer as PaymentRequiredError).topUpUrl).toBe('https://app.faxforagents.com/app/billing');
  });
});

describe('one-time preview and pages (API 1.20.6)', () => {
  const inspection = { document_pages: 3, thumbnail_png_base64: 'iVBORw0KGgo=', warnings: [] };

  it('counts the pages of a text or a file with no key', async () => {
    const seen: Array<{ type: string | null; auth: string | null; body: string }> = [];
    server.use(
      http.post(`${ROOT}/preview`, async ({ request }) => {
        seen.push({
          type: request.headers.get('content-type'),
          auth: request.headers.get('authorization'),
          body: await request.text(),
        });
        return HttpResponse.json(inspection);
      }),
    );
    const found = await keyless().oneTimeSends.preview({ text: '# Hello', text_format: 'markdown' });
    expect(found).toEqual(inspection);
    await keyless().oneTimeSends.preview({ file: new TextEncoder().encode('%PDF-1.7'), filename: 'letter.pdf' });
    expect(seen[0]).toEqual({ type: 'application/json', auth: null, body: '{"text":"# Hello","text_format":"markdown"}' });
    expect(seen[1]?.type).toMatch(/^multipart\/form-data/);
    expect(seen[1]?.body).toContain('filename="letter.pdf"');
    expect(seen[1]?.body).toContain('application/pdf');
    expect(() => keyless().oneTimeSends.preview({})).toThrow('exactly one');
    expect(() => keyless().oneTimeSends.preview({ file: new Uint8Array([1]), text: 'both' })).toThrow('exactly one');
  });

  it('returns a page of the order as PNG bytes with the status token', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let token: string | null = null;
    server.use(
      http.get(`${ROOT}/${ORDER}/pages/1`, ({ request }) => {
        token = request.headers.get(ORDER_TOKEN_HEADER);
        return new HttpResponse(png, { headers: { 'content-type': 'image/png' } });
      }),
      http.get(`${ROOT}/${ORDER}/pages/9`, () => HttpResponse.json(apiError('not_found', 'this page cannot be shown'), { status: 404 })),
    );
    expect(await keyless().oneTimeSends.getPage(ORDER, 1, { orderToken: TOKEN })).toEqual(png);
    expect(token).toBe(TOKEN);
    const err = await keyless()
      .oneTimeSends.getPage(ORDER, 9, { orderToken: TOKEN })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });
});

describe('one-time cover check (API 1.20.8)', () => {
  it('measures the room for the message with no key and stores nothing', async () => {
    const seen: Array<{ auth: string | null; body: unknown }> = [];
    const answers = [
      { fits: true, message_chars: 11, lines_left: 24, fits_chars: null },
      { fits: false, message_chars: 2400, lines_left: null, fits_chars: 1980 },
      { fits: true, message_chars: 0, lines_left: null, fits_chars: null },
    ];
    server.use(
      http.post(`${ROOT}/cover-checks`, async ({ request }) => {
        seen.push({ auth: request.headers.get('authorization'), body: await request.json() });
        return HttpResponse.json(answers[seen.length - 1]);
      }),
    );
    const room = await keyless().oneTimeSends.checkCover({ sender_name: 'Dana Example', to: '+12025550123', message: 'Hello there' });
    expect(room).toEqual(answers[0]);
    const over = await keyless().oneTimeSends.checkCover({ message: 'x'.repeat(2400) });
    expect(over).toMatchObject({ fits: false, lines_left: null, fits_chars: 1980 });
    expect((await keyless().oneTimeSends.checkCover()).message_chars).toBe(0);
    expect(seen).toEqual([
      { auth: null, body: { sender_name: 'Dana Example', to: '+12025550123', message: 'Hello there' } },
      { auth: null, body: { message: 'x'.repeat(2400) } },
      { auth: null, body: {} },
    ]);
  });

  it('throws ServerError while one-time sends are switched off', async () => {
    server.use(
      http.post(`${ROOT}/cover-checks`, () =>
        HttpResponse.json(apiError('one_time_unavailable', 'one-time sends are switched off on this server'), { status: 503 }),
      ),
    );
    const err = await keyless()
      .oneTimeSends.checkCover({ message: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ status: 503, code: 'one_time_unavailable' });
  });
});

describe('one-time cover check limits (API 1.20.10)', () => {
  it('throws InvalidRequestError for a field over the limit of the create', async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(`${ROOT}/cover-checks`, async ({ request }) => {
        seen.push(await request.json());
        return HttpResponse.json(apiError('invalid_request', 'cover.message is longer than 2000 characters', { field: 'cover' }), { status: 422 });
      }),
    );
    const err = await keyless()
      .oneTimeSends.checkCover({ message: 'x'.repeat(2001) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err).toMatchObject({ status: 422, code: 'invalid_request', details: { field: 'cover' } });
    expect(seen).toEqual([{ message: 'x'.repeat(2001) }]);
  });
});

describe('one-time refunds (API 1.21.0)', () => {
  it('waits while an order is refunding and returns once it is refunded', async () => {
    const paid = CASES.captured!.captured_micro as number;
    const refunding = { ...CASES.captured, status: 'refunding', next: 'wait', refund_pending_micro: paid };
    const refunded = { ...CASES.captured, status: 'refunded', next: 'done', refunded_micro: paid };
    let calls = 0;
    server.use(
      http.get(`${ROOT}/${ORDER}`, () => {
        calls += 1;
        return HttpResponse.json(calls === 1 ? refunding : refunded);
      }),
    );
    const order: OneTimeOrder = await keyless().oneTimeSends.wait(ORDER, { orderToken: TOKEN, intervalMs: 0 });
    expect(order).toMatchObject({ status: 'refunded', next: 'done', refunded_micro: paid, refund_pending_micro: 0 });
    expect(calls).toBe(2);
    const canceled = { ...CASES.awaiting_confirmation, status: 'canceled', next: 'done' };
    server.use(http.get(`${ROOT}/${ORDER}`, () => HttpResponse.json(canceled)));
    const released = await keyless().oneTimeSends.wait(ORDER, { orderToken: TOKEN, intervalMs: 0 });
    expect(released).toMatchObject({ status: 'canceled', captured_micro: 0 });
  });
});
