/** Track client methods and operations exposed only through generated route declarations. */
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
  get_fax_receipt_pdf: 'faxes.getReceiptPdf',
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
  get_auto_send: 'policies.getAutoSend',
  put_auto_send: 'policies.setAutoSend',
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
  update_inbox_item: 'inbox.update',
  delete_inbox_item: 'inbox.delete',
  get_inbox_download: 'inbox.getDownload',
  get_inbox_content: 'inbox.download',
  get_coverage: 'numbers.coverage',
  get_number_inventory: 'numbers.inventory',
  create_number_order: 'numbers.createOrder',
  list_number_orders: 'numbers.listOrders',
  get_number_order: 'numbers.getOrder',
  list_numbers: 'numbers.list',
  get_number: 'numbers.get',
  update_number: 'numbers.update',
  create_release_request: 'numbers.release',
  create_portability_check: 'numbers.checkPortability',
  list_port_orders: 'numbers.listPortOrders',
  create_port_order: 'numbers.createPortOrder',
  get_port_order: 'numbers.getPortOrder',
  create_port_out_request: 'numbers.createPortOutRequest',
  create_sender_verification: 'numbers.verifySender',
  create_extraction: 'extractions.create',
  list_extractions: 'extractions.list',
  get_extraction: 'extractions.get',
  create_correction: 'extractions.correct',
  create_classification: 'extractions.classify',
  list_classifications: 'extractions.listClassifications',
  get_classification: 'extractions.getClassification',
  create_document_summary: 'extractions.summarize',
  list_document_summaries: 'extractions.listSummaries',
  get_document_summary: 'extractions.getSummary',
  list_extraction_schemas: 'extractions.listSchemas',
  create_extraction_schema: 'extractions.createSchema',
  get_extraction_schema: 'extractions.getSchema',
  list_organizations: 'organizations.list',
  get_current_organization: 'organizations.current',
  update_current_organization: 'organizations.updateCurrent',
  request_data_export: 'organizations.requestDataExport',
  request_data_deletion: 'organizations.requestDataDeletion',
  download_export_archive: 'organizations.downloadExportArchive',
  list_members: 'members.list',
  update_member: 'members.update',
  remove_member: 'members.remove',
  list_invitations: 'members.listInvitations',
  create_invitation: 'members.invite',
  revoke_invitation: 'members.revokeInvitation',
  list_oauth_grants: 'oauth.listGrants',
  revoke_oauth_grant: 'oauth.revokeGrant',
  get_one_time_config: 'oneTimeSends.config',
  create_one_time_order: 'oneTimeSends.create',
  create_one_time_order_from_quote: 'oneTimeSends.createFromQuote',
  list_one_time_orders: 'oneTimeSends.list',
  get_one_time_order: 'oneTimeSends.get',
  get_one_time_order_by_token: 'oneTimeSends.getByToken',
  read_one_time_order_by_token: 'oneTimeSends.readByToken',
  create_one_time_checkout: 'oneTimeSends.checkout',
  confirm_one_time_order: 'oneTimeSends.confirm',
  resend_one_time_confirmation: 'oneTimeSends.resendConfirmation',
  get_one_time_receipt_pdf: 'oneTimeSends.getReceiptPdf',
};

// These routes have generated declarations. The client currently has no methods for them.
/** Every operation of the saved spec has a client method. Nothing is declared by the generated types alone. */
const GENERATED_ONLY: string[] = [];

it('accounts for every operationId and retains every existing client method', () => {
  const yaml = readFileSync('spec/openapi.yaml', 'utf8');
  const ids = new Set([...yaml.matchAll(/^\s+operationId: (\w+)$/gm)].map((m) => m[1]!));
  expect(Object.keys(COVERED)).toHaveLength(145);
  expect(GENERATED_ONLY).toHaveLength(0);
  expect(ids.size).toBe(145);
  expect([...ids].sort()).toEqual([...Object.keys(COVERED), ...GENERATED_ONLY].sort());
  const c = new FaxForAgents({ apiKey: 'ffa_test_x' }) as unknown as Record<string, Record<string, unknown>>;
  for (const target of Object.values(COVERED)) {
    const [res, method] = target.split('.') as [string, string];
    expect(typeof c[res]?.[method], target).toBe('function');
  }
});

it('saves only the paths of the public document', () => {
  const yaml = readFileSync('spec/openapi.yaml', 'utf8');
  const paths = [...yaml.matchAll(/^  (\/[^\s:]+):$/gm)].map((m) => m[1]!);
  expect(paths).toHaveLength(115);
  const internal = paths.filter(
    (p) =>
      !p.startsWith('/v1/') ||
      /^\/v1\/(admin|affiliate|auth)(\/|$)/.test(p) ||
      p.startsWith('/v1/oauth/authorizations') ||
      p.startsWith('/webhooks'),
  );
  expect(internal).toEqual([]);
  const types = readFileSync('src/schema.d.ts', 'utf8');
  expect(types).not.toMatch(/"\/v1\/(admin|affiliate|auth)\//);
  expect(types).not.toMatch(/"\/webhooks\//);
});
