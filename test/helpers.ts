/** Sample payloads shaped like the server's, and the msw server every unit test runs against. */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import type { Document, FaxJob, Quote } from '../src/schema.js';

export const BASE = 'https://api.test.invalid';
export const KEY = 'ffa_test_' + 'a'.repeat(43);

export const server = setupServer();

export const faxJob = (over: Partial<FaxJob> = {}): FaxJob => ({
  id: 'fax_' + '1'.repeat(32),
  environment: 'test',
  direction: 'outbound',
  state: 'queued',
  failure_code: null,
  to: '+15550000001',
  from: null,
  route: 'us_ca',
  document_id: 'doc_' + '2'.repeat(32),
  document_sha256: 'ab'.repeat(32),
  transmitted_sha256: null,
  quote_id: 'quote_' + '3'.repeat(32),
  billable_pages: 1,
  cover_pages: 0,
  pages_sent: 0,
  amount_micro: 0,
  captured_micro: 0,
  currency: 'USD',
  provider: 'sandbox',
  provider_ref: null,
  attempt_count: 0,
  client_reference: null,
  evidence: null,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
  completed_at: null,
  cancel_requested_at: null,
  ...over,
});

export const document = (over: Partial<Document> = {}): Document => ({
  id: 'doc_' + '2'.repeat(32),
  environment: 'test',
  status: 'ready',
  source: 'text',
  filename: 'hello',
  content_type: 'application/pdf',
  size_bytes: 1234,
  sha256: 'ab'.repeat(32),
  page_count: 1,
  render_status: 'rendered',
  render_reason: null,
  validation: { warnings: [] },
  upload_id: null,
  created_at: '2026-10-28T00:00:00Z',
  expires_at: null,
  deleted_at: null,
  ...over,
});

export const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'quote_' + '3'.repeat(32),
  environment: 'test',
  document_id: 'doc_' + '2'.repeat(32),
  document_sha256: 'ab'.repeat(32),
  to: '+15550000001',
  from: null,
  route: 'us_ca',
  document_pages: 1,
  cover_pages: 0,
  billable_pages: 1,
  amount_micro: 0,
  currency: 'USD',
  price_version: 'launch-v1',
  cover: null,
  authorization_required: false,
  warnings: [],
  expires_at: '2026-10-28T00:10:00Z',
  expired: false,
  consumed_by_job_id: null,
  created_at: '2026-10-28T00:00:00Z',
  ...over,
});

export const apiError = (code: string, message = 'refused', details?: unknown) => ({
  error: { code, message, retryable: false, correlation_id: 'req_1', details },
});

/** Answer a sequence of responses to the same route, then repeat the last. */
export function sequence(...responses: Array<() => Response>) {
  let i = 0;
  return () => {
    const make = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return make();
  };
}

export { http, HttpResponse };
