import { toBatchView, type BatchView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import { ValidationError } from '../../utils/errors.js';
import {
  batchOutcomeOutputSchema,
  batchRecordsInputSchema,
  type BatchRecordsInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_batch_records` — bulk create, read, update, or archive.
 *
 * This one tool replaces twelve: four batch operations across three object
 * types. That was the single largest block of duplication in the old
 * catalogue, and the least defensible — the operation and the object type are
 * both just parameters of the same HubSpot endpoint family
 * (`/crm/v3/objects/{type}/batch/{op}`).
 *
 * Every result reports explicit `succeeded` / `failed` counts, because HubSpot
 * answers a partially-successful batch with HTTP 207 and a body containing
 * both results and errors. Reading a 207 as a clean success is the most common
 * way a bulk import loses records silently.
 *
 * @example Update 2 deals
 * ```json
 * {
 *   "objectType": "deals",
 *   "operation": "update",
 *   "records": [
 *     { "recordId": "9001", "properties": { "dealstage": "closedwon" } },
 *     { "recordId": "9002", "properties": { "dealstage": "closedlost" } }
 *   ]
 * }
 * ```
 *
 * @example Read contacts by email
 * ```json
 * {
 *   "objectType": "contacts",
 *   "operation": "read",
 *   "recordIds": ["jane@acme.com", "sam@acme.com"],
 *   "idProperty": "email"
 * }
 * ```
 */
export class BatchRecordsTool implements ToolDefinition<typeof batchRecordsInputSchema, BatchView> {
  readonly name = 'hubspot_batch_records';
  readonly title = 'Bulk HubSpot Record Operation';
  readonly description =
    'Create, read, update, or archive up to 100 HubSpot contacts, companies, or deals in one ' +
    'request. create/update take records[]; read/archive take recordIds[] (read can resolve ' +
    'unique property values such as emails via idProperty). Archive requires confirmArchive: ' +
    'true. Always check the returned failed count — HubSpot reports partial success, so some ' +
    'records can fail while the call itself succeeds. Prefer this over repeated single-record ' +
    'calls: it is one round trip and one rate-limit token instead of N.';

  readonly inputSchema = batchRecordsInputSchema;
  readonly outputSchema = batchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Bulk HubSpot Record Operation',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: BatchRecordsInput, context: ToolExecutionContext): Promise<BatchView> {
    const objects = this.crm.forType(input.objectType);
    const includeEmpty = input.includeEmptyProperties;

    context.logger.info(
      {
        objectType: input.objectType,
        operation: input.operation,
        count: (input.records ?? input.recordIds ?? []).length,
      },
      'Running HubSpot batch operation.'
    );

    switch (input.operation) {
      case 'create': {
        const outcome = await objects.batchCreate(
          requireRecords(input).map((record) => ({ properties: record.properties }))
        );
        return toBatchView(input.objectType, 'create', outcome, includeEmpty);
      }

      case 'update': {
        const outcome = await objects.batchUpdate(
          requireRecords(input).map((record) => ({
            // Guaranteed by the schema refinement; re-checked so a future schema
            // edit surfaces here as a validation error rather than as a HubSpot
            // 400 on a partially-applied batch.
            id: requireRecordId(record.recordId),
            properties: record.properties,
          }))
        );
        return toBatchView(input.objectType, 'update', outcome, includeEmpty);
      }

      case 'read': {
        const outcome = await objects.batchRead({
          ids: requireRecordIds(input),
          idProperty: input.idProperty,
          properties: input.properties,
        });
        return toBatchView(input.objectType, 'read', outcome, includeEmpty);
      }

      case 'archive': {
        const ids = requireRecordIds(input);
        const archived = await objects.batchArchive(ids);

        // HubSpot answers a batch archive with 204 and no body: there is no
        // per-record outcome to report, so success is all-or-nothing.
        return {
          objectType: input.objectType,
          operation: 'archive',
          status: 'COMPLETE',
          requested: ids.length,
          succeeded: archived,
          failed: 0,
          results: [],
          errors: [],
        };
      }
    }
  }
}

function requireRecords(input: BatchRecordsInput): NonNullable<BatchRecordsInput['records']> {
  if (input.records === undefined || input.records.length === 0) {
    throw new ValidationError(
      `The "${input.operation}" operation requires a non-empty records array.`
    );
  }
  return input.records;
}

function requireRecordIds(input: BatchRecordsInput): string[] {
  if (input.recordIds === undefined || input.recordIds.length === 0) {
    throw new ValidationError(
      `The "${input.operation}" operation requires a non-empty recordIds array.`
    );
  }
  return [...input.recordIds];
}

function requireRecordId(recordId: string | undefined): string {
  if (recordId === undefined) {
    throw new ValidationError('Every record in a batch update must carry its recordId.');
  }
  return recordId;
}
