import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationMutationOutputSchema,
  deleteAssociationInputSchema,
  type DeleteAssociationInput,
} from '../../../schemas/association.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface AssociationMutationResult {
  readonly success: boolean;
  readonly contactId: string;
  readonly toObjectType: string;
  readonly toObjectId: string;
  readonly message: string;
}

/**
 * `hubspot_disassociate_contact` — removes the link between two records.
 *
 * Gated with a literal-true flag for a specific reason: HubSpot's v4 DELETE
 * removes **every** association type between the pair, not just the default
 * one. On a contact carrying several labelled roles against the same company,
 * a caller expecting to drop one label would silently drop them all. The
 * confirmation flag and the description both make that explicit.
 *
 * The records themselves are never deleted — only the relationship.
 *
 * @example
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "toObjectType": "companies",
 *   "toObjectId": "7801",
 *   "confirmRemoval": true
 * }
 * ```
 */
export class DeleteAssociationTool implements ToolDefinition<
  typeof deleteAssociationInputSchema,
  AssociationMutationResult
> {
  readonly name = 'hubspot_disassociate_contact';
  readonly title = 'Remove HubSpot Contact Association';
  readonly description =
    'Remove the association between a HubSpot contact and another record. This deletes ALL ' +
    'association types between the two records, including any custom labels — not just the ' +
    'default one. Neither record is deleted; only the relationship between them is removed. ' +
    'Requires confirmRemoval to be exactly true.';

  readonly inputSchema = deleteAssociationInputSchema;
  readonly outputSchema = associationMutationOutputSchema;

  readonly annotations = {
    title: 'Remove HubSpot Contact Association',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly associations: AssociationsService;

  constructor(associations: AssociationsService) {
    this.associations = associations;
  }

  async execute(
    input: DeleteAssociationInput,
    context: ToolExecutionContext
  ): Promise<AssociationMutationResult> {
    context.logger.warn(
      {
        contactId: input.contactId,
        toObjectType: input.toObjectType,
        toObjectId: input.toObjectId,
      },
      'Removing HubSpot contact association.'
    );

    await this.associations.remove({
      contactId: input.contactId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
    });

    return {
      success: true,
      contactId: input.contactId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      message:
        `All associations between contact ${input.contactId} and ${input.toObjectType} record ` +
        `${input.toObjectId} have been removed. Both records still exist.`,
    };
  }
}
