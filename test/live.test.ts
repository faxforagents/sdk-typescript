/**
 * One real pass against https://api.faxforagents.com on the sandbox. Opt in with FAXFORAGENTS_API_KEY.
 *
 *   FAXFORAGENTS_API_KEY=ffa_test_... npm run test:live
 *
 * A test key only. Nothing leaves the sandbox and nothing is charged. It asserts what the product
 * promises: queued on send, delivered with evidence on +15550000001, the same job back under the same
 * Idempotency-Key.
 */
import { describe, expect, it } from 'vitest';

import { FaxForAgents } from '../src/index.js';

const KEY = process.env.FAXFORAGENTS_API_KEY ?? '';

describe.skipIf(!KEY.startsWith('ffa_test_'))('live sandbox', () => {
  it('sends a sandbox fax that is delivered with evidence', { timeout: 120_000 }, async () => {
    const ffa = new FaxForAgents({ apiKey: KEY, baseUrl: 'https://api.faxforagents.com' });
    const me = await ffa.me();
    expect(me.environment).toBe('test');
    const caps = await ffa.platform.capabilities();
    expect(caps.provider).toBe('sandbox');

    const doc = await ffa.documents.create({ text: 'Live test from the TypeScript SDK.', filename: 'sdk-live' });
    expect(doc.sha256).toHaveLength(64);

    const q = await ffa.quotes.create({ document_id: doc.id, to: '+15550000001' });
    expect(q.amount_micro).toBe(0);
    expect(q.authorization_required).toBe(false);

    const key = `sdk-live-${crypto.randomUUID()}`;
    const fax = await ffa.faxes.create({ quote_id: q.id }, { idempotencyKey: key });
    expect(fax.state).toBe('queued');
    const again = await ffa.faxes.create({ quote_id: q.id }, { idempotencyKey: key });
    expect(again.id).toBe(fax.id);

    const done = await ffa.faxes.wait(fax.id, { timeoutMs: 100_000, intervalMs: 2000 });
    expect(done.state).toBe('delivered');
    expect(done.evidence).toBeTruthy();
    expect(done.pages_sent).toBe(done.billable_pages);

    const receipt = await ffa.faxes.getReceipt(fax.id);
    expect(receipt.state).toBe('delivered');

    const page = await ffa.faxes.list({ limit: 1 });
    expect(page.items.length).toBeGreaterThan(0);
  });
});
