import { z } from 'zod';
import { propertyBagSchema, searchOperatorSchema } from './contact.schema.js';

/**
 * Zod contracts for the Companies module.
 *
 * Structurally these mirror the Contacts schemas closely, because HubSpot's
 * v3 Objects API is itself one generic surface — the same operators, batch
 * limits, and pagination rules apply. `propertyBagSchema` and
 * `searchOperatorSchema` are imported and reused rather than redefined, per
 * the same reasoning that produced `CrmObjectService`: one validated
 * definition, not three copies that could quietly drift apart.
 *
 * What genuinely differs from Contacts: there is no reliable alternate-key
 * lookup. HubSpot's `idProperty=domain` single-object GET is
 * community-reported as unreliable (many companies have no domain, and
 * uniqueness is not enforced the way email is for contacts), so this module
 * intentionally has no `getCompanyByDomain` tool — `hubspot_search_companies`
 * with a `domain` filter is the reliable way to do the same lookup.
 */

export const companyIdSchema = z
  .string()
  .trim()
  .min(1, 'Company ID must not be empty.')
  .regex(/^\d+$/u, 'A HubSpot company ID is numeric, e.g. "7801".')
  .describe('The numeric HubSpot company record ID, e.g. "7801234567".');

const propertyListSchema = z
  .array(z.string().trim().min(1))
  .max(200, 'Request at most 200 properties at a time.')
  .optional()
  .describe(
    'Specific HubSpot property names to return. Omit for a sensible default set ' +
      '(name, domain, website, industry, location, size, revenue, lifecycle stage, owner, timestamps).'
  );

const companyPropertyBagSchema = propertyBagSchema.describe(
  'HubSpot company properties as a flat key/value object, e.g. ' +
    '{"name":"Acme Corp","domain":"acme.com","industry":"SOFTWARE","numberofemployees":250,' +
    '"city":"Austin","state":"TX","lifecyclestage":"customer"}. ' +
    'Use HubSpot internal property names (lowercase). Custom properties are supported.'
);

const associationsInputSchema = z
  .array(
    z.object({
      toObjectType: z
        .enum(['contacts', 'deals', 'tickets'])
        .describe('The object type to associate the new company with.'),
      toObjectId: z
        .string()
        .trim()
        .min(1)
        .describe('The numeric record ID of the object to associate.'),
    })
  )
  .max(100)
  .optional()
  .describe('Records to associate with the company at creation time.');

// --------------------------------------------------------------------------
// Create / update
// --------------------------------------------------------------------------

export const createCompanyInputSchema = z.object({
  properties: companyPropertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property. "name" is strongly recommended.',
  }),
  associations: associationsInputSchema,
});

export const updateCompanyInputSchema = z.object({
  companyId: companyIdSchema,
  properties: companyPropertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property to update.',
  }),
});

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

export const getCompanyInputSchema = z.object({
  companyId: companyIdSchema,
  properties: propertyListSchema,
  includeAssociations: z
    .array(
      z.enum(['contacts', 'deals', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
    )
    .max(8)
    .optional()
    .describe('Object types whose associated record IDs should be returned alongside the company.'),
  archived: z
    .boolean()
    .default(false)
    .describe(
      'Set true to read a company that has been archived (deleted). Archived records remain ' +
        'readable for 90 days. Defaults to false.'
    ),
});

export const listCompaniesInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Number of companies to return per page (1-100). Defaults to 25.'),
  after: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Pagination cursor returned as "after" by a previous call. Omit for the first page.'),
  properties: propertyListSchema,
  archived: z.boolean().default(false).describe('Set true to list archived (deleted) companies.'),
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
      .describe('HubSpot internal property name to filter on, e.g. "domain" or "industry".'),
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
      .describe('Upper bound for the BETWEEN operator.'),
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

export const searchCompaniesInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Free-text search across default searchable company properties (name, domain, website, phone).'
      ),
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
      .describe(
        'Filter groups are combined with OR; filters inside a group with AND. Use this with a ' +
          '"domain" EQ filter for a reliable company lookup by domain.'
      ),
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
          'Provide "query" for free-text search or at least one filter group — for example a ' +
          '"domain" EQ filter to find a company by domain. To list all companies without ' +
          'criteria, use the list tool instead.',
      });
    }
  });

// --------------------------------------------------------------------------
// Destructive operations
// --------------------------------------------------------------------------

export const archiveCompanyInputSchema = z.object({ companyId: companyIdSchema });

export const deleteCompanyInputSchema = z.object({
  companyId: companyIdSchema,
  confirmPermanentDeletion: z
    .literal(true)
    .describe(
      'Must be exactly true. This performs a GDPR-compliant PERMANENT deletion: the company ' +
        'and its history are unrecoverable. Use the archive tool instead unless permanent ' +
        'erasure is explicitly required.'
    ),
});

