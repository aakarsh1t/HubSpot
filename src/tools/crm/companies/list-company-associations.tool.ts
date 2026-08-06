import type { AssociationsService } from '../../../services/associations.service.js';
import {
  associationPageOutputSchema,
  listCompanyAssociationsInputSchema,
  type ListCompanyAssociationsInput,
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
 * `hubspot_list_company_associations` — lists records linked to a company.
 *
 * @example Contacts at a company
 * ```json
 * { "companyId": "7801234567", "toObjectType": "contacts" }
 * ```
 */
export class ListCompanyAssociationsTool implements ToolDefinition<
  typeof listCompanyAssociationsInputSchema,
  ListAssociationsResult
> {
  readonly name = 'hubspot_list_company_associations';
  readonly title = 'List HubSpot Company Associations';
  readonly description =
    'List the records associated with a HubSpot company for one object type — contacts, deals, ' +
    'tickets, notes, tasks, calls, meetings, or emails. Returns each associated record ID along ' +
    'with its association types and any custom labels. Use this to answer questions like "who ' +
    'works at this company?" or "what deals are open with this company?".';

  readonly inputSchema = listCompanyAssociationsInputSchema;
  readonly outputSchema = associationPageOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Company Associations',
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
    input: ListCompanyAssociationsInput,
    context: ToolExecutionContext
  ): Promise<ListAssociationsResult> {
    context.logger.debug(
      { companyId: input.companyId, toObjectType: input.toObjectType },
      'Listing company associations.'
    );

    const page = await this.associations.list({
      fromObjectType: 'companies',
      fromObjectId: input.companyId,
      toObjectType: input.toObjectType,
      limit: input.limit,
      after: input.after,
    });

    return {
      objectId: input.companyId,
      toObjectType: input.toObjectType,
      results: page.results,
      after: page.after,
      count: page.results.length,
    };
  }
}
