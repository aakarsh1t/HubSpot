import type { PropertiesService } from '../../../services/properties.service.js';
import {
  getPropertyInputSchema,
  propertyDefinitionOutputSchema,
  type GetPropertyInput,
} from '../../../schemas/property.schema.js';
import type { PropertyDefinition } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_get_property` — reads a single property definition.
 *
 * @example
 * ```json
 * { "objectType": "contacts", "propertyName": "lifecyclestage" }
 * ```
 */
export class GetPropertyTool implements ToolDefinition<
  typeof getPropertyInputSchema,
  PropertyDefinition
> {
  readonly name = 'hubspot_get_property';
  readonly title = 'Get HubSpot Property Definition';
  readonly description =
    'Retrieve the full definition of a single HubSpot property by its internal name, including ' +
    'its data type, input widget, group, and — for enumeration properties — every selectable ' +
    'option. Use hubspot_list_properties instead when you do not already know the exact ' +
    'internal property name.';

  readonly inputSchema = getPropertyInputSchema;
  readonly outputSchema = propertyDefinitionOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Property Definition',
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
    input: GetPropertyInput,
    context: ToolExecutionContext
  ): Promise<PropertyDefinition> {
    context.logger.debug(
      { objectType: input.objectType, propertyName: input.propertyName },
      'Reading HubSpot property definition.'
    );

    return this.properties.get(input.objectType, input.propertyName);
  }
}