export const restoreCompanyInputSchema = z.object({
  companyId: companyIdSchema,
  confirmRecreate: z
    .literal(true)
    .describe(
      'Must be exactly true. HubSpot provides no un-archive API, so this recreates the company ' +
        'from its archived snapshot as a NEW record with a NEW ID. Associations, engagements, ' +
        'and timeline history are NOT restored. For a true restore, use the HubSpot UI recycle ' +
        'bin within 90 days of deletion.'
    ),
  properties: propertyListSchema,
});

export const mergeCompaniesInputSchema = z
  .object({
    primaryCompanyId: companyIdSchema.describe(
      'The company that survives the merge and keeps its ID. Its property values win on conflict.'
    ),
    companyIdToMerge: companyIdSchema.describe(
      'The company absorbed into the primary. This record ceases to exist as a separate company.'
    ),
    confirmMerge: z
      .literal(true)
      .describe('Must be exactly true. Merging cannot be undone through the API.'),
  })
  .refine((input) => input.primaryCompanyId !== input.companyIdToMerge, {
    message: 'A company cannot be merged into itself.',
    path: ['companyIdToMerge'],
  });

// --------------------------------------------------------------------------
// Batch
// --------------------------------------------------------------------------

const BATCH_LIMIT = 100;

export const batchCreateCompaniesInputSchema = z.object({
  companies: z
    .array(z.object({ properties: companyPropertyBagSchema }))
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 companies to create in one request.'),
});

export const batchUpdateCompaniesInputSchema = z.object({
  companies: z
    .array(z.object({ companyId: companyIdSchema, properties: companyPropertyBagSchema }))
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 companies to update in one request.'),
});

export const batchArchiveCompaniesInputSchema = z.object({
  companyIds: z
    .array(companyIdSchema)
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 company IDs to archive (soft delete, recoverable for 90 days).'),
  confirmArchive: z
    .literal(true)
    .describe('Must be exactly true. Archives every listed company in a single operation.'),
});

export const batchReadCompaniesInputSchema = z.object({
  companyIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(BATCH_LIMIT)
    .describe('Up to 100 company record IDs.'),
  properties: propertyListSchema,
});

// --------------------------------------------------------------------------
// Output schemas
// --------------------------------------------------------------------------

export const companyOutputSchema = z.object({
  id: z.string().describe('The HubSpot company record ID.'),
  properties: z.record(z.string(), z.string().nullable()).describe('Returned property values.'),
  createdAt: z.string().nullable().describe('ISO 8601 creation timestamp.'),
  updatedAt: z.string().nullable().describe('ISO 8601 last-modified timestamp.'),
  archived: z.boolean().describe('True when the record is archived (deleted).'),
});

export const companyPageOutputSchema = z.object({
  results: z.array(companyOutputSchema),
  after: z
    .string()
    .nullable()
    .describe('Cursor for the next page; null when there are no further results.'),
  total: z.number().nullable().describe('Total matching records, when HubSpot reports it.'),
  count: z.number().describe('Number of records in this page.'),
});

export const companyBatchOutcomeOutputSchema = z.object({
  status: z.enum(['COMPLETE', 'PARTIAL', 'ERROR']),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(companyOutputSchema),
  errors: z.array(
    z.object({
      message: z.string(),
      category: z.string().nullable(),
      context: z.record(z.string(), z.unknown()).nullable(),
    })
  ),
});

export const companyOperationResultSchema = z.object({
  success: z.boolean(),
  companyId: z.string().nullable(),
  message: z.string().describe('Human-readable outcome, suitable for relaying to a user.'),
});

export type CreateCompanyInput = z.output<typeof createCompanyInputSchema>;
export type UpdateCompanyInput = z.output<typeof updateCompanyInputSchema>;
export type GetCompanyInput = z.output<typeof getCompanyInputSchema>;
export type ListCompaniesInput = z.output<typeof listCompaniesInputSchema>;
export type SearchCompaniesInput = z.output<typeof searchCompaniesInputSchema>;
export type ArchiveCompanyInput = z.output<typeof archiveCompanyInputSchema>;
export type DeleteCompanyInput = z.output<typeof deleteCompanyInputSchema>;
export type RestoreCompanyInput = z.output<typeof restoreCompanyInputSchema>;
export type MergeCompaniesInput = z.output<typeof mergeCompaniesInputSchema>;
export type BatchCreateCompaniesInput = z.output<typeof batchCreateCompaniesInputSchema>;
export type BatchUpdateCompaniesInput = z.output<typeof batchUpdateCompaniesInputSchema>;
export type BatchArchiveCompaniesInput = z.output<typeof batchArchiveCompaniesInputSchema>;
export type BatchReadCompaniesInput = z.output<typeof batchReadCompaniesInputSchema>;
