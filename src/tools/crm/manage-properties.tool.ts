import type { PropertiesService } from '../../services/properties.service.js';
import { ValidationError } from '../../utils/errors.js';
import {
  managePropertiesInputSchema,
  propertyResultSchema,
  type ManagePropertiesInput,
} from '../../schemas/crm.schema.js';
import type { PropertyDefinition, PropertyHistoryEntry } from '../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

interface PropertyToolResult {
  readonly action: string;
  readonly objectType: string;
  readonly properties?: readonly PropertyDefinition[];
  readonly count?: number;
  readonly history?: Readonly<Record<string, readonly PropertyHistoryEntry[]>>;
  readonly success?: boolean;
  readonly message: string;
}

/**
 * `hubspot_manage_properties` — portal schema administration.
 *
 * This is the admin half of the catalogue: it manages property *definitions*
 * (whether `renewal_risk` exists, what values it accepts, which group it
 * displays under) rather than record data, plus the historical value trail of a
 * property on one record.
 *
 * Also the tool an agent should reach for when a write fails with "property
 * does not exist" — `action: "list"` is how it discovers the portal's actual
 * property names, including custom ones it cannot know in advance.
 *
 * @example Discover what exists
 * ```json
 * { "action": "list", "objectType": "deals" }
 * ```
 *
 * @example Create a custom dropdown
 * ```json
 * {
 *   "action": "create", "objectType": "contacts",
 *   "propertyName": "renewal_risk", "label": "Renewal Risk",
 *   "type": "enumeration", "fieldType": "select", "groupName": "contactinformation",
 *   "options": [{ "label": "Low", "value": "low" }, { "label": "High", "value": "high" }]
 * }
 * ```
 */
export class ManagePropertiesTool implements ToolDefinition<
  typeof managePropertiesInputSchema,
  PropertyToolResult
> {
  readonly name = 'hubspot_manage_properties';
  readonly title = 'Manage HubSpot Properties';
  readonly description =
    'Administer HubSpot property definitions for contacts, companies, or deals, and read ' +
    'property value history. action "list" returns every property defined for an object type — ' +
    'use it to discover valid internal property names, including custom ones, before a create or ' +
    'update, or after a "property does not exist" error. "get" reads one definition; "create" and ' +
    '"update" change the portal schema for all users; "delete" is irreversible and requires ' +
    'confirmDeletion: true; "history" shows how a property value changed on one record and who ' +
    'changed it.';

  readonly inputSchema = managePropertiesInputSchema;
  readonly outputSchema = propertyResultSchema;

  readonly annotations = {
    title: 'Manage HubSpot Properties',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly properties: PropertiesService;

  constructor(properties: PropertiesService) {
    this.properties = properties;
  }

  async execute(
    input: ManagePropertiesInput,
    context: ToolExecutionContext
  ): Promise<PropertyToolResult> {
    const { action, objectType } = input;

    switch (action) {
      case 'list': {
        const properties = await this.properties.list(objectType);
        return {
          action,
          objectType,
          properties,
          count: properties.length,
          message: `${objectType} has ${properties.length} properties defined.`,
        };
      }

      case 'get': {
        const property = await this.properties.get(
          objectType,
          required(input.propertyName, 'propertyName')
        );
        return {
          action,
          objectType,
          properties: [property],
          count: 1,
          message: `Read the "${property.name}" property definition for ${objectType}.`,
        };
      }

      case 'create': {
        const property = await this.properties.create(objectType, {
          name: required(input.propertyName, 'propertyName'),
          label: required(input.label, 'label'),
          type: required(input.type, 'type'),
          fieldType: required(input.fieldType, 'fieldType'),
          groupName: required(input.groupName, 'groupName'),
          description: input.description,
          options: input.options,
        });

        context.logger.info({ objectType, name: property.name }, 'Created custom property.');

        return {
          action,
          objectType,
          properties: [property],
          count: 1,
          success: true,
          message: `Created the "${property.name}" property on ${objectType}.`,
        };
      }

      case 'update': {
        const property = await this.properties.update(
          objectType,
          required(input.propertyName, 'propertyName'),
          {
            label: input.label,
            description: input.description,
            options: input.options,
            hidden: input.hidden,
          }
        );

        context.logger.info({ objectType, name: property.name }, 'Updated custom property.');

        return {
          action,
          objectType,
          properties: [property],
          count: 1,
          success: true,
          message: `Updated the "${property.name}" property on ${objectType}.`,
        };
      }

      case 'delete': {
        const propertyName = required(input.propertyName, 'propertyName');
        await this.properties.delete(objectType, propertyName);

        context.logger.warn({ objectType, name: propertyName }, 'Deleted property definition.');

        return {
          action,
          objectType,
          success: true,
          message:
            `Deleted the "${propertyName}" property definition from ${objectType}. This is ` +
            'irreversible: the values it held on existing records are gone.',
        };
      }

      case 'history': {
        const recordId = required(input.recordId, 'recordId');
        const result = await this.properties.getHistory(
          objectType,
          recordId,
          required(input.propertyNames, 'propertyNames')
        );

        return {
          action,
          objectType,
          history: result.history,
          message: `Read property history for ${objectType} record ${recordId}.`,
        };
      }
    }
  }
}

/**
 * The schema refinements already enforce which fields each action needs; this
 * narrows the optionals away for TypeScript and turns a future schema
 * regression into a typed validation error instead of a malformed HubSpot call.
 */
function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new ValidationError(`The "${field}" field is required for this action.`);
  }
  return value;
}
