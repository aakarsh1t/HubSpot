import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationMutationOutputSchema,
  createDealAssociationInputSchema,
  type CreateDealAssociationInput,
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
 * `hubspot_associate_deal` — links a deal to another record.
 *
 * Uses PUT (idempotent) and resolves the correct directional association
 * type ID automatically — see `hubspot_associate_contact` for the full
 * rationale.
 *
 * @example Link to a contact
 * ```json
 * { "dealId": "9001234567", "toObjectType": "contacts", "toObjectId": "512" }
 * ```
 */
export class AssociateDealTool implements ToolDefinition<
  typeof createDealAssociationInputSchema,
  AssociationMutationResult
> {
  readonly name = 'hubspot_associate_deal';
  readonly title = 'Associate HubSpot Deal with a Record';
  readonly description =
    'Create an association between a HubSpot deal and another record — a contact, company, ' +
    'ticket, note, task, call, meeting, or email. The default HubSpot-defined association type ' +
    'is used automatically. Safe to call more than once: associating an already-linked pair ' +
    'simply succeeds.';

  readonly inputSchema = createDealAssociationInputSchema;
  readonly outputSchema = associationMutationOutputSchema;

  readonly annotations = {
    title: 'Associate HubSpot Deal with a Record',
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
    input: CreateDealAssociationInput,
    context: ToolExecutionContext
  ): Promise<AssociationMutationResult> {
    context.logger.info(
      { dealId: input.dealId, toObjectType: input.toObjectType, toObjectId: input.toObjectId },
      'Associating HubSpot deal with a record.'
    );

    await this.associations.create({
      fromObjectType: 'deals',
      fromObjectId: input.dealId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      associationTypeId: input.associationTypeId,
    });

    return {
      success: true,
      objectId: input.dealId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      message: `Deal ${input.dealId} is now associated with ${input.toObjectType} record ${input.toObjectId}.`,
    };
  }
}
