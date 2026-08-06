import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationMutationOutputSchema,
  deleteCompanyAssociationInputSchema,
  type DeleteCompanyAssociationInput,
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
 * `hubspot_disassociate_company` — removes the link between two records.
 *
 * Removes **every** association type between the pair, not just the default
 * one — see `hubspot_disassociate_contact` for the full rationale behind the
 * confirmation gate, which applies identically here.
 *
 * @example
 * ```json
 * {
 *   "companyId": "7801234567",
 *   "toObjectType": "contacts",
 *   "toObjectId": "512",
 *   "confirmRemoval": true
 * }
 * ```
 */
export class DisassociateCompanyTool implements ToolDefinition<
  typeof deleteCompanyAssociationInputSchema,
  AssociationMutationResult
> {
  readonly name = 'hubspot_disassociate_company';
  readonly title = 'Remove HubSpot Company Association';
  readonly description =
    'Remove the association between a HubSpot company and another record. This deletes ALL ' +
    'association types between the two records, including any custom labels — not just the ' +
    'default one. Neither record is deleted; only the relationship between them is removed. ' +
    'Requires confirmRemoval to be exactly true.';

  readonly inputSchema = deleteCompanyAssociationInputSchema;
  readonly outputSchema = associationMutationOutputSchema;

  readonly annotations = {
    title: 'Remove HubSpot Company Association',
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
    input: DeleteCompanyAssociationInput,
    context: ToolExecutionContext
  ): Promise<AssociationMutationResult> {
    context.logger.warn(
      {
        companyId: input.companyId,
        toObjectType: input.toObjectType,
        toObjectId: input.toObjectId,
      },
      'Removing HubSpot company association.'
    );

    await this.associations.remove({
      fromObjectType: 'companies',
      fromObjectId: input.companyId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
    });

    return {
      success: true,
      objectId: input.companyId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      message:
        `All associations between company ${input.companyId} and ${input.toObjectType} record ` +
        `${input.toObjectId} have been removed. Both records still exist.`,
    };
  }
}
