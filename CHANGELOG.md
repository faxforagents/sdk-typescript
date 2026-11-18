# Changelog

## Unreleased

- The client drops the trailing slashes of `baseUrl` with a scan instead of the regex `/\/+$/`. The regex took quadratic
  time when a long run of slashes did not end the URL: 16 s for 100,000 slashes. Nothing else changes. CodeQL reported it as js/polynomial-redos.

## 0.11.2 (2026-11-17)

Follows API 1.21.3. The saved spec has 165 operations in 132 paths, as in 0.11.1, and the types are regenerated from it.
No method, argument or field changed. The version is the same as that of the Python client.

- The generated doc comment of `Subscription.ends_at` says it is null whenever `entitled` is false, as after the plan ended.
  The server sent that at 1.21.2 already.

## 0.11.1 (2026-11-17)

Follows API 1.21.2. The saved spec has 165 operations in 132 paths, as in 0.11.0, and the types are regenerated from it.
No method or argument changed, and nothing is removed. The version is the same as that of the Python client.

New fields, optional as other new response fields are:

- `Subscription.cancel_at` is when Stripe is set to end the subscription. A cancel in the billing portal sets it and leaves `cancel_at_period_end` false.
- `Subscription.ends_at` is when the plan ends without another charge. It is null while the plan renews, and once the plan has ended.
- The public document requires both. The saved spec leaves them out of `required`, so a subscription from an older server still fits.

`OneTimeConfirmSummary['state']` gains `'link_canceled'`, the confirm link of an order that was canceled.
`oneTimeSends.confirm` on that link throws `ConflictError` with the code `link_canceled`, and its doc comment says so.

`ConflictError.reason` reads `details.reason`, or null when the API sent none.
A second `billing.createSubscriptionCheckout` throws `ConflictError` with the reason `plan_active` while the plan is active.
The reason is `checkout_open` while a payment page of the plan is still open, and `details.url` is that page.

The generated comment of `OneTimeOrder` follows the public document, which splits it into shorter sentences.

## 0.11.0 (2026-11-16)

Follows API 1.21.0. The saved spec has 165 operations in 132 paths and the types are regenerated from it.
Every operation has a client method. Nothing is removed.
The version is the same as that of the Python client. There is no 0.10.0 of this package.

New methods: `organizations.faxHistoryCsv` and `organizations.auditCsv`, the records export of the Agent workspace plan.
Each returns CSV text for a range of UTC days, `{ from, to }`, both included, as `billing.statementCsv` does.
The fax history needs `fax:read` and `inbox:read`. The audit trail needs `org:admin` and refuses an agent's key.
Without the plan, or more than 30 days after it ended, both throw `ScopeError` with the code `workspace_required`.

New parameters: `faxes.list` and `faxes.iter` take `created_after` and `created_before`, ISO 8601 times.
The start is included and the end is left out. A start after the end throws `InvalidRequestError`.
Left out, no query parameter is sent, so the request is the same as in 0.9.1.

New fields, all optional as other new response fields are:

- `Quote.live_amount_micro` is what the same fax costs with a live key. A test quote is free, so this is its live price.
  It is null when the rate card changed since the quote.
- `SubscriptionList.plan` is the new type `WorkspacePlan`: the request limits, the included number, the keep times and whether the export is open.
  The public document requires it. The saved spec leaves it out of `required`.
- `Number.included_with_workspace` is true for the number whose monthly charge the Agent workspace pays.
- `OneTimeOrder.refund_pending_micro` and `OneTimeOrderCreated.refund_pending_micro` hold a refund the payment provider has not confirmed yet.
  The server gives these two fields and `included_with_workspace` a default. The saved spec leaves it out, so the fields stay optional.

One-time orders have three new statuses, set by a person at Fax for Agents: `refunding`, `refunded` and `canceled`.
`refunded` and `canceled` read `next` `done`, so `oneTimeSends.wait` returns on them. `refunding` reads `next` `wait`.

Descriptions say test where they said sandbox. `Capabilities.limits` names the request limit, 3000 a minute with the plan and 600 without.

## 0.9.1 (2026-11-16)

Follows API 1.20.11. The saved spec has 163 operations and the types are regenerated from it.
Only descriptions changed. Nothing is added or removed.

The doc comment of `TopupSession.checkout_status` says it is also null for a top-up that is not open.
Stripe is asked about an open top-up only, as the doc comment of `billing.getTopupSession` already said.
The 409 of `replay_webhook_delivery` has a description of its own, which names `details.reason` `webhook_deleted`.
Its type has the same shape as before, the error envelope.
`webhooks.replayDelivery` already throws `ConflictError` with `details.reason` `webhook_deleted` there, as 0.9.0 documented.

## 0.9.0 (2026-11-15)

Follows API 1.20.10. The saved spec has 163 operations and the types are regenerated from it.
Every operation has a client method.

