import type { AssociationsService } from '../../services/associations.service.js';
import { ValidationError } from '../../utils/errors.js';
import {
  associationResultSchema,
  manageAssociationsInputSchema,
  type ManageAssociationsInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

interface AssociationResult {
  readonly action: string;
  readonly objectType: string;
  readonly recordId: string;
  readonly toObjectType: string;
  readonly results?: readonly {
    readonly toObjectId: string;
    readonly associationTypes: readonly {
      readonly category: string;
      readonly typeId: number;
      readonly label: string | null;
    }[];
  }[];
  readonly count?: number;
  readonly after?: string | null;
  readonly success?: boolean;
  readonly message: string;
}

/**
 * `hubspot_manage_associations` — reads, creates, and removes links between records.
 *
 * Replaces nine tools: list/associate/disassociate for each of contacts,
 * companies, and deals. The direction of an association is not symmetric in
 * HubSpot (contact→company is type 279, company→contact is 280), and getting it
 * backwards produces a 400 that reads like a permissions failure — so direction
 * is derived here from `objectType` → `toObjectType` through a verified lookup
 * table rather than being something the caller can get wrong.
 *
 * @example
 * ```json
 * {
 *   "action": "create",
 *   "objectType": "deals", "recordId": "9001",
 *   "toObjectType": "contacts", "toObjectId": "512"
 * }
 * ```
 */
export class ManageAssociationsTool implements ToolDefinition<
  typeof manageAssociationsInputSchema,
  AssociationResult
> {
  readonly name = 'hubspot_manage_associations';
  readonly title = 'Manage HubSpot Associations';
  readonly description =
    'List, create, or remove the links between a HubSpot record and other records — the ' +
    'contacts on a deal, the deals at a company, the tickets for a contact, and so on. ' +
    'action "list" needs objectType, recordId, and toObjectType; "create" and "delete" also ' +
    'need toObjectId. Creating is idempotent (linking twice is a no-op). Deleting removes ALL ' +
    'association types between the two records but does not delete the records themselves. ' +
    'Association direction is handled for you.';

  readonly inputSchema = manageAssociationsInputSchema;
  readonly outputSchema = associationResultSchema;

  readonly annotations = {
    title: 'Manage HubSpot Associations',
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
    input: ManageAssociationsInput,
    context: ToolExecutionContext
  ): Promise<AssociationResult> {
    const base = {
      action: input.action,
      objectType: input.objectType,
      recordId: input.recordId,
      toObjectType: input.toObjectType,
    };

    if (input.action === 'list') {
      const page = await this.associations.list({
        fromObjectType: input.objectType,
        fromObjectId: input.recordId,
        toObjectType: input.toObjectType,
        limit: input.limit,
        after: input.after,
      });

      return {
        ...base,
        results: page.results.map((result) => ({
          toObjectId: result.toObjectId,
          associationTypes: result.associationTypes,
        })),
        count: page.results.length,
        after: page.after,
        message:
          `Found ${page.results.length} associated ${input.toObjectType} for ${input.objectType} ` +
          `record ${input.recordId}.`,
      };
    }

    // Guaranteed by the schema refinement; re-checked so the failure is a
    // typed validation error rather than a TypeScript-invisible undefined
    // reaching the HubSpot URL.
    const toObjectId = input.toObjectId;
    if (toObjectId === undefined) {
      throw new ValidationError(`The "${input.action}" action requires toObjectId.`);
    }

    if (input.action === 'create') {
      await this.associations.create({
        fromObjectType: input.objectType,
        fromObjectId: input.recordId,
        toObjectType: input.toObjectType,
        toObjectId,
        associationTypeId: input.associationTypeId,
      });

      context.logger.info({ ...base, toObjectId }, 'Created HubSpot association.');

      return {
        ...base,
        success: true,
        message: `Associated ${input.objectType} ${input.recordId} with ${input.toObjectType} ${toObjectId}.`,
      };
    }

    await this.associations.remove({
      fromObjectType: input.objectType,
      fromObjectId: input.recordId,
      toObjectType: input.toObjectType,
      toObjectId,
    });

    context.logger.warn({ ...base, toObjectId }, 'Removed HubSpot association.');

    return {
      ...base,
      success: true,
      message:
        `Removed all associations between ${input.objectType} ${input.recordId} and ` +
        `${input.toObjectType} ${toObjectId}. Both records still exist.`,
    };
  }
}
