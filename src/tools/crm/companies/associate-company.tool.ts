import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationMutationOutputSchema,
  createCompanyAssociationInputSchema,
  type CreateCompanyAssociationInput,
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
 * `hubspot_associate_company` — links a company to another record.
 *
 * Uses PUT (idempotent) and resolves the correct directional association
 * type ID automatically — see `hubspot_associate_contact` for the full
 * rationale, which applies identically here.
 *
 * @example Link to a contact
 * ```json
 * { "companyId": "7801234567", "toObjectType": "contacts", "toObjectId": "512" }
 * ```
 *
 * @example Link to a deal
 * ```json
 * { "companyId": "7801234567", "toObjectType": "deals", "toObjectId": "9001" }
 * ```
 */
export class AssociateCompanyTool implements ToolDefinition<
  typeof createCompanyAssociationInputSchema,
  AssociationMutationResult
> {
  readonly name = 'hubspot_associate_company';
  readonly title = 'Associate HubSpot Company with a Record';
  readonly description =
    'Create an association between a HubSpot company and another record — a contact, deal, ' +
    'ticket, note, task, call, meeting, or email. The default HubSpot-defined association type ' +
    'is used automatically; supply associationTypeId only for a custom labelled association. ' +
    'Safe to call more than once: associating an already-linked pair simply succeeds.';

  readonly inputSchema = createCompanyAssociationInputSchema;
  readonly outputSchema = associationMutationOutputSchema;

  readonly annotations = {
    title: 'Associate HubSpot Company with a Record',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly associations: AssociationsService;

  constructor(associations: AssociationsService) {
    this.associations = associations;
  }

  async execute(
    input: CreateCompanyAssociationInput,
    context: ToolExecutionContext
  ): Promise<AssociationMutationResult> {
    context.logger.info(
      {
        companyId: input.companyId,
        toObjectType: input.toObjectType,
        toObjectId: input.toObjectId,
      },
      'Associating HubSpot company with a record.'
    );

    await this.associations.create({
      fromObjectType: 'companies',
      fromObjectId: input.companyId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      associationTypeId: input.associationTypeId,
    });

    return {
      success: true,
      objectId: input.companyId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      message: `Company ${input.companyId} is now associated with ${input.toObjectType} record ${input.toObjectId}.`,
    };
  }
}