New parameter: `billing.getTopupSession(topupSessionId, { check_checkout: true })` asks Stripe about the hosted Checkout of an open top-up.
The new field `TopupSession.checkout_status` reads `'open' | 'complete' | 'processing' | 'expired'`, and null when not asked.
`complete` means the person paid, and the wallet is credited when Stripe's event arrives. `processing` is a payment that confirms later, such as a bank debit.
Left out or false, no query parameter is sent, and the request is the same as in 0.8.0.

New field: `Delivery.webhook_deleted`, which only `DeliveryDetail` had. The API sends it on every delivery.
It is optional on `Delivery`, as other new response fields are.
`webhooks.replayDelivery` on a delivery whose webhook was deleted throws `ConflictError` with `details.reason` set to `webhook_deleted`.
Deleting a webhook ends the deliveries that were waiting for it. They read `failed`, with no next attempt.

`OneTimeCoverCheck` describes the limits of `create`: `to_name` 120 characters, `subject` 200 and `message` 2,000.
`oneTimeSends.checkCover` says a longer field throws `InvalidRequestError`, as `create` does.
`billing.cancelTopupSession` says `details.reason` is `paid` when the payment came in before the cancel.
New descriptions on the counters of `PolicyUsage` and on `policy_name` and `version` of `PolicyVerdict` and `PolicyEvaluation`.

Nothing is removed. Other type names, fields and optionality are kept.

## 0.8.0 (2026-11-15)

Follows API 1.20.9. The saved spec has 163 operations and the types are regenerated from it.
Every operation has a client method.

New: `billing.cancelTopupSession(topupSessionId)` closes the hosted Checkout of an open top-up and returns it with status `canceled`.
Canceling a setup payment also turns off the auto top-up that waited on it. Scope `billing:write`, never an agent key.
A top-up that was paid, declined or charged off session throws `ConflictError`, with its status in `details.status`.
New: `oneTimeSends.checkCover(body)` takes the cover fields typed so far and says whether the message fits on the cover page. It needs no key.
It returns the new type `OneTimeCoverRoom` with `fits`, `message_chars`, `lines_left` and `fits_chars`. Nothing is stored.

New parameter: `billing.statement`, `billing.iterStatement` and `billing.statementCsv` take `type`, the type each line shows.
`kind` still works. It is the same filter by its older name, and two different types in both throw `InvalidRequestError`.

Changed: five fields that the saved spec declared itself now follow the public document.
`Quote.policy_evaluation` is a `PolicyVerdict` and `PolicyEvaluation.usage` a `PolicyUsage`. Both were plain records, and both still take other keys.
`Quote.pricing` is `'per_page' | 'one_time'`, where it was a string. `PolicyEvaluation.decision` is `'allow' | 'deny'`.
`FaxJob.approval_id` and `FaxJob.policy_version_id` keep their type. `FaxJob.route_paused` is new.
The server gives `route_paused` and `pricing` a default. The saved spec leaves it out, so both stay optional.

`identity.rotateApiKey` on a key that expired throws `ConflictError` with `details.reason` set to `key_expired`. Create a new key to replace it.
`PaymentReceipt.pdf_url` is null for an automatic top-up, which has no invoice. Its `url` still opens the receipt.
A statement line of a hold or a release names what it was for in `ref_type`: `fax_job`, `extraction` or `number_order`.
The card of a one-time order is held, not authorized, in the doc comments and the type descriptions.
`oneTimeSends.checkout` states the payment rule of API 1.20.9. A failed fax costs nothing, and a fax that stops part way costs the price of the pages the carrier confirms.
New types `OneTimeCoverCheck`, `OneTimeCoverRoom`, `PolicyVerdict` and `PolicyUsage`. Other type names, fields and optionality are kept.

## 0.7.0 (2026-11-15)

Follows API 1.20.6. The saved spec has 161 operations and the types are regenerated from it.
Every operation has a client method.

New: `billing.statement({ kind, from, to })` reads the wallet statement, one line per event with the balance after it.
`billing.iterStatement` follows `next_cursor`, and `billing.statementCsv` returns the same lines as CSV text. Scope `billing:read`.
New: `documents.rename(documentId, { filename })`. A name without `.pdf` gets it added. Scope `document:write`.
New: `webhooks.getDelivery(deliveryId)` returns `DeliveryDetail`, with the headers and the JSON body that were sent.
New: `billing.deleteBudget(budgetId)`. A budget that never charged a hold is deleted, and one with history is archived.
New: `agents.archive(agentId)` revokes the agent's keys and takes it out of the list. Its name is free again.
New: `numbers.dismissOrder(orderId)` puts a failed number order away. Any other order throws `ConflictError`.
New: `policies.checkRules(body)` names the numbers of a draft's `allowed_destinations` that a listed country or prefix already allows. It writes nothing.
New: `members.resendInvitation` mails an open invitation again. `members.linkInvitation` answers a new link once, for you to hand over. Both stop the old link.
New: `organizations.listDataRequests()` and `organizations.withdrawDataDeletion(requestId)`.
New: `oneTimeSends.preview({ file })` or `preview({ text })` counts the pages of a document before any order exists, with no key.
New: `oneTimeSends.getPage(orderId, pageNumber)` returns one page of an order as PNG bytes. Page 1 is the cover sheet.

