import type { PropertiesService } from '../../../services/properties.service.js';
import {
  propertyDefinitionOutputSchema,
  updatePropertyInputSchema,
  type UpdatePropertyInput,
} from '../../../schemas/property.schema.js';
import type { PropertyDefinition } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_update_property` — partially updates a custom property definition.
 *
 * PATCH semantics for `label`, `description`, and `hidden` — only supplied
 * fields change. **`options` is the one exception**: HubSpot replaces the
 * entire option list rather than merging it, so adding one option requires
 * resending the full existing set plus the new one (read it first with
 * `hubspot_get_property`).
 *
 * @example Relabel
 * ```json
 * { "objectType": "contacts", "propertyName": "renewal_risk", "label": "Churn Risk" }
 * ```
 *
 * @example Add an enumeration option (full list, not just the addition)
 * ```json
 * {
 *   "objectType": "contacts",
 *   "propertyName": "renewal_risk",
 *   "options": [
 *     { "label": "Low", "value": "low" },
 *     { "label": "Medium", "value": "medium" },
 *     { "label": "High", "value": "high" },
 *     { "label": "Critical", "value": "critical" }
 *   ]
 * }
 * ```
 */
export class UpdatePropertyTool implements ToolDefinition<
  typeof updatePropertyInputSchema,
  PropertyDefinition
> {
  readonly name = 'hubspot_update_property';
  readonly title = 'Update HubSpot Custom Property';
  readonly description =
    'Update a HubSpot property definition: label, description, or hidden. IMPORTANT: options is ' +
    'not merged — if you supply it, it REPLACES the entire option list, so first read the ' +
    'current options with hubspot_get_property and include all of them plus your change. Only ' +
    'the fields you supply are changed.';

  readonly inputSchema = updatePropertyInputSchema;
  readonly outputSchema = propertyDefinitionOutputSchema;

  readonly annotations = {
    title: 'Update HubSpot Custom Property',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly properties: PropertiesService;

  constructor(properties: PropertiesService) {
    this.properties = properties;
  }

  async execute(
    input: UpdatePropertyInput,
    context: ToolExecutionContext
  ): Promise<PropertyDefinition> {
    context.logger.info(
      { objectType: input.objectType, propertyName: input.propertyName },
      'Updating HubSpot custom property.'
    );

    return this.properties.update(input.objectType, input.propertyName, input);
  }
}
