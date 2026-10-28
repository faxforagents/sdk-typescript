/** The Standard Webhooks check, against vectors produced with the server's own scheme. */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SignatureError, parseEvent, sign, signatureHeaders, verifyWebhook } from '../src/index.js';

const SECRET = 'whsec_' + Buffer.from('k'.repeat(24)).toString('base64');
const OTHER = 'whsec_' + Buffer.from('o'.repeat(24)).toString('base64');
const BODY = JSON.stringify({
  correlation_id: null,
  created_at: '2026-10-28T14:02:00Z',
  data: { pages_sent: 3, state: 'delivered' },
  environment: 'test',
  fax_job_id: 'fax_1',
  id: 'evt_1',
  org_id: 'org_1',
  project_id: null,
  resource: { id: 'fax_1', type: 'fax_job' },
  schema_version: 1,
  type: 'fax.delivered',
});
const NOW = 1_800_000_000;

describe('sign', () => {
  it('matches the reference formula HMAC-SHA256(secret, "{id}.{ts}.{body}")', async () => {
    const expected = createHmac('sha256', Buffer.from('k'.repeat(24)))
      .update(`evt_1.${NOW}.${BODY}`)
      .digest('base64');
    expect(await sign(SECRET, 'evt_1', NOW, BODY)).toBe('v1,' + expected);
  });
});

describe('verifyWebhook', () => {
  it('round trips with a plain object, a Headers object and bytes', async () => {
    const headers = await signatureHeaders([SECRET], 'evt_1', BODY, NOW);
    expect(await verifyWebhook(SECRET, headers, BODY, { now: NOW })).toBe('evt_1');
    expect(await verifyWebhook(SECRET, new Headers(headers), new TextEncoder().encode(BODY), { now: NOW + 100 })).toBe('evt_1');
    const nodeStyle = { 'webhook-id': headers['webhook-id'], 'webhook-timestamp': headers['webhook-timestamp'], 'webhook-signature': [headers['webhook-signature']!] };
    expect(await verifyWebhook(SECRET, nodeStyle, BODY, { now: NOW })).toBe('evt_1');
  });

  it('rejects a tampered body, a wrong secret, a stale timestamp and missing headers', async () => {
    const headers = await signatureHeaders([SECRET], 'evt_1', BODY, NOW);
    await expect(verifyWebhook(SECRET, headers, BODY.replace('delivered', 'failed'), { now: NOW })).rejects.toThrow(
      SignatureError,
    );
    await expect(verifyWebhook(OTHER, headers, BODY, { now: NOW })).rejects.toThrow(/no matching signature/);
    await expect(verifyWebhook(SECRET, headers, BODY, { now: NOW + 301 })).rejects.toThrow(/tolerance/);
    expect(await verifyWebhook(SECRET, headers, BODY, { now: NOW + 301, toleranceS: 600 })).toBe('evt_1');
    await expect(verifyWebhook(SECRET, {}, BODY, { now: NOW })).rejects.toThrow(/missing/);
    await expect(verifyWebhook(SECRET, { ...headers, 'webhook-timestamp': 'soon' }, BODY, { now: NOW })).rejects.toThrow(
      /bad timestamp/,
    );
  });

  it('accepts either signature during a rotation', async () => {
    const headers = await signatureHeaders([SECRET, OTHER], 'evt_1', BODY, NOW);
    expect(headers['webhook-signature']!.split(' ')).toHaveLength(2);
    expect(await verifyWebhook(SECRET, headers, BODY, { now: NOW })).toBe('evt_1');
    expect(await verifyWebhook(OTHER, headers, BODY, { now: NOW })).toBe('evt_1');
  });
});

describe('parseEvent', () => {
  it('reads the body', () => {
    const event = parseEvent(BODY);
    expect(event.type).toBe('fax.delivered');
    expect(event.resource).toEqual({ id: 'fax_1', type: 'fax_job' });
    expect(event.data.pages_sent).toBe(3);
  });
});
