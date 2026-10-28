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

import { ClientOptions, Http, RequestOptions, paginate } from './http.js';
import type * as S from './schema.js';

export const TERMINAL_STATES: ReadonlySet<string> = new Set(['delivered', 'partial', 'failed', 'unknown']);

type Mut = { idempotencyKey?: string };
type Page = { cursor?: string; limit?: number };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  /** An immutable document from one of upload_id, text, markdown or html. Scope: document:write. */
  create(body: S.DocumentCreate, o: Mut = {}): Promise<S.Document> {
    return this.h.request('POST', '/v1/documents', { json: body, ...o });
  }
  /** Open an upload session with a signed PUT URL (25 MB, one hour). Scope: document:write. */
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
  /** The whole PDF path: createUpload, put the bytes, complete with the sha256, create the document. */
  async upload(data: Uint8Array | ArrayBuffer, opts: { filename?: string; contentType?: string } = {}): Promise<S.Document> {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const filename = opts.filename ?? 'document.pdf';
    const contentType = opts.contentType ?? 'application/pdf';
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
  /** The PDF bytes, through a fresh signed URL. */
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
  /** Fax jobs, newest first. Scope: fax:read. */
  list(p: Page & { state?: string } = {}): Promise<S.FaxJobPage> {
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
  createInboundFax(body: S.SandboxInboundCreate, o: Mut = {}): Promise<S.InboxItem> {
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
  /** What this key is allowed to do alone, and whether a human is needed. Scope: policy:read. */
  effective(): Promise<S.EffectivePolicies> {
    return this.h.request('GET', '/v1/policies/effective');
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
