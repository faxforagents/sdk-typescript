# Changelog

## 0.4.1 (2026-11-12)

Follows API 1.17.0. The saved spec has 145 operations and the types are regenerated from it.

`oneTimeSends.createFromQuote` no longer requires `accept_aup`. `approval_id` still carries the approval of a card order.
`oneTimeSends.checkout` takes `acceptAup`. An order whose `aup_accepted` is false needs `acceptAup: true` once, with `orderToken`. The payer accepts the terms on the order page, never a key.
New call `oneTimeSends.readByToken(token)`: the read of a mailed confirmation link, with the token in the body. `getByToken` still works and is marked `@deprecated`.

`OneTimeOrder` and `OneTimeOrderCreated` carry `aup_accepted`, `status_url` and `queue`. `OneTimeConfig` carries `queue`.
New type `OneTimeQueue` with `queued`, `jobs_ahead` and `estimated_wait_minutes`.
`Balance` carries `top_up_url`. `Capabilities` carries `extraction_pricing`.

`PaymentRequiredError.topUpUrl` reads `details.top_up_url`, the page where a person adds funds.
`PaymentRequiredError.oneTimeOffer` is typed as `OneTimeOffer`, exported by the package. 0.4.0 declared `Record<string, unknown>`.

Removed from the saved spec and from `schema.d.ts`: every path the public document does not list.
That is 61 paths: 35 under `/v1/admin`, the dashboard sign-in under `/v1/auth`, the OAuth consent screen and the provider webhook receivers.
The 70 schemas only those paths used are gone too, `AbuseReview`, `Passkey` and `SessionInfo` among them.
No client method called them. Code that imported one of those types has to declare it itself.
The saved spec now holds the 115 paths and 152 schemas of the public document, plus the response fields marked `x-sdk-route`.
Other type names, fields and optionality are kept.

## 0.4.0 (2026-11-12)

New resource `oneTimeSends`: one fax paid by card, with no wallet.
Its calls are `config`, `create`, `createFromQuote`, `list`, `iter`, `get`, `wait`, `checkout`, `getByToken`, `confirm`, `resendConfirmation` and `getReceiptPdf`.
`create` sends a file as multipart or text as JSON. `wait` polls until the order's `next` is `done`, or the step passed as `until`.
`get`, `wait`, `checkout`, `resendConfirmation` and `getReceiptPdf` take `orderToken`, sent as `X-FFA-Order-Token`. The header name is exported as `ORDER_TOKEN_HEADER`.
`new FaxForAgents({ keyless: true })` builds a client with no API key. It sends no `Authorization` header and can call `oneTimeSends` only.

The saved spec follows the public document at API 1.16.1, 144 public operations. Types are regenerated from it.
New types: `OneTimeOrder`, `OneTimeOrderCreated`, `OneTimeOrderPage`, `OneTimeFromQuote`, `OneTimeCheckout`, `OneTimeConfirm`, `OneTimeConfirmSummary`, `OneTimeConfirmed`, `OneTimeCard`, `OneTimePrice`, `OneTimeJob` and `InsufficientBalance`. The client exports `OneTimeCreate` and `OneTimeNext`.
Changed: `FaxJob.one_time` is `OneTimeJob | null`, where 0.3.1 declared `Record<string, unknown> | null`. `Receipt` carries `one_time` too.
Other type names, fields and optionality are kept. Fields with a server default stay optional.

`PaymentRequiredError.oneTimeOffer` reads `details.one_time_offer` when a server sends it, and is `null` otherwise. API 1.16.1 does not send it.
The README names price card launch-v2, effective 2026-10-31.

## 0.3.1 (2026-11-10)

`faxes.list` takes `idempotency_key`, a filter that finds the send made with that key.
`policies.effective` takes `key_id`, `agent_id` or `connection_id` to ask about another principal. A connection id comes from `oauth.listGrants`.

## 0.3.0 (2026-11-10)

