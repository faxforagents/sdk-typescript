# Changelog

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
