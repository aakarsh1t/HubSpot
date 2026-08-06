import { z } from 'zod';
import { propertyBagSchema, searchOperatorSchema } from './contact.schema.js';

/**
 * Zod contracts for the Deals module.
 *
 * Structurally parallel to Contacts and Companies for everything HubSpot's
 * generic Objects API provides (CRUD, search, batch, merge). What is
 * genuinely deal-specific — pipeline, stage, and forecast category — gets
 * its own dedicated schemas below rather than being left as "just another
 * property," because these three fields are exactly the ones an agent is
 * least likely to get right by freehand property editing: `dealstage` and
 * `pipeline` are opaque HubSpot-generated IDs (not human-readable strings),
 * and moving a deal to a stage that does not belong to its current pipeline
 * fails in a way that is hard to diagnose from the error alone.
 */

export const dealIdSchema = z
  .string()
  .trim()
  .min(1, 'Deal ID must not be empty.')
  .regex(/^\d+$/u, 'A HubSpot deal ID is numeric, e.g. "9001".')
  .describe('The numeric HubSpot deal record ID, e.g. "9001234567".');

const propertyListSchema = z
  .array(z.string().trim().min(1))
  .max(200, 'Request at most 200 properties at a time.')
  .optional()
  .describe(
    'Specific HubSpot property names to return. Omit for a sensible default set ' +
      '(deal name, stage, pipeline, amount, close date, type, forecast category, owner, timestamps).'
  );

const dealPropertyBagSchema = propertyBagSchema.describe(
  'HubSpot deal properties as a flat key/value object, e.g. ' +
    '{"dealname":"Acme Corp - Enterprise","amount":50000,"closedate":"2026-12-31",' +
    '"dealtype":"newbusiness"}. Use hubspot_move_deal_stage and hubspot_change_deal_pipeline ' +
    'instead of setting dealstage/pipeline here directly — those tools validate the stage ' +
    'belongs to the target pipeline. Use HubSpot internal property names (lowercase).'
);

const associationsInputSchema = z
  .array(
    z.object({
      toObjectType: z
        .enum(['contacts', 'companies', 'tickets'])
        .describe('The object type to associate the new deal with.'),
      toObjectId: z
        .string()
        .trim()
        .min(1)
        .describe('The numeric record ID of the object to associate.'),
    })
  )
  .max(100)
  .optional()
  .describe('Records to associate with the deal at creation time.');

// --------------------------------------------------------------------------
// Create / update
// --------------------------------------------------------------------------

export const createDealInputSchema = z.object({
  properties: dealPropertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property. "dealname" is strongly recommended.',
  }),
  associations: associationsInputSchema,
});

export const updateDealInputSchema = z.object({
  dealId: dealIdSchema,
  properties: dealPropertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property to update.',
  }),
});

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

export const getDealInputSchema = z.object({
  dealId: dealIdSchema,
  properties: propertyListSchema,
  includeAssociations: z
    .array(
      z.enum(['contacts', 'companies', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
    )
    .max(8)
    .optional()
    .describe('Object types whose associated record IDs should be returned alongside the deal.'),
  archived: z
    .boolean()
    .default(false)
    .describe('Set true to read a deal that has been archived (deleted). Defaults to false.'),
});

export const listDealsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Results per page (1-100). Defaults to 25.'),
  after: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Pagination cursor returned as "after" by a previous call. Omit for the first page.'),
  properties: propertyListSchema,
  archived: z.boolean().default(false).describe('Set true to list archived (deleted) deals.'),
});

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

const searchFilterSchema = z
  .object({
    propertyName: z
      .string()
      .trim()
      .min(1)
      .describe('HubSpot internal property name to filter on, e.g. "dealstage" or "amount".'),
    operator: searchOperatorSchema,
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .describe(
        'Single comparison value. Required for all operators except IN/NOT_IN and HAS_PROPERTY/NOT_HAS_PROPERTY.'
      ),
    values: z
      .array(z.union([z.string(), z.number()]))
      .max(100)
      .optional()
      .describe('Value list for the IN and NOT_IN operators.'),
    highValue: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Upper bound for the BETWEEN operator, e.g. filtering amount between two values.'),
  })
  .superRefine((filter, ctx) => {
    const needsValues = filter.operator === 'IN' || filter.operator === 'NOT_IN';
    const needsNothing =
      filter.operator === 'HAS_PROPERTY' || filter.operator === 'NOT_HAS_PROPERTY';

    if (needsValues && (filter.values === undefined || filter.values.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['values'],
        message: `The ${filter.operator} operator requires a non-empty "values" array.`,
      });
    }
    if (filter.operator === 'BETWEEN' && filter.highValue === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['highValue'],
        message: 'The BETWEEN operator requires "highValue" in addition to "value".',
      });
    }
    if (!needsValues && !needsNothing && filter.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `The ${filter.operator} operator requires "value".`,
      });
    }
  });