The saved spec follows the public document at API 1.12.0, 134 public operations. Types are regenerated from it.
New calls: `faxes.getReceiptPdf`, `numbers.listOrders`, `policies.getAutoSend`, `policies.setAutoSend` and `organizations.downloadExportArchive`.
New resource `oauth` for connected apps: `listGrants`, `iterGrants` and `revokeGrant`.
New types `AutoSendSetting`, `AutoSendUpdate` and `NumberOrderList`. `ApiKey` carries `connected_app`, `Policy` carries `managed` and `EffectivePolicies` carries `requires_human_approval`.
Existing type names, fields and optionality are kept. Fields with a server default stay optional.

## 0.2.7 (2026-11-09)

`QuoteCreate.sender_name` (the station name in the fax header) and `QuoteCreate.delete_after_send`. `Quote` and `FaxJob` carry both. Needs API 1.12.0.

## 0.2.6 (2026-11-09)

`QuoteCreate.quality`: standard, fine (the default), superfine or ultra. `Quote` and `FaxJob` carry `quality`. Needs API 1.11.0; older servers refuse the field.

## 0.2.5 (2026-11-02)

Add `Grant`, `GrantList` and `ReviewSignIn` for connected apps and reviewer sign-in.
Also declare `Client`, `ClientList`, `ReviewAccessAction`, `ReviewAccessCreate` and `ReviewAccessIssued`.
Generate declarations for all API 1.6.0 routes, including connected app listing and revocation.
Retain existing model names, fields, optionality and operation names.

## 0.2.4 (2026-11-02)

Regenerate models from API version 1.5.2, including the boolean `Capabilities.extraction` field.
Include all live schemas and retain existing model names, fields and optionality.
Add a test that checks every saved schema property against the generated declarations.

## 0.2.3 (2026-11-02)

Declare response fields from API version 1.5.0 and the server serializers.
Add billing iterators for ledger entries, top-up sessions and invoices.
Document the required JSON object for upload completion.

## 0.2.2 (2026-10-30)

First version on the npm registry. The README opens with the Fax for Agents logo, a link row to the
website, quickstart, API reference, SDK docs, MCP page, dashboard, pricing and changelog, and badges
for the npm version, CI, licence, Node and TypeScript. No client code changed.

## 0.2.1 (2026-10-29)

API version 1.2.3. The generated types document `503 live_provider_unavailable` on the eight operations
that reach the carrier with a live key (`createFaxQuote`, `createFax`, `cancelFax`, `getNumberInventory`,
`createNumberOrder`, `createReleaseRequest`, `createPortabilityCheck`, `createPortOrder`). A production
server with no carrier configured refuses them before any hold or approval is consumed, with `retryable`
false. No client code changed.

## 0.2.0 (2026-10-28)

API version 1.1.0: HTML rendering and image uploads.

- `documents.create({ html })` renders HTML on the server, scripts off and no network.
- `documents.upload` takes a PNG, JPG or TIFF beside a PDF and reads the content type from the
  filename (`guessContentType`, `CONTENT_TYPES`). `createUpload` documents the four content types.
- New resources, every operation of the document: `numbers` (coverage, inventory, orders, porting,
  sender verification), `extractions` (OCR, fields, classification, summaries, saved schemas),
  `organizations` and `members`. The inbox gains `update`, `delete`, `getDownload` and `download`.
- `sandbox.createInboundFax` returns `InboxItemSummary`. `InboxItem` carries the number, project,
  media status and read state of a received fax. `Quote` carries `per_page_micro` and `route_label`.
- A `prepare` script builds the package on a git install.

## 0.1.0 (2026-10-28)

First release.

- `FaxForAgents` client over `fetch`, every `/v1` operation of API version 0.1.0, ESM and CommonJS.
- Types generated from the public OpenAPI document with openapi-typescript (`npm run gen:types`).
- `Idempotency-Key` on every mutating call, retries for 429 and 5xx with `Retry-After`.
- `iter` helpers on every list, `faxes.wait` and `approvals.wait`.
- `verifyWebhook` for the Standard Webhooks signature, with rotation support, on Web Crypto.
