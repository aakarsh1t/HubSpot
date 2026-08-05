import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationMutationOutputSchema,
  createAssociationInputSchema,
  type CreateAssociationInput,
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
 * `hubspot_associate_contact` — links a contact to another record.
 *
 * Uses HubSpot associations v4 with `PUT`, which is idempotent: associating an
 * already-associated pair succeeds as a no-op rather than erroring, so an
 * agent that retries or repeats itself cannot corrupt anything.
 *
 * Association type IDs are directional in HubSpot (contact→company is 279,
 * company→contact is 280). The correct ID is resolved from a verified constant
 * map, so callers never supply one unless they want a custom labelled type.
 *
 * @example Link to a company
 * ```json
 * { "contactId": "51234567890", "toObjectType": "companies", "toObjectId": "7801" }
 * ```
 *
 * @example Custom labelled association
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "toObjectType": "companies",
 *   "toObjectId": "7801",
 *   "associationTypeId": 145
 * }
 * ```
 */
export class CreateAssociationTool implements ToolDefinition<
  typeof createAssociationInputSchema,
  AssociationMutationResult
> {
  readonly name = 'hubspot_associate_contact';
  readonly title = 'Associate HubSpot Contact with a Record';
  readonly description =
    'Create an association between a HubSpot contact and another record — a company, deal, ' +
    'ticket, note, task, call, meeting, or email. The default HubSpot-defined association type ' +
    'is used automatically; supply associationTypeId only for a custom labelled association. ' +
    'Safe to call more than once: associating an already-linked pair simply succeeds. Use this ' +
    'to link an existing contact to an existing record.';

  readonly inputSchema = createAssociationInputSchema;
  readonly outputSchema = associationMutationOutputSchema;

  readonly annotations = {
    title: 'Associate HubSpot Contact with a Record',
    readOnlyHint: false,
    destructiveHint: false,
    // PUT of the same association is a no-op.
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly associations: AssociationsService;

  constructor(associations: AssociationsService) {
    this.associations = associations;
  }

  async execute(
    input: CreateAssociationInput,
    context: ToolExecutionContext
  ): Promise<AssociationMutationResult> {
    context.logger.info(
      {
        contactId: input.contactId,
        toObjectType: input.toObjectType,
        toObjectId: input.toObjectId,
      },
      'Associating HubSpot contact with a record.'
    );

    await this.associations.create({
      contactId: input.contactId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      associationTypeId: input.associationTypeId,
    });

    return {
      success: true,
      contactId: input.contactId,
      toObjectType: input.toObjectType,
      toObjectId: input.toObjectId,
      message: `Contact ${input.contactId} is now associated with ${input.toObjectType} record ${input.toObjectId}.`,
    };
  }
}
