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
  <a href="https://faxforagents.com/changelog/">Changelog</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/faxforagents"><img src="https://img.shields.io/npm/v/faxforagents?label=npm" alt="npm version"></a>
  <a href="https://github.com/faxforagents/sdk-typescript/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/faxforagents/sdk-typescript/ci.yml?branch=main&label=ci" alt="CI"></a>
  <a href="https://github.com/faxforagents/sdk-typescript/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-1f6feb" alt="MIT licence"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-18%2B-339933" alt="Node 18+"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/types-included-3178c6" alt="TypeScript"></a>
</p>

Fax for Agents is a fax API, a hosted MCP server and SDKs built so AI agents can send and receive
faxes. It is made by JSB Holdings LLC.

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
- Every list has an `iter` twin that follows `next_cursor`, as an async iterator.
- `documents.create({ text })`, `{ markdown }` or `{ html }` renders on the server. HTML prints with
  scripts off and no network, inline CSS and `data:` images only, at most 2 MiB.
- `documents.upload(bytes, { filename })` runs the whole upload path for a PDF or an image (PNG, JPG,
  TIFF): the upload session, the signed PUT with the content type read from the filename, the sha256
  check, the document. An image becomes gray letter pages.
- `faxes.wait(faxId)` and `approvals.wait(approvalId)` poll with a timeout.
- `verifyWebhook(secret, headers, body)` checks the Standard Webhooks signature on a delivery.
- Types are generated from the public OpenAPI document with openapi-typescript. Money is an integer
  count of USD micro-units (`39000` is $0.039). Timestamps are UTC strings.

## Resources

Method names are the operationIds of the [OpenAPI document](https://github.com/faxforagents/openapi)
in camel case, shortened by their resource. The reference at <https://faxforagents.github.io/openapi/>
names the scope each call needs.

| Resource | Calls |
|---|---|
| `ffa.identity` | `me`, `listApiKeys`, `createApiKey`, `rotateApiKey`, `revokeApiKey` |
| `ffa.documents` | `create`, `upload`, `createUpload`, `putUploadContent`, `completeUpload`, `cancelUpload`, `list`, `iter`, `get`, `delete`, `getValidation`, `getDownload`, `download`, `listPages` |
| `ffa.quotes` | `create`, `get` |
| `ffa.faxes` | `create`, `list`, `iter`, `get`, `wait`, `listEvents`, `listAttempts`, `getReceipt`, `cancel` |
| `ffa.webhooks` | `list`, `create`, `update`, `delete`, `rotateSecret`, `test`, `listDeliveries`, `replayDelivery` |
| `ffa.events` | `list`, `iter` |
| `ffa.billing` | `balance`, `listLedger`, settings, top-ups, auto top-ups, budgets, `usage`, exports, invoices, subscriptions, `createPortalSession` |
| `ffa.platform` | `capabilities`, `serviceStatus` |
| `ffa.sandbox` | `listScenarios`, `createScenario`, `createInboundFax`, `reset` |
| `ffa.approvals` | `request`, `requestHelp`, `list`, `iter`, `get`, `wait`, `approve`, `reject`, `revoke` |
| `ffa.policies` | `list`, `create`, `effective`, `get`, `update`, `listVersions`, `evaluate` |
| `ffa.agents` | `list`, `create`, `get`, `update`, `createKey`, `activity` |
| `ffa.inbox` | `list`, `iter`, `get`, `update`, `delete`, `getDownload`, `download` |
| `ffa.numbers` | `coverage`, `inventory`, `createOrder`, `getOrder`, `list`, `get`, `update`, `release`, `checkPortability`, `listPortOrders`, `createPortOrder`, `getPortOrder`, `createPortOutRequest`, `verifySender` |
| `ffa.extractions` | `create`, `list`, `iter`, `get`, `correct`, `classify`, `listClassifications`, `iterClassifications`, `getClassification`, `summarize`, `listSummaries`, `iterSummaries`, `getSummary`, `listSchemas`, `createSchema`, `getSchema` |
| `ffa.organizations` | `list`, `current`, `updateCurrent`, `requestDataExport`, `requestDataDeletion` |
| `ffa.members` | `list`, `update`, `remove`, `listInvitations`, `invite`, `revokeInvitation` |

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

Price card launch-v1 is effective from 2026-10-28. $0.039 per page sent, $0.019 per page received.
$2 per number per month, $19 per month for the Agent workspace. Sandbox pages cost 0.
`ffa.platform.capabilities()` returns the card in force.

## Working on this repository

```bash
npm ci
npm test                                        # vitest with msw, no network
FAXFORAGENTS_API_KEY=ffa_test_... npm run test:live    # one real sandbox send
npm run gen:types                               # src/schema.d.ts from spec/openapi.yaml
npm run typecheck && npm run build
sh scripts/truthcheck.sh
```

`spec/openapi.yaml` is a copy of the public document. To take a new one, copy it over and run
`npm run gen:types`. `npm install` from a git URL builds the package on install (the `prepare` script),
so `npm install github:faxforagents/sdk-typescript` works before the package is on npm.

## Licence

MIT. See [LICENSE](LICENSE). Security reports go to hello@faxforagents.com, see [SECURITY.md](SECURITY.md).
