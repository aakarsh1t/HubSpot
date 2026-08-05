import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationPageOutputSchema,
  listAssociationsInputSchema,
  type ListAssociationsInput,
} from '../../../schemas/association.schema.js';
import type { AssociationRef } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ListAssociationsResult {
  readonly contactId: string;
  readonly toObjectType: string;
  readonly results: readonly AssociationRef[];
  readonly after: string | null;
  readonly count: number;
}

/**
 * `hubspot_list_contact_associations` — lists records linked to a contact.
 *
 * Returns the association *types* alongside each ID, including custom labels,
 * which is how a portal distinguishes a "decision maker" from a "billing
 * contact" on the same company.
 *
 * @example Companies a contact belongs to
 * ```json
 * { "contactId": "51234567890", "toObjectType": "companies" }
 * ```
 *
 * @example Open deals
 * ```json
 * { "contactId": "51234567890", "toObjectType": "deals", "limit": 50 }
 * ```
 */
export class ListAssociationsTool implements ToolDefinition<
  typeof listAssociationsInputSchema,
  ListAssociationsResult
> {
  readonly name = 'hubspot_list_contact_associations';
  readonly title = 'List HubSpot Contact Associations';
  readonly description =
    'List the records associated with a HubSpot contact for one object type — companies, deals, ' +
    'tickets, notes, tasks, calls, meetings, or emails. Returns each associated record ID along ' +
    'with its association types and any custom labels. Use this to answer questions like "which ' +
    'company does this contact work for?" or "what deals is this contact on?". Follow up with ' +
    'the relevant read tool to fetch full details of the associated records.';

  readonly inputSchema = listAssociationsInputSchema;
  readonly outputSchema = associationPageOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Contact Associations',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly associations: AssociationsService;

  constructor(associations: AssociationsService) {
    this.associations = associations;
  }

  async execute(
    input: ListAssociationsInput,
    context: ToolExecutionContext
  ): Promise<ListAssociationsResult> {
    context.logger.debug(
      { contactId: input.contactId, toObjectType: input.toObjectType },
      'Listing contact associations.'
    );

    const page = await this.associations.list({
      contactId: input.contactId,
      toObjectType: input.toObjectType,
      limit: input.limit,
      after: input.after,
    });

    return {
      contactId: input.contactId,
      toObjectType: input.toObjectType,
      results: page.results,
      after: page.after,
      count: page.results.length,
    };
  }
}
