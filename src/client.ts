/**
 * The Fax for Agents client. Resources mirror the API's tags. Method names are the operationIds of the
 * OpenAPI document, shortened by their resource, so the reference at
 * https://faxforagents.github.io/openapi/reference.html is also the reference of this client.
 *
 * Every mutating method takes `idempotencyKey`. When you pass none a UUID is minted once per call and
 * reused on every retry.
 *
 *   import { FaxForAgents } from 'faxforagents';
 *
 *   const ffa = new FaxForAgents();                       // reads FAXFORAGENTS_API_KEY
 *   const doc = await ffa.documents.create({ text: 'Hello from an agent.' });
 *   const quote = await ffa.quotes.create({ document_id: doc.id, to: '+15550000001' });
 *   const fax = await ffa.faxes.wait((await ffa.faxes.create({ quote_id: quote.id })).id);
 *   console.log(fax.state, fax.evidence);                 // delivered, {...}
 */

import { ClientOptions, Http, ORDER_TOKEN_HEADER, RequestOptions, paginate } from './http.js';
import type * as S from './schema.js';

export const TERMINAL_STATES: ReadonlySet<string> = new Set(['delivered', 'partial', 'failed', 'unknown']);

type Mut = { idempotencyKey?: string };
type Page = { cursor?: string; limit?: number };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Content types the upload path accepts, by file suffix. Anything else is sent as a PDF. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/** The upload content type of a filename: a PDF unless the suffix says PNG, JPEG or TIFF. */
export function guessContentType(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const suffix = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[suffix] ?? 'application/pdf';
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

class Resource {
  constructor(protected readonly h: Http) {}
}

export class Identity extends Resource {
  /** Who the key is: organization, project, environment, scopes. Scope: any. */
  me(): Promise<S.Me> {
    return this.h.request('GET', '/v1/me');
  }
  /** Keys of the organization, metadata only. Scope: key:admin. */
  listApiKeys(): Promise<S.ApiKeyList> {
    return this.h.request('GET', '/v1/api-keys');
  }
  /** Create a key. The secret is in the answer once. Scope: key:admin. */
  createApiKey(body: S.ApiKeyCreate, o: Mut = {}): Promise<S.ApiKeyWithSecret> {
    return this.h.request('POST', '/v1/api-keys', { json: body, ...o });
  }
  /** A new secret. The old one works 24 more hours. Scope: key:admin. */
  rotateApiKey(keyId: string, o: Mut = {}): Promise<S.ApiKeyWithSecret> {
    return this.h.request('POST', `/v1/api-keys/${keyId}/rotate`, o);
  }
  /** Revoke a key at once. Scope: key:admin. */
  revokeApiKey(keyId: string, o: Mut = {}): Promise<S.Deleted> {
    return this.h.request('DELETE', `/v1/api-keys/${keyId}`, o);
  }
}

export class Documents extends Resource {
  /**
   * An immutable document from one of upload_id, text, markdown or html. HTML is rendered with scripts off
   * and no network, at most 2 MiB. Scope: document:write.
   */
  create(body: S.DocumentCreate, o: Mut = {}): Promise<S.Document> {
    return this.h.request('POST', '/v1/documents', { json: body, ...o });
  }
  /**
   * Open an upload session with a signed PUT URL (25 MiB, one hour). `content_type` is application/pdf,
   * image/png, image/jpeg or image/tiff. Scope: document:write.
   */
  createUpload(body: S.UploadCreate, o: Mut = {}): Promise<S.UploadSession> {
    return this.h.request('POST', '/v1/uploads', { json: body, ...o });
  }
  /** Send the bytes to the signed URL from createUpload. No scope, the link is the credential. */
  putUploadContent(uploadUrl: string, data: Uint8Array | ArrayBuffer | Blob, contentType = 'application/pdf'): Promise<S.UploadSession> {
    return this.h.request('PUT', uploadUrl, { body: data as BodyInit, headers: { 'Content-Type': contentType } });
  }
  /** Finalize an upload. The size and, when given, the sha256 are checked. Scope: document:write. */
  completeUpload(uploadId: string, body: S.UploadComplete = {}, o: Mut = {}): Promise<S.UploadSession> {
    return this.h.request('POST', `/v1/uploads/${uploadId}/complete`, { json: body, ...o });
  }
  /** Cancel an incomplete upload. Scope: document:write. */
  cancelUpload(uploadId: string, o: Mut = {}): Promise<S.Deleted> {
    return this.h.request('DELETE', `/v1/uploads/${uploadId}`, o);
  }
  /**
   * The whole upload path for a PDF or an image (PNG, JPG or TIFF): createUpload, put the bytes, complete
   * with the sha256, create the document. The content type is read from the filename when not given. An
   * image becomes gray letter pages.
   */
  async upload(data: Uint8Array | ArrayBuffer, opts: { filename?: string; contentType?: string } = {}): Promise<S.Document> {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const filename = opts.filename ?? 'document.pdf';
    const contentType = opts.contentType ?? guessContentType(filename);
    const session = await this.createUpload({ filename, size_bytes: bytes.byteLength, content_type: contentType });
    if (!session.upload_url) throw new Error('the upload session carries no upload_url');
    await this.putUploadContent(session.upload_url, bytes, contentType);
    await this.completeUpload(session.id, { sha256: await sha256Hex(bytes) });
    return this.create({ upload_id: session.id, filename });
  }
  /** Documents, newest first. Scope: document:read. */
  list(p: Page = {}): Promise<S.DocumentPage> {
    return this.h.request('GET', '/v1/documents', { params: p });
  }
  /** Every document, following next_cursor. */
  iter(p: Omit<Page, 'cursor'> = {}): AsyncGenerator<S.Document, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
  /** Hash, pages and validation state. Scope: document:read. */
  get(documentId: string): Promise<S.Document> {
    return this.h.request('GET', `/v1/documents/${documentId}`);
  }
  /** Delete the document, its bytes and its previews. Scope: document:write. */
  delete(documentId: string, o: Mut = {}): Promise<S.Deleted> {
    return this.h.request('DELETE', `/v1/documents/${documentId}`, o);
  }
  /** Validation warnings. Scope: document:read. */
  getValidation(documentId: string): Promise<S.DocumentValidation> {
    return this.h.request('GET', `/v1/documents/${documentId}/validation`);
  }
  /** A signed download URL, valid ten minutes. Scope: document:read. */
  getDownload(documentId: string): Promise<S.SignedUrl> {
    return this.h.request('GET', `/v1/documents/${documentId}/download`);
  }
  /** The document bytes (always a PDF), through a fresh signed URL. */
  async download(documentId: string): Promise<Uint8Array> {
    const link = await this.getDownload(documentId);
    return this.h.bytes('GET', link.url);
  }
  /** Rendered pages with signed preview URLs. Scope: document:read. */
  listPages(documentId: string): Promise<S.DocumentPages> {
    return this.h.request('GET', `/v1/documents/${documentId}/pages`);
  }
}

export class Quotes extends Resource {
  /** The exact price of one document to one E.164 destination, valid ten minutes. Scope: fax:quote. */
  create(body: S.QuoteCreate, o: Mut = {}): Promise<S.Quote> {
    return this.h.request('POST', '/v1/fax-quotes', { json: body, ...o });
  }
  /** Read a quote. Scope: fax:quote. */
  get(quoteId: string): Promise<S.Quote> {
    return this.h.request('GET', `/v1/fax-quotes/${quoteId}`);
  }
}

export class Faxes extends Resource {
  /** Send a quoted fax. The answer is queued, never delivered. Poll `wait`. Scope: fax:send. */
  create(body: S.FaxCreate, o: Mut = {}): Promise<S.FaxJob> {
    return this.h.request('POST', '/v1/faxes', { json: body, ...o });
  }
  /**
   * Fax jobs, newest first. Scope: fax:read. `idempotency_key` finds the send made with that
   * Idempotency-Key. It is a filter here, not a header. An empty result does not prove no fax was sent.
   */
  list(p: Page & { state?: string; idempotency_key?: string } = {}): Promise<S.FaxJobPage> {
    return this.h.request('GET', '/v1/faxes', { params: p });
  }
  /** Every fax job, following next_cursor. */
  iter(p: Omit<Page, 'cursor'> & { state?: string } = {}): AsyncGenerator<S.FaxJob, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
  /** The job with its evidence once delivered or partial. Scope: fax:read. */
  get(faxId: string): Promise<S.FaxJob> {
    return this.h.request('GET', `/v1/faxes/${faxId}`);
  }
  /** Poll until the state is delivered, partial, failed or unknown. Returns the last job read. */
  async wait(faxId: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<S.FaxJob> {
    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    let job = await this.get(faxId);
    while (!TERMINAL_STATES.has(job.state) && Date.now() < deadline) {
      await sleep(opts.intervalMs ?? 2000);
      job = await this.get(faxId);
    }
    return job;
  }
  /** Ordered events of one fax. Scope: fax:read. */
  listEvents(faxId: string): Promise<S.EventPage> {
    return this.h.request('GET', `/v1/faxes/${faxId}/events`);
  }
  /** Attempt history. Scope: fax:read. */
  listAttempts(faxId: string): Promise<S.AttemptPage> {
    return this.h.request('GET', `/v1/faxes/${faxId}/attempts`);
  }
  /** Delivery evidence as a receipt. Scope: fax:read. */
  getReceipt(faxId: string): Promise<S.Receipt> {
    return this.h.request('GET', `/v1/faxes/${faxId}/receipt`);
  }
  /** The same receipt as a one-page PDF. Scope: fax:read. */
  getReceiptPdf(faxId: string): Promise<Uint8Array> {
    return this.h.bytes('GET', `/v1/faxes/${faxId}/receipt.pdf`);
  }
  /** Cancel while queued, best effort once sending. Scope: fax:cancel. */
  cancel(faxId: string, o: Mut = {}): Promise<S.FaxJob> {
    return this.h.request('POST', `/v1/faxes/${faxId}/cancel`, { json: {}, ...o });
  }
}

export class Webhooks extends Resource {
  /** Registered destinations. Scope: webhook:admin. */
  list(): Promise<S.WebhookList> {
    return this.h.request('GET', '/v1/webhooks');
  }
  /** Register a destination. The secret is in the answer once. Scope: webhook:admin. */
  create(body: S.WebhookCreate, o: Mut = {}): Promise<S.WebhookWithSecret> {
    return this.h.request('POST', '/v1/webhooks', { json: body, ...o });
  }
  /** Change url, description, event_types or status. Scope: webhook:admin. */
  update(webhookId: string, body: S.WebhookUpdate, o: Mut = {}): Promise<S.Webhook> {
    return this.h.request('PATCH', `/v1/webhooks/${webhookId}`, { json: body, ...o });
  }
  /** Remove a destination. Scope: webhook:admin. */
  delete(webhookId: string, o: Mut = {}): Promise<S.Deleted> {
    return this.h.request('DELETE', `/v1/webhooks/${webhookId}`, o);
  }
  /** A new secret. The old one signs too for 24 hours. Scope: webhook:admin. */
  rotateSecret(webhookId: string, o: Mut = {}): Promise<S.WebhookWithSecret> {
    return this.h.request('POST', `/v1/webhooks/${webhookId}/rotate-secret`, o);
  }
  /** Send a signed webhook.test event to the destination. Scope: webhook:admin. */
  test(webhookId: string, o: Mut = {}): Promise<S.Event> {
    return this.h.request('POST', `/v1/webhooks/${webhookId}/test`, { json: {}, ...o });
  }
  /** Delivery attempts. Scope: webhook:admin. */
  listDeliveries(p: Page & { webhook_id?: string; event_id?: string } = {}): Promise<S.DeliveryPage> {
    return this.h.request('GET', '/v1/webhook-deliveries', { params: p });
  }
  /** Deliver the event again with the same event id. Scope: webhook:admin. */
  replayDelivery(deliveryId: string, o: Mut = {}): Promise<S.Delivery> {
    return this.h.request('POST', `/v1/webhook-deliveries/${deliveryId}/replay`, { json: {}, ...o });
  }
}

export class Events extends Resource {
  /** Events for reconciliation, oldest first from the cursor. Scope: fax:read. */
  list(p: Page & { type?: string } = {}): Promise<S.EventPage> {
    return this.h.request('GET', '/v1/events', { params: p });
  }
  /** Every event, following next_cursor. */
  iter(p: Omit<Page, 'cursor'> & { type?: string } = {}): AsyncGenerator<S.Event, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
}

export class Billing extends Resource {
  /** Available and held balance of this key's environment. Scope: billing:read. */
  balance(): Promise<S.Balance> {
    return this.h.request('GET', '/v1/balance');
  }
  /** Wallet transactions, newest first. Scope: billing:read. */
  listLedger(p: Page = {}): Promise<S.LedgerPage> {
    return this.h.request('GET', '/v1/ledger', { params: p });
  }
  /** Every ledger entry, following next_cursor. */
  iterLedger(p: Omit<Page, 'cursor'> = {}): AsyncGenerator<S.LedgerEntry, void, undefined> {
    return paginate((cursor) => this.listLedger({ ...p, cursor }));
  }
  /** Billing settings of the organization. Scope: billing:read. */
  getSettings(): Promise<S.BillingSettings> {
    return this.h.request('GET', '/v1/billing-settings');
  }
  /** Change the billing email or the low-balance threshold. Scope: billing:write. */
  patchSettings(body: S.BillingSettingsPatch, o: Mut = {}): Promise<S.BillingSettings> {
    return this.h.request('PATCH', '/v1/billing-settings', { json: body, ...o });
  }
  /** A hosted Checkout to fund the live wallet. Scope: billing:write. */
  createTopupSession(body: S.TopupCreate, o: Mut = {}): Promise<S.TopupSession> {
    return this.h.request('POST', '/v1/topup-sessions', { json: body, ...o });
  }
  /** Top-up sessions, newest first. Scope: billing:read. */
  listTopupSessions(p: Page = {}): Promise<S.TopupSessionPage> {
    return this.h.request('GET', '/v1/topup-sessions', { params: p });
  }
  /** Every top-up session, following next_cursor. */
  iterTopupSessions(p: Omit<Page, 'cursor'> = {}): AsyncGenerator<S.TopupSession, void, undefined> {
    return paginate((cursor) => this.listTopupSessions({ ...p, cursor }));
  }
  /** Read a top-up session. Scope: billing:read. */
  getTopupSession(topupSessionId: string): Promise<S.TopupSession> {
    return this.h.request('GET', `/v1/topup-sessions/${topupSessionId}`);
  }
  /** Auto top-up settings. Scope: billing:read. */
  listAutoTopups(): Promise<S.AutoTopupList> {
    return this.h.request('GET', '/v1/auto-topups');
  }
  /** Opt in to auto top-up. Scope: billing:write. */
  createAutoTopup(body: S.AutoTopupCreate, o: Mut = {}): Promise<S.AutoTopup> {
    return this.h.request('POST', '/v1/auto-topups', { json: body, ...o });
  }
  /** Turn auto top-up off. Scope: billing:write. */
  deleteAutoTopup(autoTopupId: string, o: Mut = {}): Promise<S.Deleted> {
    return this.h.request('DELETE', `/v1/auto-topups/${autoTopupId}`, o);
  }
  /** Spending caps of this environment. Scope: billing:read. */
  listBudgets(): Promise<S.BudgetList> {
    return this.h.request('GET', '/v1/budgets');
  }
  /** A daily or monthly cap for the organization, a project or an agent. Scope: billing:write. */
  createBudget(body: S.BudgetCreate, o: Mut = {}): Promise<S.Budget> {
    return this.h.request('POST', '/v1/budgets', { json: body, ...o });
  }
  /** Change a cap's limit or status. Scope: billing:write. */
  patchBudget(budgetId: string, body: S.BudgetPatch, o: Mut = {}): Promise<S.Budget> {
    return this.h.request('PATCH', `/v1/budgets/${budgetId}`, { json: body, ...o });
  }
  /** Usage rollups by day, direction, destination and project. Scope: billing:read. */
  usage(p: { from?: string; to?: string; group_by?: string; project_id?: string } = {}): Promise<S.UsageReport> {
    return this.h.request('GET', '/v1/usage', { params: p });
  }
  /** Export usage as CSV behind a signed download. Scope: billing:read. */
  createUsageExport(body: S.UsageExportCreate, o: Mut = {}): Promise<S.UsageExport> {
    return this.h.request('POST', '/v1/usage-exports', { json: body, ...o });
  }
  /** Read a usage export with a fresh link. Scope: billing:read. */
  getUsageExport(exportId: string): Promise<S.UsageExport> {
    return this.h.request('GET', `/v1/usage-exports/${exportId}`);
  }
  /** Stripe invoices and receipts as hosted links. Scope: billing:read. */
  listInvoices(p: Page = {}): Promise<S.InvoicePage> {
    return this.h.request('GET', '/v1/invoices', { params: p });
  }
  /** Every invoice, following next_cursor. */
  iterInvoices(p: Omit<Page, 'cursor'> = {}): AsyncGenerator<S.Invoice, void, undefined> {
    return paginate((cursor) => this.listInvoices({ ...p, cursor }));
  }
  /** One invoice. Scope: billing:read. */
  getInvoice(invoiceId: string): Promise<S.Invoice> {
    return this.h.request('GET', `/v1/invoices/${invoiceId}`);
  }
  /** A hosted Checkout for the Agent workspace subscription. Scope: billing:write. */
  createSubscriptionCheckout(o: Mut = {}): Promise<S.SubscriptionCheckout> {
    return this.h.request('POST', '/v1/subscriptions/checkout', { json: {}, ...o });
  }
  /** Subscriptions and the workspace entitlement. Scope: billing:read. */
  listSubscriptions(): Promise<S.SubscriptionList> {
    return this.h.request('GET', '/v1/subscriptions');
  }
  /** The Stripe customer portal. Scope: billing:write. */
  createPortalSession(o: Mut = {}): Promise<S.PortalSession> {
    return this.h.request('POST', '/v1/billing-portal-sessions', { json: {}, ...o });
  }
}

export class Platform extends Resource {
  /** Limits, routes, formats, prices and scopes in force. Scope: any. */
  capabilities(): Promise<S.Capabilities> {
    return this.h.request('GET', '/v1/capabilities');
  }
  /** Customer-safe availability. Scope: any. */
  serviceStatus(): Promise<S.ServiceStatus> {
    return this.h.request('GET', '/v1/service-status');
  }
}

export class Sandbox extends Resource {
  /** The scenario catalog, the destination table and active fixtures. Test keys only. */
  listScenarios(): Promise<S.SandboxScenarios> {
    return this.h.request('GET', '/v1/sandbox/scenarios');
  }
  /** Pin an outcome to a destination (or to every send) for 24 hours. Test keys only. */
  createScenario(body: S.SandboxScenarioCreate, o: Mut = {}): Promise<S.SandboxFixture> {
    return this.h.request('POST', '/v1/sandbox/scenarios', { json: body, ...o });
  }
  /** A synthetic received fax and its fax.received event. Test keys only. */
  createInboundFax(body: S.SandboxInboundCreate, o: Mut = {}): Promise<S.InboxItemSummary> {
    return this.h.request('POST', '/v1/sandbox/inbound-faxes', { json: body, ...o });
  }
  /** Delete the organization's test data and reseed the test wallet. Test keys only. */
  reset(o: Mut = {}): Promise<S.SandboxReset> {
    return this.h.request('DELETE', '/v1/sandbox/data', o);
  }
}

export class Approvals extends Resource {
  /** Ask a person to approve a quoted send. Grants nothing. Scope: approval:request. */
  request(quoteId: string, o: Mut = {}): Promise<S.ApprovalRequest> {
    return this.h.request('POST', '/v1/approval-requests', { json: { kind: 'send', quote_id: quoteId }, ...o });
  }
  /** Ask a person for help. The message is shown as data. Scope: approval:request. */
  requestHelp(message: string, opts: { faxJobId?: string } & Mut = {}): Promise<S.ApprovalRequest> {
    const { faxJobId, ...o } = opts;
    return this.h.request('POST', '/v1/approval-requests', {
      json: { kind: 'help', message, fax_job_id: faxJobId },
      ...o,
    });
  }
  /** Requests, pending first. Scope: approval:read. */
  list(p: Page & { status?: string } = {}): Promise<S.ApprovalRequestPage> {
    return this.h.request('GET', '/v1/approval-requests', { params: p });
  }
  /** Every request, following next_cursor. */
  iter(p: Omit<Page, 'cursor'> & { status?: string } = {}): AsyncGenerator<S.ApprovalRequest, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
  /** One request. Scope: approval:read. */
  get(approvalId: string): Promise<S.ApprovalRequest> {
    return this.h.request('GET', `/v1/approval-requests/${approvalId}`);
  }
  /** Poll until the request leaves pending, or the timeout passes. */
  async wait(approvalId: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<S.ApprovalRequest> {
    const deadline = Date.now() + (opts.timeoutMs ?? 600_000);
    let req = await this.get(approvalId);
    while (req.status === 'pending' && Date.now() < deadline) {
      await sleep(opts.intervalMs ?? 5000);
      req = await this.get(approvalId);
    }
    return req;
  }
  /** Approve the bound send. Scope: approval:decide, never the key that asked, never an agent key. */
  approve(approvalId: string, body: S.ApprovalDecision = {}, o: Mut = {}): Promise<S.ApprovalRequest> {
    return this.h.request('POST', `/v1/approval-requests/${approvalId}/approve`, { json: body, ...o });
  }
  /** Reject with a reason. Scope: approval:decide. */
  reject(approvalId: string, body: S.ApprovalDecision, o: Mut = {}): Promise<S.ApprovalRequest> {
    return this.h.request('POST', `/v1/approval-requests/${approvalId}/reject`, { json: body, ...o });
  }
  /** Revoke an approval nobody has used yet. Scope: approval:decide. */
  revoke(approvalId: string, body: S.ApprovalDecision = {}, o: Mut = {}): Promise<S.ApprovalRequest> {
    return this.h.request('POST', `/v1/approvals/${approvalId}/revoke`, { json: body, ...o });
  }
}

export class Policies extends Resource {
  /** The organization's policies. Scope: policy:read. */
  list(): Promise<S.PolicyList> {
    return this.h.request('GET', '/v1/policies');
  }
  /** Create a delegated policy, version 1. Scope: policy:admin, never an agent key. */
  create(body: S.PolicyCreate, o: Mut = {}): Promise<S.Policy> {
    return this.h.request('POST', '/v1/policies', { json: body, ...o });
  }
  /**
   * What a key is allowed to do alone, and whether a human is needed. Scope: policy:read. With no
   * argument the answer is for the calling key. Pass at most one of `key_id`, `agent_id` or
   * `connection_id` (a connected app, see `oauth.listGrants`) to ask about another principal.
   */
  effective(p: { key_id?: string; agent_id?: string; connection_id?: string } = {}): Promise<S.EffectivePolicies> {
    return this.h.request('GET', '/v1/policies/effective', { params: p });
  }
  /** The auto-send setting for connected apps in this key's environment. Scope: policy:read. */
  getAutoSend(): Promise<S.AutoSendSetting> {
    return this.h.request('GET', '/v1/organizations/current/auto-send');
  }
  /**
   * Let connected apps send without asking, inside an amount per fax and a count per day.
   * Scope: org:admin and policy:admin, never an agent key.
   */
  setAutoSend(body: S.AutoSendUpdate, o: Mut = {}): Promise<S.AutoSendSetting> {
    const idempotencyKey = o.idempotencyKey ?? crypto.randomUUID();
    return this.h.request('PUT', '/v1/organizations/current/auto-send', { json: body, idempotencyKey });
  }
  /** A policy at its current version. Scope: policy:read. */
  get(policyId: string): Promise<S.Policy> {
    return this.h.request('GET', `/v1/policies/${policyId}`);
  }
  /** Change a policy: a new immutable version. Scope: policy:admin. */
  update(policyId: string, body: S.PolicyUpdate, o: Mut = {}): Promise<S.Policy> {
    return this.h.request('PATCH', `/v1/policies/${policyId}`, { json: body, ...o });
  }
  /** Every version, oldest first. Scope: policy:read. */
  listVersions(policyId: string): Promise<S.PolicyVersionList> {
    return this.h.request('GET', `/v1/policies/${policyId}/versions`);
  }
  /** Dry run: would this key's policies allow the send? Never executes. Scope: policy:read. */
  evaluate(body: S.PolicyEvaluationCreate): Promise<S.PolicyEvaluation> {
    return this.h.request('POST', '/v1/policy-evaluations', { json: body });
  }
}

export class Agents extends Resource {
  /** Agent identities. Scope: agent:read. */
  list(): Promise<S.AgentList> {
    return this.h.request('GET', '/v1/agents');
  }
  /** Register an agent identity. Scope: agent:admin, never an agent key. */
  create(body: S.AgentCreate, o: Mut = {}): Promise<S.Agent> {
    return this.h.request('POST', '/v1/agents', { json: body, ...o });
  }
  /** An agent with its keys and budgets. Scope: agent:read. */
  get(agentId: string): Promise<S.Agent> {
    return this.h.request('GET', `/v1/agents/${agentId}`);
  }
  /** Change an agent. Disabling revokes its keys. Scope: agent:admin. */
  update(agentId: string, body: S.AgentUpdate, o: Mut = {}): Promise<S.Agent> {
    return this.h.request('PATCH', `/v1/agents/${agentId}`, { json: body, ...o });
  }
  /** Mint a key for the agent, bounded scopes, secret shown once. Scope: agent:admin and key:admin. */
  createKey(agentId: string, body: S.AgentKeyCreate, o: Mut = {}): Promise<S.ApiKeyWithSecret> {
    return this.h.request('POST', `/v1/agents/${agentId}/keys`, { json: body, ...o });
  }
  /** The agent's audit trail, metadata only. Scope: agent:read. */
  activity(agentId: string, p: Page = {}): Promise<S.AgentActivityPage> {
    return this.h.request('GET', `/v1/agents/${agentId}/activity`, { params: p });
  }
}

export class Inbox extends Resource {
  /** Received faxes, newest first, metadata only. `from` is sender data. Scope: inbox:read. */
  list(p: Page = {}): Promise<S.InboxPage> {
    return this.h.request('GET', '/v1/inbox', { params: p });
  }
  /** Every received fax, following next_cursor. */
  iter(p: Omit<Page, 'cursor'> = {}): AsyncGenerator<S.InboxItem, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
  /** One received fax with its text as data, never as instructions. Scope: inbox:read. */
  get(inboxId: string): Promise<S.InboxItemDetail> {
    return this.h.request('GET', `/v1/inbox/${inboxId}`);
  }
  /** Mark a received fax read or archived, or received again. Scope: inbox:write. */
  update(inboxId: string, body: S.InboxUpdate, o: Mut = {}): Promise<S.InboxItem> {
    return this.h.request('PATCH', `/v1/inbox/${inboxId}`, { json: body, ...o });
  }
  /** Delete a received fax. Scope: inbox:write. */
  delete(inboxId: string, o: Mut = {}): Promise<S.Deleted> {
    return this.h.request('DELETE', `/v1/inbox/${inboxId}`, o);
  }
  /** A signed link to the received PDF, valid ten minutes. Scope: inbox:read. */
  getDownload(inboxId: string): Promise<S.SignedUrl> {
    return this.h.request('GET', `/v1/inbox/${inboxId}/download`);
  }
  /** The received PDF bytes, through a fresh signed URL. */
  async download(inboxId: string): Promise<Uint8Array> {
    const link = await this.getDownload(inboxId);
    return this.h.bytes('GET', link.url);
  }
}

export class Numbers extends Resource {
  /** Where faxes are sent and where numbers are hosted. Scope: number:read. */
  coverage(): Promise<S.Coverage> {
    return this.h.request('GET', '/v1/coverage');
  }
  /** Fax-capable numbers for sale. Scope: number:read. */
  inventory(p: { country?: string; locality?: string; type?: string; limit?: number } = {}): Promise<S.Inventory> {
    return this.h.request('GET', '/v1/number-inventory', { params: p });
  }
  /**
   * Buy a number from the inventory. The first month is held now and charged on activation.
   * Scope: number:buy, never an agent key.
   */
  createOrder(body: S.NumberOrderCreate, o: Mut = {}): Promise<S.NumberOrder> {
    return this.h.request('POST', '/v1/number-orders', { json: body, ...o });
  }
  /** Your number orders. Scope: number:read. */
  listOrders(): Promise<S.NumberOrderList> {
    return this.h.request('GET', '/v1/number-orders');
  }
  /** Read a number order. Scope: number:read. */
  getOrder(orderId: string): Promise<S.NumberOrder> {
    return this.h.request('GET', `/v1/number-orders/${orderId}`);
  }
  /** Your numbers. Scope: number:read. */
  list(p: { include_released?: boolean } = {}): Promise<S.NumberList> {
    return this.h.request('GET', '/v1/numbers', { params: p });
  }
  /** One number. Scope: number:read. */
  get(numberId: string): Promise<S.Number> {
    return this.h.request('GET', `/v1/numbers/${numberId}`);
  }
  /**
   * Change the label, project, inbound webhook or `email_pdf` of a number. Scope: number:buy.
   * `email_pdf: true` attaches the PDF of each received fax to the notice mail. An agent key is refused.
   */
  update(numberId: string, body: S.NumberUpdate, o: Mut = {}): Promise<S.Number> {
    return this.h.request('PATCH', `/v1/numbers/${numberId}`, { json: body, ...o });
  }
  /** Release a number. `confirm` is the number itself, typed out. A 30 day quarantine follows. Scope: number:buy. */
  release(numberId: string, body: S.ReleaseRequest, o: Mut = {}): Promise<S.Number> {
    return this.h.request('POST', `/v1/numbers/${numberId}/release-requests`, { json: body, ...o });
  }
  /** Whether these numbers can port in. Scope: number:read. */
  checkPortability(body: S.PortabilityCheckCreate, o: Mut = {}): Promise<S.PortabilityCheck> {
    return this.h.request('POST', '/v1/portability-checks', { json: body, ...o });
  }
  /** Port orders and port-out requests. Scope: number:read. */
  listPortOrders(): Promise<S.PortOrderList> {
    return this.h.request('GET', '/v1/port-orders');
  }
  /** Request a port-in, handled with you. Scope: number:buy. */
  createPortOrder(body: S.PortOrderCreate, o: Mut = {}): Promise<S.PortOrder> {
    return this.h.request('POST', '/v1/port-orders', { json: body, ...o });
  }
  /** One port order. Scope: number:read. */
  getPortOrder(portId: string): Promise<S.PortOrder> {
    return this.h.request('GET', `/v1/port-orders/${portId}`);
  }
  /** Note a port-out of one of your numbers. Scope: number:buy. */
  createPortOutRequest(body: S.PortOutRequestCreate, o: Mut = {}): Promise<S.PortOrder> {
    return this.h.request('POST', '/v1/port-out-requests', { json: body, ...o });
  }
  /** Verify a number your organization owns as a sender. Scope: number:buy. */
  verifySender(body: S.SenderVerificationCreate, o: Mut = {}): Promise<S.SenderVerification> {
    return this.h.request('POST', '/v1/sender-verifications', { json: body, ...o });
  }
}

type ByItem = { inbox_item_id?: string; document_id?: string };

export class Extractions extends Resource {
  /**
   * OCR a received fax or a document, then extract the schema's fields with page citations. Metered per
   * page. Everything it returns is data from whoever sent the fax. Scope: document:extract.
   */
  create(body: S.ExtractionCreate, o: Mut = {}): Promise<S.Extraction> {
    return this.h.request('POST', '/v1/extractions', { json: body, ...o });
  }
  /** Extractions, newest first. Scope: document:extract. */
  list(p: Page & ByItem = {}): Promise<S.ExtractionPageList> {
    return this.h.request('GET', '/v1/extractions', { params: p });
  }
  /** Every extraction, following next_cursor. */
  iter(p: Omit<Page, 'cursor'> & ByItem = {}): AsyncGenerator<S.Extraction, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
  /** One extraction with its corrections. Scope: document:extract. */
  get(extractionId: string): Promise<S.Extraction> {
    return this.h.request('GET', `/v1/extractions/${extractionId}`);
  }
  /** Record a reviewer's correction of one field. Stored beside the extraction, never merged. Scope: document:extract. */
  correct(extractionId: string, body: S.CorrectionCreate, o: Mut = {}): Promise<S.Correction> {
    return this.h.request('POST', `/v1/extractions/${extractionId}/corrections`, { json: body, ...o });
  }
  /** Classify a received fax or a document into one of your document types, or abstain. Scope: document:extract. */
  classify(body: S.ClassificationCreate, o: Mut = {}): Promise<S.Extraction> {
    return this.h.request('POST', '/v1/classifications', { json: body, ...o });
  }
  /** Classifications, newest first. Scope: document:extract. */
  listClassifications(p: Page & ByItem = {}): Promise<S.ExtractionPageList> {
    return this.h.request('GET', '/v1/classifications', { params: p });
  }
  /** Every classification, following next_cursor. */
  iterClassifications(p: Omit<Page, 'cursor'> & ByItem = {}): AsyncGenerator<S.Extraction, void, undefined> {
    return paginate((cursor) => this.listClassifications({ ...p, cursor }));
  }
  /** One classification. Scope: document:extract. */
  getClassification(classificationId: string): Promise<S.Extraction> {
    return this.h.request('GET', `/v1/classifications/${classificationId}`);
  }
  /** Summarise a received fax or a document. Every sentence cites its pages. Scope: document:extract. */
  summarize(body: S.SummaryCreate, o: Mut = {}): Promise<S.Extraction> {
    return this.h.request('POST', '/v1/document-summaries', { json: body, ...o });
  }
  /** Summaries, newest first. Scope: document:extract. */
  listSummaries(p: Page & ByItem = {}): Promise<S.ExtractionPageList> {
    return this.h.request('GET', '/v1/document-summaries', { params: p });
  }
  /** Every summary, following next_cursor. */
  iterSummaries(p: Omit<Page, 'cursor'> & ByItem = {}): AsyncGenerator<S.Extraction, void, undefined> {
    return paginate((cursor) => this.listSummaries({ ...p, cursor }));
  }
  /** One summary. Scope: document:extract. */
  getSummary(summaryId: string): Promise<S.Extraction> {
    return this.h.request('GET', `/v1/document-summaries/${summaryId}`);
  }
  /** Your saved extraction schemas. Scope: document:extract. */
  listSchemas(): Promise<S.ExtractionSchemaList> {
    return this.h.request('GET', '/v1/extraction-schemas');
  }
  /** Save a versioned extraction schema. The same name again is the next version. Scope: document:extract. */
  createSchema(body: S.SchemaCreate, o: Mut = {}): Promise<S.ExtractionSchema> {
    return this.h.request('POST', '/v1/extraction-schemas', { json: body, ...o });
  }
  /** One schema version. Scope: document:extract. */
  getSchema(schemaId: string): Promise<S.ExtractionSchema> {
    return this.h.request('GET', `/v1/extraction-schemas/${schemaId}`);
  }
}

export class Organizations extends Resource {
  /** The organizations the caller belongs to. Scope: any. */
  list(): Promise<S.OrganizationList> {
    return this.h.request('GET', '/v1/organizations');
  }
  /** The organization of this key. Scope: account:read. */
  current(): Promise<S.Organization> {
    return this.h.request('GET', '/v1/organizations/current');
  }
  /** Rename the organization. Scope: member:admin, never an agent key. */
  updateCurrent(body: S.OrganizationPatch, o: Mut = {}): Promise<S.Organization> {
    return this.h.request('PATCH', '/v1/organizations/current', { json: body, ...o });
  }
  /** Ask for an export of the organization's data. Scope: org:admin, never an agent key. */
  requestDataExport(o: Mut = {}): Promise<S.Requested> {
    return this.h.request('POST', '/v1/organizations/current/export-requests', { json: {}, ...o });
  }
  /** Ask for the organization and its data to be deleted. Scope: org:admin, never an agent key. */
  requestDataDeletion(o: Mut = {}): Promise<S.Requested> {
    return this.h.request('POST', '/v1/organizations/current/deletion-requests', { json: {}, ...o });
  }
  /**
   * The organization archive of a data export. `token`, `exp` and `sig` come from the signed link,
   * which lives 72 hours. The link is the credential.
   */
  downloadExportArchive(token: string, p: { exp: string; sig: string }): Promise<Uint8Array> {
    return this.h.bytes('GET', `/v1/organization/export-archives/${token}`, { params: p });
  }
}

export class Members extends Resource {
  /** The organization's members. Scope: account:read. */
  list(): Promise<S.MemberList> {
    return this.h.request('GET', '/v1/members');
  }
  /** Change a member's role: owner, admin, member or viewer. Scope: member:admin, never an agent key. */
  update(memberId: string, body: S.MemberPatch, o: Mut = {}): Promise<S.Member> {
    return this.h.request('PATCH', `/v1/members/${memberId}`, { json: body, ...o });
  }
  /** Remove a member. Scope: org:admin, never an agent key. */
  async remove(memberId: string, o: Mut = {}): Promise<void> {
    await this.h.request('DELETE', `/v1/members/${memberId}`, o);
  }
  /** Open invitations. Scope: member:admin. */
  listInvitations(): Promise<S.InvitationList> {
    return this.h.request('GET', '/v1/invitations');
  }
  /** Invite someone by email, a link that works for 7 days. Scope: member:admin, never an agent key. */
  invite(body: S.InvitationCreate, o: Mut = {}): Promise<S.Invitation> {
    return this.h.request('POST', '/v1/invitations', { json: body, ...o });
  }
  /** Withdraw an invitation. Scope: member:admin, never an agent key. */
  async revokeInvitation(invitationId: string, o: Mut = {}): Promise<void> {
    await this.h.request('DELETE', `/v1/invitations/${invitationId}`, o);
  }
}

export class Oauth extends Resource {
  /** The organization's connected apps. Scope: key:admin, never an agent key. */
  listGrants(p: Page = {}): Promise<S.GrantList> {
    return this.h.request('GET', '/v1/oauth/grants', { params: p });
  }
  /** Every connected app, following next_cursor. */
  iterGrants(p: Omit<Page, 'cursor'> = {}): AsyncGenerator<S.Grant, void, undefined> {
    return paginate((cursor) => this.listGrants({ ...p, cursor }));
  }
  /** Revoke a connected app. Scope: key:admin, never an agent key. */
  async revokeGrant(grantId: string, o: Mut = {}): Promise<void> {
    await this.h.request('DELETE', `/v1/oauth/grants/${grantId}`, o);
  }
}

/** Content types a one-time order takes as a file, by suffix. Anything else is sent as a PDF. */
const ONE_TIME_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ...CONTENT_TYPES,
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

/** The status token of a one-time order, for a client that has no key of the order's organization. */
type Tok = { orderToken?: string };

const tokenHeader = (orderToken?: string): Record<string, string> | undefined =>
  orderToken ? { [ORDER_TOKEN_HEADER]: orderToken } : undefined;

/** The step of a one-time order that is waiting: what `OneTimeOrder.next` says. */
export type OneTimeNext = S.OneTimeOrder['next'];

/** What `oneTimeSends.create` takes: the fields of the order and exactly one of `file` or `text`. */
export interface OneTimeCreate {
  /** The destination fax number, E.164. */
  to: string;
  /** Printed on the cover sheet. 2 to 120 characters. */
  sender_name: string;
  /** True: the sender accepts the acceptable use policy and the terms that `config` names. */
  accept_aup: boolean;
  /** Where the confirmation link and the receipt go. Required without a key. */
  email?: string;
  /** The document as bytes: a PDF, PNG, JPEG or TIFF. Sent as multipart. */
  file?: Uint8Array | ArrayBuffer | Blob;
  /** The name of `file`. Its suffix picks the content type. Default document.pdf. */
  filename?: string;
  /** The content type of `file`, when the suffix of `filename` does not say. */
  content_type?: string;
  /** The document as plain text or Markdown. Sent as JSON. */
  text?: string;
  text_format?: 'text' | 'markdown';
  to_name?: string;
  subject?: string;
  message?: string;
  delete_after_send?: boolean;
  /** Where the sender came from: a short tag, never a URL. */
  source_ref?: string;
}

/**
 * One fax paid by card, with no wallet (the one-time-sends operations).
 *
 * A person pays on the hosted page of `checkout` and clicks the link mailed to them. Nothing here
 * charges a card. The create answers `status_token` once. Pass it as `orderToken` to read the order,
 * open its checkout and mail the confirmation again from a client that has no key. A key of the order's
 * organization needs no token.
 */
export class OneTimeSends extends Resource {
  /** Whether one-time sends are open, with the card and the limits. No key needed. */
  config(): Promise<S.OneTimeConfig> {
    return this.h.request('GET', '/v1/one-time-sends/config');
  }
  /**
   * Create an order from exactly one of `file` or `text`. Nothing is charged or sent. `email` is required
   * without a key. A test key is refused: an order is always live. Scope with a key: fax:send.
   */
  create(body: OneTimeCreate, o: Mut = {}): Promise<S.OneTimeOrderCreated> {
    const { file, filename, content_type, ...fields } = body;
    if ((file === undefined) === (fields.text === undefined)) {
      throw new Error('pass exactly one of file or text');
    }
    if (file === undefined) {
      return this.h.request('POST', '/v1/one-time-sends', { json: fields, ...o });
    }
    const name = filename ?? 'document.pdf';
    const dot = name.lastIndexOf('.');
    const suffix = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    const type = content_type ?? ONE_TIME_CONTENT_TYPES[suffix] ?? 'application/pdf';
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) form.set(key, String(value));
    }
    const part = file instanceof Blob ? file : new Blob([file as BlobPart], { type });
    form.set('file', part.type === type ? part : new Blob([part], { type }), name);
    return this.h.request('POST', '/v1/one-time-sends', { body: form, ...o });
  }
  /**
   * Turn a live quote the wallet does not cover into an order. Scope: fax:send, a live key. The price
   * is the one-time price of the card, not the quote's. Paying by card does not replace approval: pass
   * `approval_id` unless a delegated policy allows the send, or the answer is 403 approval_required.
   *
   * A key does not accept the terms for the payer, so `accept_aup` is optional. The order answers
   * `aup_accepted` false and a `status_url`: hand that page to the person who pays. They accept the
   * acceptable use policy and the terms there.
   */
  createFromQuote(body: S.OneTimeFromQuote, o: Mut = {}): Promise<S.OneTimeOrderCreated> {
    return this.h.request('POST', '/v1/one-time-sends/from-quote', { json: body, ...o });
  }
  /** The organization's orders, newest first. A test key reads an empty list. Scope: fax:read. */
  list(p: Page & { status?: S.OneTimeOrder['status'] } = {}): Promise<S.OneTimeOrderPage> {
    return this.h.request('GET', '/v1/one-time-sends', { params: p });
  }
  /** Every order, following next_cursor. */
  iter(
    p: Omit<Page, 'cursor'> & { status?: S.OneTimeOrder['status'] } = {},
  ): AsyncGenerator<S.OneTimeOrder, void, undefined> {
    return paginate((cursor) => this.list({ ...p, cursor }));
  }
  /**
   * The order: its status, the step that is waiting in `next`, and the fax once released. Read it with
   * a key of the order's organization (scope fax:read) or with `orderToken`.
   */
  get(orderId: string, o: Tok = {}): Promise<S.OneTimeOrder> {
    return this.h.request('GET', `/v1/one-time-sends/${orderId}`, { headers: tokenHeader(o.orderToken) });
  }
  /**
   * Poll until `next` is `until` (done by default), or the order is done. Returns the last order read,
   * which may still be short of `until` when the timeout ran out. A person pays and confirms, so allow
   * minutes.
   */
  async wait(
    orderId: string,
    opts: Tok & { until?: OneTimeNext | OneTimeNext[]; timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<S.OneTimeOrder> {
    const wanted = new Set<string>(['done', ...[opts.until ?? 'done'].flat()]);
    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    let order = await this.get(orderId, opts);
    while (!wanted.has(order.next) && Date.now() < deadline) {
      await sleep(opts.intervalMs ?? 3000);
      order = await this.get(orderId, opts);
    }
    return order;
  }
  /**
   * Open the hosted card payment and return its `checkout_url`. Scope with a key: fax:send. The card is
   * authorized on that page and charged only when the carrier confirms delivery. A second call answers
   * the same page while it can still be paid.
   *
   * An order whose `aup_accepted` is false needs `acceptAup: true` once: the person who pays accepts
   * the acceptable use policy and the terms. The server takes it with `orderToken` or a session, never
   * from a key.
   */
  checkout(orderId: string, o: Mut & Tok & { acceptAup?: boolean } = {}): Promise<S.OneTimeCheckout> {
    return this.h.request('POST', `/v1/one-time-sends/${orderId}/checkout`, {
      json: o.acceptAup === undefined ? {} : { accept_aup: o.acceptAup },
      headers: tokenHeader(o.orderToken),
      idempotencyKey: o.idempotencyKey,
    });
  }
  /**
   * What a mailed confirmation link is for, without using it. No key needed. The token travels in the
   * body, so it stays out of the address and of access logs. Nothing is consumed and nothing changes.
   * Needs API 1.17.0.
   */
  readByToken(token: string): Promise<S.OneTimeConfirmSummary> {
    return this.h.request('POST', '/v1/one-time-sends/by-token', { json: { token } });
  }
  /**
   * The same read with the token in the path. A token in a path reaches access logs. The API keeps this
   * route for older callers and marks it deprecated since 1.17.0.
   *
   * @deprecated Use `readByToken`.
   */
  getByToken(token: string): Promise<S.OneTimeConfirmSummary> {
    return this.h.request('GET', `/v1/one-time-sends/by-token/${encodeURIComponent(token)}`);
  }
  /**
   * Confirm the order with the token of the mailed link. The fax is released. No key needed. The link
   * works once. A repeat answers 409 link_used and sends nothing.
   */
  confirm(orderId: string, token: string): Promise<S.OneTimeConfirmed> {
    return this.h.request('POST', `/v1/one-time-sends/${orderId}/confirm`, { json: { token } });
  }
  /** Mail the confirmation link again. At most three times per order and once in ten minutes. */
  resendConfirmation(orderId: string, o: Mut & Tok = {}): Promise<S.OneTimeOrder> {
    return this.h.request('POST', `/v1/one-time-sends/${orderId}/resend-confirmation`, {
      json: {},
      headers: tokenHeader(o.orderToken),
      idempotencyKey: o.idempotencyKey,
    });
  }
  /** The receipt of the order's fax as a one-page PDF. 409 while the fax has not ended. */
  getReceiptPdf(orderId: string, o: Tok = {}): Promise<Uint8Array> {
    return this.h.bytes('GET', `/v1/one-time-sends/${orderId}/receipt.pdf`, {
      headers: tokenHeader(o.orderToken),
    });
  }
}

export class FaxForAgents {
  readonly http: Http;
  readonly identity: Identity;
  readonly documents: Documents;
  readonly quotes: Quotes;
  readonly faxes: Faxes;
  readonly webhooks: Webhooks;
  readonly events: Events;
  readonly billing: Billing;
  readonly platform: Platform;
  readonly sandbox: Sandbox;
  readonly approvals: Approvals;
  readonly policies: Policies;
  readonly agents: Agents;
  readonly inbox: Inbox;
  readonly numbers: Numbers;
  readonly extractions: Extractions;
  readonly organizations: Organizations;
  readonly members: Members;
  readonly oauth: Oauth;
  readonly oneTimeSends: OneTimeSends;

  constructor(opts: ClientOptions = {}) {
    this.http = new Http(opts);
    this.identity = new Identity(this.http);
    this.documents = new Documents(this.http);
    this.quotes = new Quotes(this.http);
    this.faxes = new Faxes(this.http);
    this.webhooks = new Webhooks(this.http);
    this.events = new Events(this.http);
    this.billing = new Billing(this.http);
    this.platform = new Platform(this.http);
    this.sandbox = new Sandbox(this.http);
    this.approvals = new Approvals(this.http);
    this.policies = new Policies(this.http);
    this.agents = new Agents(this.http);
    this.inbox = new Inbox(this.http);
    this.numbers = new Numbers(this.http);
    this.extractions = new Extractions(this.http);
    this.organizations = new Organizations(this.http);
    this.members = new Members(this.http);
    this.oauth = new Oauth(this.http);
    this.oneTimeSends = new OneTimeSends(this.http);
  }

  /** Shortcut for identity.me(). */
  me(): Promise<S.Me> {
    return this.identity.me();
  }

  /** Any operation the resources do not cover yet. Returns the parsed JSON. */
  request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.http.request<T>(method, path, opts);
  }
}
