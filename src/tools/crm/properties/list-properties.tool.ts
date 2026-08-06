import type { PropertiesService } from '../../../services/properties.service.js';
import {
  listPropertiesInputSchema,
  propertyListOutputSchema,
  type ListPropertiesInput,
} from '../../../schemas/property.schema.js';
import type { PropertyDefinition } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ListPropertiesResult {
  readonly objectType: string;
  readonly properties: readonly PropertyDefinition[];
  readonly count: number;
}

/**
 * `hubspot_list_properties` — every property defined for an object type.
 *
 * The prerequisite for reliably setting a custom property's value: property
 * names are portal-specific (a custom `renewal_risk` field on one portal may
 * not exist on another), so this is how an agent discovers what is actually
 * available rather than guessing a property name and getting a silent no-op
 * or a 400.
 *
 * @example
 * ```json
 * { "objectType": "deals" }
 * ```
 */
export class ListPropertiesTool implements ToolDefinition<
  typeof listPropertiesInputSchema,
  ListPropertiesResult
> {
  readonly name = 'hubspot_list_properties';
  readonly title = 'List HubSpot Properties';
  readonly description =
    'List every property defined for a HubSpot object type (contacts, companies, or deals), ' +
    'both built-in and custom. Each entry includes the internal name (what you pass to other ' +
    'tools), the display label, the data type, and — for enumeration properties — the full list ' +
    'of selectable options. Use this before setting an unfamiliar property to confirm the exact ' +
    'internal name and, for enumerations, a valid option value.';

  readonly inputSchema = listPropertiesInputSchema;
  readonly outputSchema = propertyListOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Properties',
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
    input: ListPropertiesInput,
    context: ToolExecutionContext
  ): Promise<ListPropertiesResult> {
    context.logger.debug({ objectType: input.objectType }, 'Listing HubSpot properties.');

    const properties = await this.properties.list(input.objectType);
    return { objectType: input.objectType, properties, count: properties.length };
  }
}
