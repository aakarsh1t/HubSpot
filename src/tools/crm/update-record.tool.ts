import { toRecordView, type RecordView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import {
  recordOutputSchema,
  updateRecordInputSchema,
  type UpdateRecordInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_update_record` — patches properties on an existing record.
 *
 * Also the home of what used to be `hubspot_move_deal_stage`,
 * `hubspot_change_deal_pipeline`, and `hubspot_set_deal_forecast_category`.
 * Each of those was a single-property PATCH wearing a tool's clothes, and each
 * cost the orchestrator a catalogue entry to read on every turn. The one thing
 * they added — forcing `pipeline` and `dealstage` to be set together so a deal
 * cannot end up in a pipeline its stage does not belong to — survives as
 * guidance in the description, which is where an agent actually reads it.
 *
 * @example Move a deal to a new stage
 * ```json
 * { "objectType": "deals", "recordId": "9001", "properties": { "dealstage": "contractsent" } }
 * ```
 */
export class UpdateRecordTool implements ToolDefinition<
  typeof updateRecordInputSchema,
  RecordView
> {
  readonly name = 'hubspot_update_record';
  readonly title = 'Update HubSpot Record';
  readonly description =
    'Update properties on an existing HubSpot contact, company, or deal. PATCH semantics: only ' +
    'the properties you supply change, and passing null clears one. This is also how you move a ' +
    'deal — set dealstage, and set pipeline alongside it when moving to a stage in a DIFFERENT ' +
    'pipeline, or the deal is left with a stage its pipeline does not contain. Call ' +
    'hubspot_list_pipelines first to get valid stage IDs.';

  readonly inputSchema = updateRecordInputSchema;
  readonly outputSchema = recordOutputSchema;

  readonly annotations = {
    title: 'Update HubSpot Record',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: UpdateRecordInput, context: ToolExecutionContext): Promise<RecordView> {
    const record = await this.crm
      .forType(input.objectType)
      .update(input.recordId, input.properties);

    context.logger.info(
      { objectType: input.objectType, recordId: input.recordId },
      'Updated HubSpot record.'
    );

    return toRecordView(record, { includeEmptyProperties: input.includeEmptyProperties });
  }
}
