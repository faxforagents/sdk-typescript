<p align="center">
  <a href="https://faxforagents.com"><img src="https://faxforagents.com/brand/logo-512.png" width="88" alt="Fax for Agents"></a>
</p>

<h1 align="center">faxforagents</h1>

<p align="center">The TypeScript and JavaScript client for <a href="https://faxforagents.com">Fax for Agents</a>, the fax API built for AI agents.</p>

<p align="center">
  <a href="https://faxforagents.com">Website</a> ·
  <a href="https://faxforagents.com/docs/quickstart/">Quickstart</a> ·
  <a href="https://faxforagents.com/docs/api/">API reference</a> ·
  <a href="https://faxforagents.com/docs/sdks/">SDKs</a> ·
  <a href="https://faxforagents.com/mcp/">MCP</a> ·
  <a href="https://app.faxforagents.com">Dashboard</a> ·
  <a href="https://faxforagents.com/pricing/">Pricing</a> ·
  <a href="https://faxforagents.com/changelog/">Changelog</a> ·
  <a href="https://faxforagents.com/affiliates/">Affiliate program</a> ·
  <a href="https://gitlab.com/faxforagents/sdk-typescript">GitLab</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/faxforagents"><img src="https://img.shields.io/npm/v/faxforagents?label=npm" alt="npm version"></a>
  <a href="https://github.com/faxforagents/sdk-typescript/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/faxforagents/sdk-typescript/ci.yml?branch=main&label=ci" alt="CI"></a>
  <a href="https://github.com/faxforagents/sdk-typescript/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-1f6feb" alt="MIT licence"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-18%2B-339933" alt="Node 18+"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/types-included-3178c6" alt="TypeScript"></a>
</p>

