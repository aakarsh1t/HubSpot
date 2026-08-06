import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationPageOutputSchema,
  listDealAssociationsInputSchema,
  type ListDealAssociationsInput,
} from '../../../schemas/association.schema.js';
import type { AssociationRef } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ListAssociationsResult {
  readonly objectId: string;
  readonly toObjectType: string;
  readonly results: readonly AssociationRef[];
  readonly after: string | null;
  readonly count: number;
}

/**
 * `hubspot_list_deal_associations` — lists records linked to a deal.
 *
 * @example Contacts on a deal
 * ```json
 * { "dealId": "9001234567", "toObjectType": "contacts" }
 * ```
 */
export class ListDealAssociationsTool implements ToolDefinition<
  typeof listDealAssociationsInputSchema,
  ListAssociationsResult
> {
  readonly name = 'hubspot_list_deal_associations';
  readonly title = 'List HubSpot Deal Associations';
  readonly description =
    'List the records associated with a HubSpot deal for one object type — contacts, ' +
    'companies, tickets, notes, tasks, calls, meetings, or emails. Returns each associated ' +
    'record ID along with its association types and any custom labels.';

  readonly inputSchema = listDealAssociationsInputSchema;
  readonly outputSchema = associationPageOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Deal Associations',
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
    input: ListDealAssociationsInput,
    context: ToolExecutionContext
  ): Promise<ListAssociationsResult> {
    context.logger.debug(
      { dealId: input.dealId, toObjectType: input.toObjectType },
      'Listing deal associations.'
    );

    const page = await this.associations.list({
      fromObjectType: 'deals',
      fromObjectId: input.dealId,
      toObjectType: input.toObjectType,
      limit: input.limit,
      after: input.after,
    });

    return {
      objectId: input.dealId,
      toObjectType: input.toObjectType,
      results: page.results,
      after: page.after,
      count: page.results.length,
    };
  }
}
