/** Every operationId of spec/openapi.yaml is reachable through a resource (signed URLs through helpers). */
import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import { FaxForAgents } from '../src/index.js';

const COVERED: Record<string, string> = {
  get_me: 'identity.me',
  list_api_keys: 'identity.listApiKeys',
  create_api_key: 'identity.createApiKey',
  rotate_api_key: 'identity.rotateApiKey',
  revoke_api_key: 'identity.revokeApiKey',
  create_upload: 'documents.createUpload',
  put_upload_content: 'documents.putUploadContent',
  complete_upload: 'documents.completeUpload',
  cancel_upload: 'documents.cancelUpload',
  create_document: 'documents.create',
  list_documents: 'documents.list',
  get_document: 'documents.get',
  delete_document: 'documents.delete',
  get_document_validation: 'documents.getValidation',
  get_document_download: 'documents.getDownload',
  get_document_content: 'documents.download',
  list_document_pages: 'documents.listPages',
  get_document_page_content: 'documents.listPages',
  create_fax_quote: 'quotes.create',
  get_fax_quote: 'quotes.get',
  create_fax: 'faxes.create',
  list_faxes: 'faxes.list',
  get_fax: 'faxes.get',
  list_fax_events: 'faxes.listEvents',
  list_fax_attempts: 'faxes.listAttempts',
  get_fax_receipt: 'faxes.getReceipt',
  cancel_fax: 'faxes.cancel',
  list_webhooks: 'webhooks.list',
  create_webhook: 'webhooks.create',
  update_webhook: 'webhooks.update',
  delete_webhook: 'webhooks.delete',
  rotate_webhook_secret: 'webhooks.rotateSecret',
  test_webhook: 'webhooks.test',
  list_webhook_deliveries: 'webhooks.listDeliveries',
  replay_webhook_delivery: 'webhooks.replayDelivery',
  list_events: 'events.list',
  get_balance: 'billing.balance',
  list_ledger: 'billing.listLedger',
  get_billing_settings: 'billing.getSettings',
  patch_billing_settings: 'billing.patchSettings',
  create_topup_session: 'billing.createTopupSession',
  list_topup_sessions: 'billing.listTopupSessions',
  get_topup_session: 'billing.getTopupSession',
  list_auto_topups: 'billing.listAutoTopups',
  create_auto_topup: 'billing.createAutoTopup',
  delete_auto_topup: 'billing.deleteAutoTopup',
  list_budgets: 'billing.listBudgets',
  create_budget: 'billing.createBudget',
  patch_budget: 'billing.patchBudget',
  get_usage: 'billing.usage',
  create_usage_export: 'billing.createUsageExport',
  get_usage_export: 'billing.getUsageExport',
  get_usage_export_content: 'billing.getUsageExport',
  list_invoices: 'billing.listInvoices',
  get_invoice: 'billing.getInvoice',
  create_subscription_checkout: 'billing.createSubscriptionCheckout',
  list_subscriptions: 'billing.listSubscriptions',
  create_portal_session: 'billing.createPortalSession',
  get_capabilities: 'platform.capabilities',
  get_service_status: 'platform.serviceStatus',
  list_sandbox_scenarios: 'sandbox.listScenarios',
  create_sandbox_scenario: 'sandbox.createScenario',
  create_sandbox_inbound_fax: 'sandbox.createInboundFax',
  reset_sandbox_data: 'sandbox.reset',
  create_approval_request: 'approvals.request',
  list_approval_requests: 'approvals.list',
  get_approval_request: 'approvals.get',
  approve_request: 'approvals.approve',
  reject_request: 'approvals.reject',
  revoke_approval: 'approvals.revoke',
  list_policies: 'policies.list',
  create_policy: 'policies.create',
  get_effective_policies: 'policies.effective',
  get_policy: 'policies.get',
  update_policy: 'policies.update',
  list_policy_versions: 'policies.listVersions',
  create_policy_evaluation: 'policies.evaluate',
  list_agents: 'agents.list',
  create_agent: 'agents.create',
  get_agent: 'agents.get',
  update_agent: 'agents.update',
  create_agent_key: 'agents.createKey',
  get_agent_activity: 'agents.activity',
  list_inbox: 'inbox.list',
  get_inbox_item: 'inbox.get',
};

it('covers every operationId of the spec', () => {
  const yaml = readFileSync('spec/openapi.yaml', 'utf8');
  const ids = new Set([...yaml.matchAll(/^\s+operationId: (\w+)$/gm)].map((m) => m[1]!));
  expect(ids.size).toBe(85);
  expect([...ids].sort()).toEqual(Object.keys(COVERED).sort());
  const c = new FaxForAgents({ apiKey: 'ffa_test_x' }) as unknown as Record<string, Record<string, unknown>>;
  for (const target of Object.values(COVERED)) {
    const [res, method] = target.split('.') as [string, string];
    expect(typeof c[res]?.[method], target).toBe('function');
  }
});
