/** Billing iterators replay saved response shapes with controlled cursors. */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import { FaxForAgents, ScopeError } from '../src/index.js';
import { BASE, HttpResponse, KEY, http, server } from './helpers.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/billing-pages.json', import.meta.url), 'utf8')) as Array<{
  name: 'ledger' | 'topup_sessions' | 'invoices';
  route: string;
  pages: Array<{ items: Array<{ id: string }>; next_cursor: string | null }>;
}>;
const methods = {
  ledger: 'iterLedger', topup_sessions: 'iterTopupSessions', invoices: 'iterInvoices',
} as const;
const client = () => new FaxForAgents({ apiKey: KEY, baseUrl: BASE });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it.each(cases)('$name follows cursors, preserves limit and stops on a populated final page', async (fixture) => {
  const urls: URL[] = [];
  server.use(http.get(`${BASE}${fixture.route}`, ({ request }) => {
    urls.push(new URL(request.url));
    return HttpResponse.json(fixture.pages[urls.length - 1]);
  }));
  const iterator = client().billing[methods[fixture.name]]({ limit: 1 });
  expect(urls).toHaveLength(0);
  const items = [];
  for await (const item of iterator) items.push(item);
  expect(items).toEqual(fixture.pages.flatMap((page) => page.items));
  expect(urls).toHaveLength(2);
  expect(urls[0]!.searchParams.has('cursor')).toBe(false);
  expect(urls[1]!.searchParams.get('cursor')).toBe(fixture.pages[0]!.next_cursor);
  expect(urls.map((url) => url.searchParams.get('limit'))).toEqual(['1', '1']);
});

it.each(cases)('$name stops on an empty first page', async (fixture) => {
  let calls = 0;
  server.use(http.get(`${BASE}${fixture.route}`, () => {
    calls++;
    return HttpResponse.json({ items: [], next_cursor: null });
  }));
  const items = [];
  for await (const item of client().billing[methods[fixture.name]]()) items.push(item);
  expect(items).toEqual([]);
  expect(calls).toBe(1);
});

it.each(cases)('$name propagates API errors', async (fixture) => {
  server.use(http.get(`${BASE}${fixture.route}`, () => HttpResponse.json(
    { error: { code: 'scope_missing', message: 'refused' } }, { status: 403 },
  )));
  await expect(client().billing[methods[fixture.name]]().next()).rejects.toBeInstanceOf(ScopeError);
});
