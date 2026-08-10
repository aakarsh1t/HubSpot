import { toRecordView, type RecordView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import {
  createRecordInputSchema,
  recordOutputSchema,
  type CreateRecordInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_create_record` — creates a contact, company, or deal.
 *
 * Associations supplied here are applied in the same HubSpot request that
 * creates the record. Doing it in two calls would leave an orphaned record
 * behind whenever the second call failed, which is the usual way a "create the
 * deal and link it to the company" instruction ends up half-done.
 *
 * @example
 * ```json
 * {
 *   "objectType": "deals",
 *   "properties": { "dealname": "Acme - Enterprise", "amount": 50000, "pipeline": "default" },
 *   "associations": [{ "toObjectType": "companies", "toObjectId": "7801" }]
 * }
 * ```
 */
export class CreateRecordTool implements ToolDefinition<
  typeof createRecordInputSchema,
  RecordView
> {
  readonly name = 'hubspot_create_record';
  readonly title = 'Create HubSpot Record';
  readonly description =
    'Create a HubSpot contact, company, or deal from a flat property bag using internal ' +
    '(lowercase) property names. Optionally associate the new record with existing records in ' +
    'the same request. Creating is not idempotent — check with hubspot_search_records first if a ' +
    'duplicate is possible. To add many records at once use hubspot_batch_records.';

  readonly inputSchema = createRecordInputSchema;
  readonly outputSchema = recordOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Record',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: CreateRecordInput, context: ToolExecutionContext): Promise<RecordView> {
    const associations =
      input.associations === undefined
        ? undefined
        : this.crm.toCreateAssociations(input.objectType, input.associations);

    const record = await this.crm.forType(input.objectType).create(input.properties, associations);

    context.logger.info(
      { objectType: input.objectType, recordId: record.id },
      'Created HubSpot record.'
    );

    return toRecordView(record, { includeEmptyProperties: input.includeEmptyProperties });
  }
}
