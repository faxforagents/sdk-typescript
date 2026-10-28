/** iter helpers follow next_cursor and pass the filters through on every page. */
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import { FaxForAgents } from '../src/index.js';
import { BASE, HttpResponse, KEY, faxJob, http, server } from './helpers.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = () => new FaxForAgents({ apiKey: KEY, baseUrl: BASE });

it('faxes.iter follows next_cursor with the filters on every page', async () => {
  const urls: string[] = [];
  server.use(
    http.get(`${BASE}/v1/faxes`, ({ request }) => {
      urls.push(request.url);
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (!cursor) return HttpResponse.json({ items: [faxJob({ id: 'fax_a' }), faxJob({ id: 'fax_b' })], next_cursor: 'c2' });
      if (cursor === 'c2') return HttpResponse.json({ items: [faxJob({ id: 'fax_c' })], next_cursor: 'c3' });
      return HttpResponse.json({ items: [], next_cursor: null });
    }),
  );
  const ids: string[] = [];
  for await (const job of client().faxes.iter({ state: 'failed', limit: 2 })) ids.push(job.id);
  expect(ids).toEqual(['fax_a', 'fax_b', 'fax_c']);
  expect(urls).toHaveLength(3);
  expect(urls[0]).not.toContain('cursor');
  expect(urls[1]).toContain('cursor=c2');
  expect(urls[2]).toContain('cursor=c3');
  for (const u of urls) expect(u).toMatch(/state=failed/);
  for (const u of urls) expect(u).toMatch(/limit=2/);
});

it('inbox.iter stops on an empty first page', async () => {
  let calls = 0;
  server.use(
    http.get(`${BASE}/v1/inbox`, () => {
      calls += 1;
      return HttpResponse.json({ items: [], next_cursor: null });
    }),
  );
  const items = [];
  for await (const item of client().inbox.iter()) items.push(item);
  expect(items).toEqual([]);
  expect(calls).toBe(1);
});