Fax for Agents is a fax API, a hosted MCP server and SDKs built so AI agents can send and receive
faxes. It is made by JSB Holdings LLC and built by [Synapse](https://synapsereality.io/).

```bash
npm install faxforagents
```

Node 18 or later, Deno, Bun, browsers and edge runtimes. Zero runtime dependencies. The client uses
`fetch` and Web Crypto. ESM and CommonJS builds, types included.

## Quickstart, against the sandbox

A test key (`ffa_test_...`) reaches the sandbox provider only. No carrier, no cost, nothing leaves the
box. The destination number picks the outcome. Keys are created in the dashboard at
<https://app.faxforagents.com> or with `POST /v1/api-keys`.

```ts
import { FaxForAgents } from 'faxforagents';

const ffa = new FaxForAgents();                               // reads FAXFORAGENTS_API_KEY

const doc = await ffa.documents.create({ text: 'Hello from an agent.', filename: 'hello' });
console.log(doc.id, doc.page_count, doc.sha256.slice(0, 12));

const quote = await ffa.quotes.create({ document_id: doc.id, to: '+15550000001' });
console.log(quote.amount_micro, 'micro, expires', quote.expires_at);

let fax = await ffa.faxes.create({ quote_id: quote.id });     // Idempotency-Key minted for you
console.log(fax.id, fax.state);                               // queued, never delivered yet

fax = await ffa.faxes.wait(fax.id);                           // polls until a terminal state
console.log(fax.state, fax.pages_sent, fax.evidence);         // delivered, 1, {...}

for await (const job of ffa.faxes.iter({ state: 'failed' })) {  // follows next_cursor
  console.log(job.id, job.failure_code);
}
```

## What the client does for you

- Every mutating call carries an `Idempotency-Key`. When you pass none, a UUID is minted once per call
  and reused on every retry, so a retried send never creates a second fax. Pass
  `{ idempotencyKey }` as the last argument to pick your own.
- 429 and 5xx answers are retried up to three times. `Retry-After` is honoured. Network errors and
  timeouts are retried the same way.
- Cursor-paginated fax, document, event, approval, inbox, extraction and billing lists have async iterators
  that follow `next_cursor`.
- `documents.create({ text })`, `{ markdown }` or `{ html }` renders on the server. HTML prints with
  scripts off and no network, inline CSS and `data:` images only, at most 2 MiB.
- `documents.upload(bytes, { filename })` runs the whole upload path for a PDF or an image (PNG, JPG,
  TIFF): the upload session, the signed PUT with the content type read from the filename, the sha256
  check, the document. An image becomes gray letter pages.
- `faxes.wait(faxId)` and `approvals.wait(approvalId)` poll with a timeout.
- `verifyWebhook(secret, headers, body)` checks the Standard Webhooks signature on a delivery.
- Types are generated from the public OpenAPI document with openapi-typescript. Money is an integer
  count of USD micro-units (`39000` is $0.039). Timestamps are UTC strings.

For raw HTTP upload completion, send a JSON object even when you omit the checksum.

```bash
curl -X POST "https://api.faxforagents.com/v1/uploads/$UPLOAD_ID/complete" \
  -H "Authorization: Bearer $FAXFORAGENTS_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

## Resources

Method names are the operationIds of the [OpenAPI document](https://github.com/faxforagents/openapi)
in camel case, shortened by their resource. The reference at <https://faxforagents.github.io/openapi/>
names the scope each call needs.

| Resource | Calls |
|---|---|
| `ffa.identity` | `me`, `listApiKeys`, `createApiKey`, `rotateApiKey`, `revokeApiKey` |
| `ffa.documents` | `create`, `upload`, `createUpload`, `putUploadContent`, `completeUpload`, `cancelUpload`, `list`, `iter`, `get`, `delete`, `getValidation`, `getDownload`, `download`, `listPages` |
| `ffa.quotes` | `create`, `get` |
| `ffa.faxes` | `create`, `list`, `iter`, `get`, `wait`, `listEvents`, `listAttempts`, `getReceipt`, `getReceiptPdf`, `cancel` |
| `ffa.webhooks` | `list`, `create`, `update`, `delete`, `rotateSecret`, `test`, `listDeliveries`, `replayDelivery` |
| `ffa.events` | `list`, `iter` |
| `ffa.billing` | `balance`, `listLedger`, `iterLedger`, `iterTopupSessions`, `iterInvoices`, settings, top-ups, auto top-ups, budgets, `usage`, exports, invoices, subscriptions, `createPortalSession` |
| `ffa.platform` | `capabilities`, `serviceStatus` |
| `ffa.sandbox` | `listScenarios`, `createScenario`, `createInboundFax`, `reset` |
| `ffa.approvals` | `request`, `requestHelp`, `list`, `iter`, `get`, `wait`, `approve`, `reject`, `revoke` |
| `ffa.policies` | `list`, `create`, `effective`, `getAutoSend`, `setAutoSend`, `get`, `update`, `listVersions`, `evaluate` |
| `ffa.agents` | `list`, `create`, `get`, `update`, `createKey`, `activity` |
| `ffa.inbox` | `list`, `iter`, `get`, `update`, `delete`, `getDownload`, `download` |
| `ffa.numbers` | `coverage`, `inventory`, `createOrder`, `listOrders`, `getOrder`, `list`, `get`, `update`, `release`, `checkPortability`, `listPortOrders`, `createPortOrder`, `getPortOrder`, `createPortOutRequest`, `verifySender` |
| `ffa.extractions` | `create`, `list`, `iter`, `get`, `correct`, `classify`, `listClassifications`, `iterClassifications`, `getClassification`, `summarize`, `listSummaries`, `iterSummaries`, `getSummary`, `listSchemas`, `createSchema`, `getSchema` |
| `ffa.organizations` | `list`, `current`, `updateCurrent`, `requestDataExport`, `requestDataDeletion`, `downloadExportArchive` |
| `ffa.members` | `list`, `update`, `remove`, `listInvitations`, `invite`, `revokeInvitation` |
| `ffa.oauth` | `listGrants`, `iterGrants`, `revokeGrant` |
| `ffa.oneTimeSends` | `config`, `create`, `createFromQuote`, `list`, `iter`, `get`, `wait`, `checkout`, `readByToken`, `confirm`, `resendConfirmation`, `getReceiptPdf` |

`ffa.request('GET', '/v1/anything')` reaches an operation the resources do not cover yet.

## States

A fax job is `queued`, `active`, `partial`, `failed`, `unknown` or `delivered`. `delivered` is written
only when the carrier's evidence is on the attempt, and `fax.evidence` holds it. `partial` and
`unknown` never retransmit on their own. Whether to resend is a human decision.

Sandbox destinations: `+15550000001` delivered, `+15550000002` busy then delivered, `+15550000003`
partial, `+15550000004` no answer, `+15550000005` unknown, `+15550000006` provider timeout,
`+15550000007` invalid number. Any other `+1` number is delivered.

## Errors

```ts
import { APIError, RateLimitedError } from 'faxforagents';

try {
  await ffa.faxes.create({ quote_id: quote.id });
} catch (err) {
  if (err instanceof RateLimitedError) console.log('retry in', err.retryAfter);
  else if (err instanceof APIError) console.log(err.code, err.message, err.correlationId);
}
```

`AuthenticationError` (401), `ScopeError` (403), `NotFoundError` (404), `ConflictError` (409),
`PaymentRequiredError` (402), `InvalidRequestError` (400, 422), `RateLimitedError` (429) and
`ServerError` (5xx) all extend `APIError`. `APIConnectionError` and `APITimeoutError` mean the API was
not reached.

Every refusal is the same envelope, a 422 for a field that fails validation included. A 413
`payload_too_large` is a plain `APIError`: the body is over the limit of its route. The published
limits are in one table at <https://faxforagents.com/docs/limits/>.

## Approvals

A live send needs either a human approval bound to the quote or a delegated policy that allows it.

```ts
let req = await ffa.approvals.request(quote.id);     // a person is mailed
req = await ffa.approvals.wait(req.id);              // pending until they decide
if (req.status === 'approved') {
  await ffa.faxes.create({ quote_id: quote.id, approval_id: req.id });
}
```

An agent's own API key can never approve. `ffa.policies.evaluate({ quote_id })` is a dry run that
says whether a policy would allow the send.

## One fax by card

A person with one fax to send needs no wallet and no key. `oneTimeSends` makes an order, opens a hosted
card payment and follows the order until the fax ends. The person pays on the hosted page and clicks the
link mailed to them. The client never sees a card.

```ts
import { readFile } from 'node:fs/promises';
import { FaxForAgents } from 'faxforagents';

const ffa = new FaxForAgents({ keyless: true });      // no API key: only oneTimeSends answers
const config = await ffa.oneTimeSends.config();       // open here? the card and the limits
const order = await ffa.oneTimeSends.create({
  to: '+12025550123',
  sender_name: 'Dana Example',
  email: 'dana@example.com',                          // the confirmation link and the receipt go here
  accept_aup: true,                                   // the policy and terms that config names
  file: await readFile('form.pdf'),                   // or text: '...', text_format: 'markdown'
  filename: 'form.pdf',
});
const orderToken = order.status_token ?? undefined;   // answered once: keep it
const page = await ffa.oneTimeSends.checkout(order.id, { orderToken });
console.log(page.checkout_url);                       // the person pays here, then clicks the mailed link
const done = await ffa.oneTimeSends.wait(order.id, { orderToken, timeoutMs: 1_800_000 });
console.log(done.status, done.fax?.state);
const pdf = await ffa.oneTimeSends.getReceiptPdf(order.id, { orderToken });
```

`order.next` names the step that is waiting: `checkout`, `confirm`, `wait` or `done`. `wait` polls until
`done`, or until the step you pass as `until`. The card is authorized at checkout and charged only when
the carrier confirms delivery.

The status token goes in the `X-FFA-Order-Token` header. It reads the order, opens its checkout, mails
the confirmation again and downloads the receipt. A client with a live key of the order's organization
needs no token. A test key is refused: an order is always live.

With a live key, `createFromQuote` turns a quote the wallet does not cover into an order.

```ts
import { PaymentRequiredError } from 'faxforagents';

try {
  await ffa.faxes.create({ quote_id: quote.id, approval_id: approvalId });
} catch (err) {
  if (!(err instanceof PaymentRequiredError)) throw err;
  console.log(err.topUpUrl);                      // where a person adds funds to the wallet
  const offer = err.oneTimeOffer;                 // null when this send has no card path
  if (offer) {
    console.log(offer.amount_micro);              // the one-time price of this document
    const order = await ffa.oneTimeSends.createFromQuote({
      quote_id: quote.id,
      sender_name: 'Dana Example',
      approval_id: offer.approval_id,
    });
    console.log(order.status_url);                // hand this page to the person who pays
  }
}
```

Paying by card does not replace approval. With a key, a card order must have an approval or a
delegated policy, as a wallet send does. Pass the approval as `approval_id`. Without either the answer
is 403 `approval_required`.

The person who pays accepts the acceptable use policy and the terms on the order page, never the key.
With a key, the order answers `aup_accepted` false and a `status_url`. Give that link to the payer. On
a page of your own, `checkout(order.id, { orderToken, acceptAup: true })` records the payer's
acceptance and opens the payment.

`order.queue` and `config().queue` tell whether a fax would wait for a carrier line, with `jobs_ahead`
and `estimated_wait_minutes`. A queued order is kept and sent in turn.

`confirm(orderId, token)` and `readByToken(token)` serve a page of your own that receives the mailed
link. `readByToken` posts the token, so it stays out of the address. `getByToken` still works and is
deprecated. The amounts are on the [pricing page](https://faxforagents.com/pricing/) and
in `config().routes`, in micro-units.

## Webhooks

```ts
import { verifyWebhook, parseEvent, SignatureError } from 'faxforagents';

// Express: app.post('/hooks/fax', express.raw({ type: '*/*' }), async (req, res) => { ... })
try {
  const eventId = await verifyWebhook(secret, req.headers, req.body);   // raw bytes
  const event = parseEvent(req.body);                                    // event.type: fax.delivered...
  res.sendStatus(200);
} catch (err) {
  if (err instanceof SignatureError) res.sendStatus(400);
}
```

Verify on the raw bytes. `verifyWebhook` is async because it uses Web Crypto. Store the event id to
drop a redelivery you already handled. During a secret rotation two signatures arrive for 24 hours and
either one verifies.

## Prices

Price card launch-v3 is effective from 2026-11-12. $0.039 per page sent, $0.019 per page received.
$2 per number per month, $19 per month for the Agent workspace. Sandbox pages cost 0.
`ffa.platform.capabilities()` returns the card in force. One fax by card has its own price:
`ffa.oneTimeSends.config()` returns it.

## Working on this repository

```bash
npm ci
npm test                                        # vitest with msw, no network
FAXFORAGENTS_API_KEY=ffa_test_... npm run test:live    # one real sandbox send
npm run gen:types                               # src/schema.d.ts from spec/openapi.yaml
npm run typecheck && npm run build
sh scripts/truthcheck.sh
```

`spec/openapi.yaml` follows the public document at API version 1.18.0.
It holds the paths and schemas of that document and nothing else: 145 operations in 115 paths.
Sign-in, operator and provider webhook routes are not in it, and the generated types do not declare them.
A few response fields the server sends and the public schema does not list yet are declared with `x-sdk-route`.
Fields the server gives a default stay optional in the types.
To refresh it, take the public document, keep those fields, then run `npm run gen:types`.
Every operation has a client method. `test/surface.test.ts` lists them and fails on an internal path.
Keep new response fields optional so older payloads and existing callers remain valid.
The schema drift test compares every saved schema property with the generated declarations without network access.

`npm install` from a git URL builds the package on install (the `prepare` script),
so `npm install github:faxforagents/sdk-typescript` works before the package is on npm.

## Licence

MIT. See [LICENSE](LICENSE). Security reports go to hello@faxforagents.com, see [SECURITY.md](SECURITY.md).
