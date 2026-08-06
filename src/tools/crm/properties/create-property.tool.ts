import type { PropertiesService } from '../../../services/properties.service.js';
import {
  createPropertyInputSchema,
  propertyDefinitionOutputSchema,
  type CreatePropertyInput,
} from '../../../schemas/property.schema.js';
import type { PropertyDefinition } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_create_property` — creates a new custom property.
 *
 * Not idempotent: creating with a name that already exists is rejected by
 * HubSpot with a 409, so a retried request after a network failure could
 * fail confusingly rather than silently duplicating anything — but the
 * underlying request is still marked non-retryable for the same reason every
 * create is in this codebase: a transient failure must not risk a duplicate.
 *
 * @example Enumeration property
 * ```json
 * {
 *   "objectType": "contacts",
 *   "name": "renewal_risk",
 *   "label": "Renewal Risk",
 *   "type": "enumeration",
 *   "fieldType": "select",
 *   "groupName": "contactinformation",
 *   "options": [
 *     { "label": "Low", "value": "low" },
 *     { "label": "Medium", "value": "medium" },
 *     { "label": "High", "value": "high" }
 *   ]
 * }
 * ```
 *
 * @example Free-text property
 * ```json
 * {
 *   "objectType": "deals",
 *   "name": "competitor_name",
 *   "label": "Competitor",
 *   "type": "string",
 *   "fieldType": "text",
 *   "groupName": "dealinformation"
 * }
 * ```
 */
export class CreatePropertyTool implements ToolDefinition<
  typeof createPropertyInputSchema,
  PropertyDefinition
> {
  readonly name = 'hubspot_create_property';
  readonly title = 'Create HubSpot Custom Property';
  readonly description =
    'Create a new custom property on a HubSpot object type. type is the underlying data type ' +
    '(string, number, date, datetime, bool, enumeration); fieldType is the input widget and ' +
    'must be compatible (an enumeration type typically uses fieldType "select", "radio", or ' +
    '"checkbox"). groupName must be an existing property group in the portal — use ' +
    'hubspot_list_properties to see valid group names from other properties. options is ' +
    'required when type is "enumeration".';

  readonly inputSchema = createPropertyInputSchema;
  readonly outputSchema = propertyDefinitionOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Custom Property',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly properties: PropertiesService;

  constructor(properties: PropertiesService) {
    this.properties = properties;
  }

  async execute(
    input: CreatePropertyInput,
    context: ToolExecutionContext
  ): Promise<PropertyDefinition> {
    context.logger.info(
      { objectType: input.objectType, name: input.name, type: input.type },
      'Creating HubSpot custom property.'
    );

    return this.properties.create(input.objectType, input);
  }
}