export const searchDealsInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Free-text search across default searchable deal properties (deal name).'),
    filterGroups: z
      .array(
        z.object({
          filters: z
            .array(searchFilterSchema)
            .min(1)
            .max(6, 'HubSpot allows at most 6 filters per filter group.')
            .describe('Filters within a group are combined with AND.'),
        })
      )
      .max(5, 'HubSpot allows at most 5 filter groups.')
      .optional()
      .describe('Filter groups are combined with OR; filters inside a group with AND.'),
    sorts: z
      .array(
        z.object({
          propertyName: z.string().trim().min(1),
          direction: z.enum(['ASCENDING', 'DESCENDING']).default('DESCENDING'),
        })
      )
      .max(1, 'HubSpot search accepts a single sort.')
      .optional(),
    properties: propertyListSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(25)
      .describe('Results per page (1-200). Defaults to 25.'),
    after: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Pagination cursor from a previous search.'),
  })
  .superRefine((input, ctx) => {
    const totalFilters = (input.filterGroups ?? []).reduce(
      (sum, group) => sum + group.filters.length,
      0
    );

    if (totalFilters > 18) {
      ctx.addIssue({
        code: 'custom',
        path: ['filterGroups'],
        message: `HubSpot allows at most 18 filters in total; received ${totalFilters}.`,
      });
    }
    if (input.query === undefined && (input.filterGroups ?? []).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['filterGroups'],
        message:
          'Provide "query" for free-text search or at least one filter group. To list all ' +
          'deals without criteria, use the list tool instead.',
      });
    }
  });

// --------------------------------------------------------------------------
// Destructive operations
// --------------------------------------------------------------------------

export const archiveDealInputSchema = z.object({ dealId: dealIdSchema });

export const deleteDealInputSchema = z.object({
  dealId: dealIdSchema,
  confirmPermanentDeletion: z
    .literal(true)
    .describe(
      'Must be exactly true. This performs a GDPR-compliant PERMANENT deletion: the deal and ' +
        'its history are unrecoverable. Use the archive tool instead unless permanent erasure ' +
        'is explicitly required.'
    ),
});

export const restoreDealInputSchema = z.object({
  dealId: dealIdSchema,
  confirmRecreate: z
    .literal(true)
    .describe(
      'Must be exactly true. HubSpot provides no un-archive API, so this recreates the deal ' +
        'from its archived snapshot as a NEW record with a NEW ID. Associations, engagements, ' +
        'and timeline history are NOT restored. For a true restore, use the HubSpot UI recycle ' +
        'bin within 90 days of deletion.'
    ),
  properties: propertyListSchema,
});

export const mergeDealsInputSchema = z
  .object({
    primaryDealId: dealIdSchema.describe(
      'The deal that survives the merge and keeps its ID. Its property values win on conflict.'
    ),
    dealIdToMerge: dealIdSchema.describe(
      'The deal absorbed into the primary. This record ceases to exist as a separate deal.'
    ),
    confirmMerge: z
      .literal(true)
      .describe('Must be exactly true. Merging cannot be undone through the API.'),
  })
  .refine((input) => input.primaryDealId !== input.dealIdToMerge, {
    message: 'A deal cannot be merged into itself.',
    path: ['dealIdToMerge'],
  });

// --------------------------------------------------------------------------
// Batch
// --------------------------------------------------------------------------

const BATCH_LIMIT = 100;

export const batchCreateDealsInputSchema = z.object({
  deals: z
    .array(z.object({ properties: dealPropertyBagSchema }))
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 deals to create in one request.'),
});

export const batchUpdateDealsInputSchema = z.object({
  deals: z
    .array(z.object({ dealId: dealIdSchema, properties: dealPropertyBagSchema }))
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 deals to update in one request.'),
});

export const batchArchiveDealsInputSchema = z.object({
  dealIds: z
    .array(dealIdSchema)
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 deal IDs to archive (soft delete, recoverable for 90 days).'),
  confirmArchive: z
    .literal(true)
    .describe('Must be exactly true. Archives every listed deal in a single operation.'),
});

export const batchReadDealsInputSchema = z.object({
  dealIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(BATCH_LIMIT)
    .describe('Up to 100 deal record IDs.'),
  properties: propertyListSchema,
});

// --------------------------------------------------------------------------
// Deal-specific: pipeline, stage, forecast category
// --------------------------------------------------------------------------

export const listPipelinesInputSchema = z.object({});

