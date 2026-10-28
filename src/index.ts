/**
 * TypeScript and JavaScript client for Fax for Agents, https://faxforagents.com.
 *
 * Fax for Agents is a fax API, a hosted MCP server and SDKs built so AI agents can send and receive
 * faxes. This package wraps every /v1 operation of the REST API with types generated from the public
 * OpenAPI document, an Idempotency-Key on every mutating call, retries that honour Retry-After,
 * pagination helpers and the webhook signature check. Zero runtime dependencies: fetch and Web Crypto.
 *
 *   import { FaxForAgents } from 'faxforagents';
 *
 *   const ffa = new FaxForAgents();                       // reads FAXFORAGENTS_API_KEY
 *   const doc = await ffa.documents.create({ text: 'Hello from an agent.' });
 *   const quote = await ffa.quotes.create({ document_id: doc.id, to: '+15550000001' });
 *   const fax = await ffa.faxes.wait((await ffa.faxes.create({ quote_id: quote.id })).id);
 *   console.log(fax.state);                               // delivered, with fax.evidence
 */

export {
  Agents,
  Approvals,
  Billing,
  Documents,
  Events,
  FaxForAgents,
  Faxes,
  Identity,
  Inbox,
  Platform,
  Policies,
  Quotes,
  Sandbox,
  TERMINAL_STATES,
  Webhooks,
} from './client.js';
export { FaxForAgents as Client } from './client.js';
export {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  ConflictError,
  FaxForAgentsError,
  InvalidRequestError,
  NotFoundError,
  PaymentRequiredError,
  RateLimitedError,
  ScopeError,
  ServerError,
} from './errors.js';
export type { APIErrorFields } from './errors.js';
export { DEFAULT_BASE_URL, Http, paginate } from './http.js';
export type { ClientOptions, RequestOptions } from './http.js';
export { SignatureError, parseEvent, sign, signatureHeaders, verifyWebhook } from './webhooks.js';
export type { WebhookEvent } from './webhooks.js';
export { VERSION } from './version.js';
export type * from './schema.js';
