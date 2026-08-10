import { toRecordView, type RecordView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import {
  getRecordInputSchema,
  recordOutputSchema,
  type GetRecordInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_get_record` — reads one contact, company, or deal.
 *
 * Replaces the former `hubspot_get_contact`, `hubspot_get_contact_by_email`,
 * `hubspot_get_company`, and `hubspot_get_deal`. The alternate-key lookup that
 * used to justify a separate email tool is just `idProperty` here, which is
 * what HubSpot's own API calls it — and it now works for any unique property on
 * any object type rather than only contacts+email.
 *
 * @example By ID
 * ```json
 * { "objectType": "contacts", "recordId": "51234567890" }
 * ```
 *
 * @example By email, with associations
 * ```json
 * {
 *   "objectType": "contacts",
 *   "recordId": "jane@acme.com",
 *   "idProperty": "email",
 *   "includeAssociations": ["companies", "deals"]
 * }
 * ```
 */
export class GetRecordTool implements ToolDefinition<typeof getRecordInputSchema, RecordView> {
  readonly name = 'hubspot_get_record';
  readonly title = 'Get HubSpot Record';
  readonly description =
    'Read a single HubSpot contact, company, or deal. Look it up by numeric record ID, or by a ' +
    'unique property such as email (set idProperty). Optionally request specific properties and ' +
    'the IDs of associated records. Set archived true to read a record deleted within the last ' +
    '90 days. To find records by criteria rather than identity, use hubspot_search_records.';

  readonly inputSchema = getRecordInputSchema;
  readonly outputSchema = recordOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Record',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: GetRecordInput, context: ToolExecutionContext): Promise<RecordView> {
    const objects = this.crm.forType(input.objectType);

    context.logger.debug(
      { objectType: input.objectType, idProperty: input.idProperty ?? 'id' },
      'Reading HubSpot record.'
    );

    if (input.idProperty !== undefined) {
      const record = await objects.getByAlternateId({
        value: input.recordId,
        idProperty: input.idProperty,
        properties: input.properties,
      });

      return toRecordView(record, { includeEmptyProperties: input.includeEmptyProperties });
    }

    const record = await objects.getById({
      id: input.recordId,
      properties: input.properties,
      associations: input.includeAssociations,
      archived: input.archived,
    });

    return toRecordView(record, {
      includeEmptyProperties: input.includeEmptyProperties,
      // Only carried when asked for: HubSpot returns an empty map otherwise,
      // and an always-present empty object is pure noise in the response.
      ...(input.includeAssociations === undefined ? {} : { associations: record.associations }),
    });
  }
}
