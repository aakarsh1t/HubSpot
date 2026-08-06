import { z } from 'zod';
import type { DealsService } from '../../../services/deals.service.js';
import { restoreDealInputSchema, type RestoreDealInput } from '../../../schemas/deal.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const restoreOutputSchema = z.object({
  success: z.boolean(),
  restoredAsNewRecord: z.boolean(),
  originalDealId: z.string(),
  newDealId: z.string(),
  propertiesCopied: z.number(),
  notRestored: z.array(z.string()),
  message: z.string(),
});

interface RestoreResult {
  readonly success: boolean;
  readonly restoredAsNewRecord: boolean;
  readonly originalDealId: string;
  readonly newDealId: string;
  readonly propertiesCopied: number;
  readonly notRestored: string[];
  readonly message: string;
}

/**
 * `hubspot_restore_deal` — recreates an archived deal as a new record.
 *
 * Same platform constraint as `hubspot_restore_contact`: no un-archive API
 * exists for any HubSpot object type.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "confirmRecreate": true }
 * ```
 */
export class RestoreDealTool implements ToolDefinition<
  typeof restoreDealInputSchema,
  RestoreResult
> {
  readonly name = 'hubspot_restore_deal';
  readonly title = 'Restore Archived HubSpot Deal';
  readonly description =
    'Recover an archived (deleted) HubSpot deal. IMPORTANT: HubSpot provides no API to ' +
    'un-archive a record in place, so this reads the archived deal and recreates it as a NEW ' +
    'deal with a NEW record ID. Property values are copied; associations, notes, tasks, calls, ' +
    'meetings, emails, and timeline history are NOT recovered. Only works within 90 days of ' +
    'archiving. Requires confirmRecreate to be exactly true.';

  readonly inputSchema = restoreDealInputSchema;
  readonly outputSchema = restoreOutputSchema;

  readonly annotations = {
    title: 'Restore Archived HubSpot Deal',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: RestoreDealInput, context: ToolExecutionContext): Promise<RestoreResult> {
    context.logger.warn(
      { archivedDealId: input.dealId },
      'Recreating archived deal as a new record.'
    );

    const { created, sourceProperties } = await this.deals.recreateFromArchive({
      dealId: input.dealId,
      properties: input.properties,
    });

    return {
      success: true,
      restoredAsNewRecord: true,
      originalDealId: input.dealId,
      newDealId: created.id,
      propertiesCopied: Object.keys(created.properties).filter(
        (key) => created.properties[key] !== null
      ).length,
      notRestored: [
        'The original record ID (the new deal has a different ID)',
        'Associations to contacts, companies, and tickets',
        'Notes, tasks, calls, meetings, and logged emails',
        'Timeline and activity history',
      ],
      message:
        `Archived deal ${input.dealId} was recreated as NEW deal ${created.id} with ` +
        `${Object.keys(sourceProperties).length} source properties read. HubSpot has no ` +
        'un-archive API, so this is a new record.',
    };
  }
}
