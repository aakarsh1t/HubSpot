import type { PropertiesService } from '../../../services/properties.service.js';
import {
  deletePropertyInputSchema,
  propertyOperationResultSchema,
  type DeletePropertyInput,
} from '../../../schemas/property.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface DeleteResult {
  readonly success: boolean;
  readonly objectType: string;
  readonly propertyName: string | null;
  readonly message: string;
}

/**
 * `hubspot_delete_property` — permanently deletes a custom property definition.
 *
 * Irreversible: HubSpot exposes no way to restore a deleted property
 * definition or recover the values it held on existing records — deleting
 * `renewal_risk` does not just hide the field, it discards every value ever
 * set for it, on every record. Gated with the same literal-true confirmation
 * pattern as every other irreversible operation in this server.
 *
 * @example
 * ```json
 * { "objectType": "contacts", "propertyName": "renewal_risk", "confirmDeletion": true }
 * ```
 */
export class DeletePropertyTool implements ToolDefinition<
  typeof deletePropertyInputSchema,
  DeleteResult
> {
  readonly name = 'hubspot_delete_property';
  readonly title = 'Delete HubSpot Custom Property';
  readonly description =
    'PERMANENTLY delete a custom HubSpot property definition. This discards every value ever ' +
    'set for this property across every record of this object type — not just the field ' +
    'definition. Cannot be undone. Requires confirmDeletion to be exactly true. Only built-in ' +
    'HubSpot properties are protected from deletion by the platform; custom properties are not.';

  readonly inputSchema = deletePropertyInputSchema;
  readonly outputSchema = propertyOperationResultSchema;

  readonly annotations = {
    title: 'Delete HubSpot Custom Property',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly properties: PropertiesService;

  constructor(properties: PropertiesService) {
    this.properties = properties;
  }

  async execute(input: DeletePropertyInput, context: ToolExecutionContext): Promise<DeleteResult> {
    context.logger.warn(
      { objectType: input.objectType, propertyName: input.propertyName, irreversible: true },
      'Deleting HubSpot custom property definition.'
    );

    await this.properties.delete(input.objectType, input.propertyName);

    return {
      success: true,
      objectType: input.objectType,
      propertyName: input.propertyName,
      message:
        `Property "${input.propertyName}" was permanently deleted from ${input.objectType}, ` +
        'along with every value it held on existing records. This cannot be undone.',
    };
  }
}
