import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationMutationOutputSchema,
  deleteDealAssociationInputSchema,
  type DeleteDealAssociationInput,
} from '../../../schemas/association.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface AssociationMutationResult {
  readonly success: boolean;
  readonly objectId: string;
  readonly toObjectType: string;
  readonly toObjectId: string;
  readonly message: string;
}

/**
 * `hubspot_disassociate_deal` — removes the link between two records.
 *
 * Removes **every** association type between the pair — see
 * `hubspot_disassociate_contact` for the full rationale behind the
 * confirmation gate.
 *
 * @example
 * ```json
 * {
 *   "dealId": "9001234567",
 *   "toObjectType": "contacts",
 *   "toObjectId": "512",
 *   "confirmRemoval": true
 * }
 * ```
 */
export class DisassociateDealTool implements ToolDefinition<
  typeof deleteDealAssociationInputSchema,
  AssociationMutationResult
> {
  readonly name = 'hubspot_disassociate_deal';
  readonly title = 'Remove HubSpot Deal Association';
  readonly description =
    'Remove the association between a HubSpot deal and another record. This deletes ALL ' +
    'association types between the two records, including any custom labels. Neither record is ' +
    'deleted; only the relationship is removed. Requires confirmRemoval to be exactly true.';

  readonly inputSchema = deleteDealAssociationInputSchema;
  readonly outputSchema = associationMutationOutputSchema;

  readonly annotations = {
    title: 'Remove HubSpot Deal Association',
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
    input: DeleteDealAssociationInput,
    context: ToolExecutionContext
  ): Promise<AssociationMutationResult> {
    context.logger.warn(
      { dealId: input.dealId, toObjectType: input.toObjectType, toObjectId: input.toObjectId },
      'Removing HubSpot deal association.'
    );

    await this.associations.remove({
      fromObjectType: 'deals',
      fromObjectId: input.dealId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
    });

    return {
      success: true,
      objectId: input.dealId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      message:
        `All associations between deal ${input.dealId} and ${input.toObjectType} record ` +
        `${input.toObjectId} have been removed. Both records still exist.`,
    };
  }
}
