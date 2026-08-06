import { z } from 'zod';
import type { DealsService } from '../../../services/deals.service.js';
import {
  dealOutputSchema,
  getDealInputSchema,
  type GetDealInput,
} from '../../../schemas/deal.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const getDealOutputSchema = dealOutputSchema.extend({
  associations: z
    .record(z.string(), z.array(z.string()))
    .describe('Associated record IDs keyed by object type, when requested.'),
});

interface GetDealResult {
  readonly id: string;
  readonly properties: Record<string, string | null>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archived: boolean;
  readonly associations: Record<string, string[]>;
}

/**
 * `hubspot_get_deal` — reads one deal by record ID.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "includeAssociations": ["contacts", "companies"] }
 * ```
 */
export class GetDealTool implements ToolDefinition<typeof getDealInputSchema, GetDealResult> {
  readonly name = 'hubspot_get_deal';
  readonly title = 'Get HubSpot Deal by ID';
  readonly description =
    'Retrieve a single HubSpot deal by its numeric record ID. Optionally request specific ' +
    'properties and the IDs of associated contacts, companies, tickets, or activities. Set ' +
    'archived to true to read a deal that has been deleted (readable for 90 days after archiving).';

  readonly inputSchema = getDealInputSchema;
  readonly outputSchema = getDealOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Deal by ID',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: GetDealInput, context: ToolExecutionContext): Promise<GetDealResult> {
    context.logger.debug(
      { dealId: input.dealId, archived: input.archived },
      'Reading HubSpot deal.'
    );

    return this.deals.getById({
      dealId: input.dealId,
      properties: input.properties,
      associations: input.includeAssociations,
      archived: input.archived,
    });
  }
}
