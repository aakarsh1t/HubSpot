import type { DealsService } from '../../../services/deals.service.js';
import {
  createDealInputSchema,
  dealOutputSchema,
  type CreateDealInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_create_deal` — creates a single deal.
 *
 * Not idempotent — non-retryable so a transient failure can never produce a
 * duplicate. To set the initial stage/pipeline reliably, call
 * `hubspot_list_deal_pipelines` first and pass valid IDs in `properties`, or
 * omit them to use the portal's default pipeline and first stage.
 *
 * @example Minimal
 * ```json
 * { "properties": { "dealname": "Acme Corp - Enterprise", "amount": 50000 } }
 * ```
 *
 * @example With associations
 * ```json
 * {
 *   "properties": { "dealname": "Acme Corp - Enterprise", "amount": 50000, "closedate": "2026-12-31" },
 *   "associations": [
 *     { "toObjectType": "contacts", "toObjectId": "512" },
 *     { "toObjectType": "companies", "toObjectId": "7801" }
 *   ]
 * }
 * ```
 */
export class CreateDealTool implements ToolDefinition<typeof createDealInputSchema, CrmObject> {
  readonly name = 'hubspot_create_deal';
  readonly title = 'Create HubSpot Deal';
  readonly description =
    'Create a new deal in HubSpot. Supply deal fields as a properties object using HubSpot ' +
    'internal property names (dealname, amount, closedate, dealtype, and any custom ' +
    'properties). Optionally associate the new deal with existing contacts, companies, or ' +
    'tickets. To set a specific stage or pipeline reliably, use hubspot_move_deal_stage or ' +
    'hubspot_change_deal_pipeline after creation rather than setting dealstage/pipeline ' +
    'directly here. Returns the created deal including its new ID.';

  readonly inputSchema = createDealInputSchema;
  readonly outputSchema = dealOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Deal',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: CreateDealInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug(
      { propertyCount: Object.keys(input.properties).length },
      'Creating HubSpot deal.'
    );

    return this.deals.create(input);
  }
}