New parameters: `faxes.list` and `faxes.iter` take `q`, a fax number or the start of a job id.
`documents.list` and `documents.iter` take `source`, `exclude_source` and `q`. `inbox.list` and `inbox.iter` take `archived`.
`agents.list` and `billing.listBudgets` take `include_archived`. `PolicyEvaluationCreate` has `key_id`, `agent_id` and `connection_id`.

Changed: the body of `approvals.reject` is optional. A help request closes without a reason. A send request still needs one, and the API answers 422 without it.
`approvals.list({ status: 'used' })` finds the approvals a send consumed. They read `approved`, and `consumed_by_job_id` names the fax.
Before API 1.20.6 such an approval read `expired` once its time had passed.

New fields, among them `DocumentPage.total`, `InboxPage.unread`, `Balance.held_jobs`, `Quote.route_paused` and `Document.converted_from`.
`Receipt` has `seller`, `provider_ref` and `sender_name`. `ApprovalRequest` has `document`, `requested_by_name` and `decided_by_name`.
18 new types, among them `StatementPage`, `StatementLine`, `PolicyRuleCheck`, `DeliveryDetail` and `OneTimeInspection`.
Eight of the new response fields have a server default: `held_jobs`, `unread`, `route_paused`, `owned`, `paused`, `actor_label` and `failing` twice. The saved spec leaves the default out, so they stay optional.

The API now refuses an organization name over 80 characters with 422. It took 200 before.
Nothing is removed. Other type names, fields and optionality are kept.

## 0.6.1 (2026-11-15)

Follows API 1.20.5. The saved spec has 147 operations and the types are regenerated from it.

New: `billing.getInvoiceReceipt(invoiceId)` and `billing.getTopupReceipt(topupSessionId)`.
Each returns the new type `PaymentReceipt`. `url` is the hosted receipt and `pdf_url` the same receipt as a PDF.
Both need the scope `billing:read`. A payment that was not made throws `ConflictError`.

Changed: `UploadCreate.content_type` is optional and `string | null`. It was a required string.
`documents.createUpload({ filename, size_bytes })` now compiles. The API reads the type from the filename, so `scan.png` opens as `image/png`.
A filename of an unsupported format, such as `letter.docx`, throws `InvalidRequestError` with the code `unsupported_format` on this call.
`documents.upload` names the type itself, as before.

New: `NotFoundError.field` is `details.field`. On `quotes.create` it is `document_id` or `from`, the id that was not found.
New: `ConflictError.state` is `details.state`. `faxes.getReceipt` on a fax that has not ended carries the fax state there.
Both are `null` when the server sent no such detail.

The response types of most operations name 410 with the new shared response `Gone`. Every operation with a body names 413.
`POST /v1/approval-requests` names 200 beside 201. A repeated request returns the open one.
The API now refuses an auto top-up threshold above 1000 USD and an agent `contact_email` that is not an address. Both throw `InvalidRequestError`.
Other type names, fields and optionality are kept.

## 0.6.0 (2026-11-13)

Follows API 1.20.0. The saved spec has 145 operations and the types are regenerated from it.
No client method was added or removed.

New: `Number.email_pdf`, an optional boolean. When true, the notice mail of a received fax carries the PDF.
`numbers.update(numberId, { email_pdf: true })` switches it on, with the scope `number:buy`. An agent key is refused.
`NumberUpdate.email_pdf` is `boolean | null` and optional. `false` switches the attachment off.

Breaking: `Extraction.provider_cost_micro` is removed. The server stopped sending it at API 1.19.0.
Breaking: `ExtractionPage.cost_micro` is removed, for the same reason.
Code that read either field no longer compiles and has to stop reading it.
`Extraction.price_micro` is the price the wallet paid, as before.
At run time 0.5.0 already read `undefined` there on API 1.19.0 and later. Its type promised a number.

The ledger no longer lists `provider_cost` entries. `billing.listLedger` and its types did not change.
Other type names, fields and optionality are kept.

## 0.5.0 (2026-11-12)

Follows API 1.18.0. The saved spec has 145 operations and the types are regenerated from it.
No client method, argument or return type changed. An API key is sent as before.

Breaking: the exported types `HttpValidationError` and `ValidationError` are removed, with `components['schemas']['HTTPValidationError']` and `['ValidationError']`.
The server never sent that shape. A 422 is the error envelope and the client throws `InvalidRequestError`, as it did in 0.4.1.
Code that imported either type has to delete the import. Nothing replaces them.

Changed: `ErrorEnvelope['error']` is the new type `ErrorBody`. `correlation_id` is `string | null` and optional, and `details` is `unknown`.
Thrown errors are the same classes with the same fields.

New types `ErrorBody` and one `Response...` type per shared error response, `ResponseUnauthorized` and `ResponseConflict` among them.
The operation types name more error statuses: 402, 409, 413 and 503 where the API answers them.
`oneTimeSends.create` can throw `RateLimitedError` with `details.cap` equal to `upload_queue`. Too many files are being read at once, so wait `retryAfter` seconds.

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
