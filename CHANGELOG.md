# Changelog

## 0.1.0 (2026-10-28)

First release.

- `FaxForAgents` client over `fetch`, every `/v1` operation of API version 0.1.0, ESM and CommonJS.
- Types generated from the public OpenAPI document with openapi-typescript (`npm run gen:types`).
- `Idempotency-Key` on every mutating call, retries for 429 and 5xx with `Retry-After`.
- `iter` helpers on every list, `faxes.wait` and `approvals.wait`.
- `verifyWebhook` for the Standard Webhooks signature, with rotation support, on Web Crypto.
