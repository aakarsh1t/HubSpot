import type { PropertiesService } from '../../../services/properties.service.js';
import {
  getPropertyHistoryInputSchema,
  propertyHistoryOutputSchema,
  type GetPropertyHistoryInput,
} from '../../../schemas/property.schema.js';
import type { PropertyHistoryResult } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_get_property_history` — the historical value trail of properties
 * on a record.
 *
 * Distinct from `hubspot_get_*_timeline`: the timeline tools show
 * *engagements* (notes, calls, meetings); this shows every value a
 * *property* has held over time, with when it changed and what changed it
 * (a user, an integration, a workflow). This is what answers "when did this
 * deal move to Closed Won?" or "who changed this contact's lifecycle stage
 * and when?" — questions the timeline tools cannot answer, since a property
 * change made outside of logging an engagement leaves no timeline entry.
 *
 * @example
 * ```json
 * { "objectType": "deals", "recordId": "9001234567", "propertyNames": ["dealstage", "amount"] }
 * ```
 */
export class GetPropertyHistoryTool implements ToolDefinition<
  typeof getPropertyHistoryInputSchema,
  PropertyHistoryResult
> {
  readonly name = 'hubspot_get_property_history';
  readonly title = 'Get HubSpot Property History';
  readonly description =
    'Retrieve the full history of values a property has held on a specific record — every ' +
    'value, when it took effect, and what changed it (a user ID, an integration, or a ' +
    'workflow). Use this to answer "when did X change?" or "who changed X?" questions that the ' +
    'activity timeline tools cannot, since not every property change is logged as an engagement. ' +
    'Results are sorted newest first.';

  readonly inputSchema = getPropertyHistoryInputSchema;
  readonly outputSchema = propertyHistoryOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Property History',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly properties: PropertiesService;

  constructor(properties: PropertiesService) {
    this.properties = properties;
  }

  async execute(
    input: GetPropertyHistoryInput,
    context: ToolExecutionContext
  ): Promise<PropertyHistoryResult> {
    context.logger.debug(
      { objectType: input.objectType, recordId: input.recordId, properties: input.propertyNames },
      'Reading HubSpot property history.'
    );

    return this.properties.getHistory(input.objectType, input.recordId, input.propertyNames);
  }
}