export const moveDealStageInputSchema = z.object({
  dealId: dealIdSchema,
  stageId: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The target stage ID, which must belong to the deal's CURRENT pipeline. Stage IDs are " +
        'opaque HubSpot identifiers — call hubspot_list_deal_pipelines first to discover valid ' +
        'stage IDs and their human-readable labels. To move a deal to a stage in a DIFFERENT ' +
        'pipeline, use hubspot_change_deal_pipeline instead, which sets both together.'
    ),
});

export const changeDealPipelineInputSchema = z.object({
  dealId: dealIdSchema,
  pipelineId: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The target pipeline ID. Call hubspot_list_deal_pipelines to discover valid pipeline IDs.'
    ),
  stageId: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The stage within the target pipeline to place the deal in. Required: a stage ID from the ' +
        'OLD pipeline is not valid in a new one, so HubSpot needs an explicit target stage ' +
        'whenever the pipeline changes.'
    ),
});

/**
 * HubSpot's forecast category values are NOT a portal-independent fixed enum
 * — the option set is influenced by whether the portal uses automatic or
 * manual forecasting and can include portal-specific customization. Rather
 * than assert a fixed list that could reject a legitimate value in some
 * portals, this accepts any non-empty string and documents the common values
 * for guidance. `hubspot_list_deal_pipelines` plus the user's own HubSpot
 * deal property settings are the authoritative source for a given portal.
 */
export const setForecastCategoryInputSchema = z.object({
  dealId: dealIdSchema,
  forecastCategory: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The forecast category value. Common HubSpot values include "pipeline", "best_case", ' +
        '"commit", "omitted", and "closed", but the exact option set is configurable per portal ' +
        "— check the user's HubSpot deal property settings if a value is rejected."
    ),
});

// --------------------------------------------------------------------------
// Output schemas
// --------------------------------------------------------------------------

export const dealOutputSchema = z.object({
  id: z.string().describe('The HubSpot deal record ID.'),
  properties: z.record(z.string(), z.string().nullable()).describe('Returned property values.'),
  createdAt: z.string().nullable().describe('ISO 8601 creation timestamp.'),
  updatedAt: z.string().nullable().describe('ISO 8601 last-modified timestamp.'),
  archived: z.boolean().describe('True when the record is archived (deleted).'),
});

export const dealPageOutputSchema = z.object({
  results: z.array(dealOutputSchema),
  after: z
    .string()
    .nullable()
    .describe('Cursor for the next page; null when there are no further results.'),
  total: z.number().nullable().describe('Total matching records, when HubSpot reports it.'),
  count: z.number().describe('Number of records in this page.'),
});

export const dealBatchOutcomeOutputSchema = z.object({
  status: z.enum(['COMPLETE', 'PARTIAL', 'ERROR']),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(dealOutputSchema),
  errors: z.array(
    z.object({
      message: z.string(),
      category: z.string().nullable(),
      context: z.record(z.string(), z.unknown()).nullable(),
    })
  ),
});

export const dealOperationResultSchema = z.object({
  success: z.boolean(),
  dealId: z.string().nullable(),
  message: z.string().describe('Human-readable outcome, suitable for relaying to a user.'),
});

export const pipelineStageOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  displayOrder: z.number(),
  probability: z.number().nullable(),
  isClosed: z.boolean(),
});

export const pipelineOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  displayOrder: z.number(),
  stages: z.array(pipelineStageOutputSchema),
});

export const listPipelinesOutputSchema = z.object({
  pipelines: z.array(pipelineOutputSchema),
  count: z.number(),
});

export type CreateDealInput = z.output<typeof createDealInputSchema>;
export type UpdateDealInput = z.output<typeof updateDealInputSchema>;
export type GetDealInput = z.output<typeof getDealInputSchema>;
export type ListDealsInput = z.output<typeof listDealsInputSchema>;
export type SearchDealsInput = z.output<typeof searchDealsInputSchema>;
export type ArchiveDealInput = z.output<typeof archiveDealInputSchema>;
export type DeleteDealInput = z.output<typeof deleteDealInputSchema>;
export type RestoreDealInput = z.output<typeof restoreDealInputSchema>;
export type MergeDealsInput = z.output<typeof mergeDealsInputSchema>;
export type BatchCreateDealsInput = z.output<typeof batchCreateDealsInputSchema>;
export type BatchUpdateDealsInput = z.output<typeof batchUpdateDealsInputSchema>;
export type BatchArchiveDealsInput = z.output<typeof batchArchiveDealsInputSchema>;
export type BatchReadDealsInput = z.output<typeof batchReadDealsInputSchema>;
export type ListPipelinesInput = z.output<typeof listPipelinesInputSchema>;
export type MoveDealStageInput = z.output<typeof moveDealStageInputSchema>;
export type ChangeDealPipelineInput = z.output<typeof changeDealPipelineInputSchema>;
export type SetForecastCategoryInput = z.output<typeof setForecastCategoryInputSchema>;
