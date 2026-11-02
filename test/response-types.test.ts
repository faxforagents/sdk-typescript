/** Type assertions prevent response fields from falling back to the unknown index signature. */
import { expectTypeOf, it } from 'vitest';

import type { Capabilities, ExtractionPage, FaxJob, InboxItemSummary, PolicyEvaluation, Quote } from '../src/index.js';

it('declares the fax and quote fields with their wire types', () => {
  expectTypeOf<FaxJob['approval_id']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<FaxJob['policy_version_id']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<FaxJob['one_time_order_id']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<FaxJob['one_time']>().toEqualTypeOf<Record<string, unknown> | null | undefined>();
  expectTypeOf<Quote['pricing']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<Quote['policy_evaluation']>().toEqualTypeOf<Record<string, unknown> | null | undefined>();
  expectTypeOf<Capabilities['one_time']>().toEqualTypeOf<Record<string, unknown> | undefined>();
  expectTypeOf<PolicyEvaluation['usage']>().toEqualTypeOf<Record<string, number> | null | undefined>();
});

it('declares extraction accounting and inbox metadata', () => {
  expectTypeOf<ExtractionPage['fast_read']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<ExtractionPage['strong_read']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<ExtractionPage['words_count']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<ExtractionPage['cost_micro']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<InboxItemSummary['environment']>().toEqualTypeOf<'live' | 'test' | undefined>();
  expectTypeOf<InboxItemSummary['partial_content']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<InboxItemSummary['media_status']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<InboxItemSummary['provider']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<InboxItemSummary['duration_secs']>().toEqualTypeOf<number | null | undefined>();
  expectTypeOf<InboxItemSummary['number_id']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<InboxItemSummary['project_id']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<InboxItemSummary['read_at']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<InboxItemSummary['expires_at']>().toEqualTypeOf<string | null | undefined>();
});

import type * as S from "../src/schema.js";

type Declared<T> = { [K in keyof T as string extends K ? never : K]: T[K] };

it("declares every property in the saved serializer shapes", () => {
  const balance = ["available_micro", "currency", "environment", "held_micro"] satisfies Array<keyof Declared<S.Balance>>;
  expectTypeOf(balance).toExtend<Array<keyof Declared<S.Balance>>>();
  const capabilities = ["approvals", "environment", "formats", "limits", "max_pages", "max_upload_bytes", "numbers", "one_time", "price_version", "provider", "rates", "receive", "routes", "scopes", "send"] satisfies Array<keyof Declared<S.Capabilities>>;
  expectTypeOf(capabilities).toExtend<Array<keyof Declared<S.Capabilities>>>();
  const document = ["content_type", "created_at", "deleted_at", "environment", "expires_at", "filename", "id", "page_count", "render_reason", "render_status", "sha256", "size_bytes", "source", "status", "upload_id", "validation"] satisfies Array<keyof Declared<S.Document>>;
  expectTypeOf(document).toExtend<Array<keyof Declared<S.Document>>>();
  const extractionPage = ["confidence", "cost_micro", "escalated", "fast_read", "language", "model", "page", "status", "strong_read", "text", "warnings", "words_count"] satisfies Array<keyof Declared<S.ExtractionPage>>;
  expectTypeOf(extractionPage).toExtend<Array<keyof Declared<S.ExtractionPage>>>();
  const faxJob = ["amount_micro", "approval_id", "attempt_count", "billable_pages", "cancel_requested_at", "captured_micro", "client_reference", "completed_at", "cover_pages", "created_at", "currency", "direction", "document_id", "document_sha256", "environment", "evidence", "failure_code", "from", "id", "one_time", "one_time_order_id", "pages_sent", "policy_version_id", "provider", "provider_ref", "quote_id", "route", "state", "to", "transmitted_sha256", "updated_at"] satisfies Array<keyof Declared<S.FaxJob>>;
  expectTypeOf(faxJob).toExtend<Array<keyof Declared<S.FaxJob>>>();
  const inboxItem = ["amount_micro", "document_id", "duration_secs", "environment", "expires_at", "from", "id", "media_status", "note", "number_id", "pages", "partial_content", "project_id", "provider", "read_at", "received_at", "status", "to"] satisfies Array<keyof Declared<S.InboxItem>>;
  expectTypeOf(inboxItem).toExtend<Array<keyof Declared<S.InboxItem>>>();
  const inboxItemSummary = ["amount_micro", "document_id", "duration_secs", "environment", "expires_at", "from", "id", "media_status", "note", "number_id", "pages", "partial_content", "project_id", "provider", "read_at", "received_at", "status", "to"] satisfies Array<keyof Declared<S.InboxItemSummary>>;
  expectTypeOf(inboxItemSummary).toExtend<Array<keyof Declared<S.InboxItemSummary>>>();
  const invoice = ["amount_due_micro", "amount_paid_micro", "created_at", "currency", "hosted_invoice_url", "id", "invoice_pdf", "number", "status", "subscription_id"] satisfies Array<keyof Declared<S.Invoice>>;
  expectTypeOf(invoice).toExtend<Array<keyof Declared<S.Invoice>>>();
  const ledgerEntry = ["account", "amount_micro", "created_at", "id", "kind", "memo", "ref_id", "ref_type", "txn_id"] satisfies Array<keyof Declared<S.LedgerEntry>>;
  expectTypeOf(ledgerEntry).toExtend<Array<keyof Declared<S.LedgerEntry>>>();
  const number = ["activated_at", "country", "created_at", "currency", "e164", "environment", "id", "inbound_status", "inbound_webhook_id", "label", "locality", "monthly_micro", "number_type", "order_id", "project_id", "provider", "released_at", "renews_at", "status"] satisfies Array<keyof Declared<S.Number>>;
  expectTypeOf(number).toExtend<Array<keyof Declared<S.Number>>>();
  const policy = ["created_at", "created_by", "current_version_id", "enabled", "id", "name", "purpose", "rules", "updated_at", "version"] satisfies Array<keyof Declared<S.Policy>>;
  expectTypeOf(policy).toExtend<Array<keyof Declared<S.Policy>>>();
  const policyEvaluation = ["decision", "denials", "executed", "plan", "policy_id", "policy_name", "policy_version_id", "reason", "rule", "usage", "version"] satisfies Array<keyof Declared<S.PolicyEvaluation>>;
  expectTypeOf(policyEvaluation).toExtend<Array<keyof Declared<S.PolicyEvaluation>>>();
  const quote = ["amount_micro", "authorization_required", "billable_pages", "consumed_by_job_id", "cover", "cover_pages", "created_at", "currency", "document_id", "document_pages", "document_sha256", "environment", "expired", "expires_at", "from", "id", "policy_evaluation", "price_version", "pricing", "route", "to", "warnings"] satisfies Array<keyof Declared<S.Quote>>;
  expectTypeOf(quote).toExtend<Array<keyof Declared<S.Quote>>>();
  const topupSession = ["amount_micro", "auto_topup_id", "completed_at", "created_at", "currency", "environment", "error", "expires_at", "id", "kind", "status", "stripe_payment_intent_id", "stripe_session_id", "url"] satisfies Array<keyof Declared<S.TopupSession>>;
  expectTypeOf(topupSession).toExtend<Array<keyof Declared<S.TopupSession>>>();
  const uploadSession = ["completed_at", "content_type", "created_at", "declared_size", "expires_at", "filename", "id", "received_size", "sha256", "status"] satisfies Array<keyof Declared<S.UploadSession>>;
  expectTypeOf(uploadSession).toExtend<Array<keyof Declared<S.UploadSession>>>();
});
