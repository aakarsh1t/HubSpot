import { z } from 'zod';

/**
 * The single Zod contract set for the entire CRM surface.
 *
 * These schemas do double duty: they validate input at runtime, and the MCP
 * SDK converts them to the JSON Schema shipped in `tools/list` — which is
 * exactly what Copilot Studio's orchestrator reads on every turn. That makes
 * this file latency-relevant, not just correctness-relevant: every `.describe()`
 * is prompt text the model pays for on each request, so descriptions here are
 * written to be *discriminating* (what this field is, what format, when to use
 * it) rather than exhaustive.
 *
 * One consequence shapes the whole file: object type is a **parameter**, not a
 * tool name. HubSpot's v3/v4 APIs are one generic surface parameterized by
 * object type, the service layer already mirrors that, and a per-object tool
 * per operation multiplies the catalogue — and the orchestrator's per-turn
 * token cost — by three for no added capability.
 *
 * The numeric bounds are not decoration: HubSpot rejects a search with more
 * than 5 filter groups, 6 filters per group, 18 filters total, or a limit above
 * 200, and caps batch endpoints at 100 inputs. Enforcing that here turns a
 * confusing upstream 400 into a precise local message the agent can correct on
 * its next attempt, without spending a HubSpot rate-limit token to learn it.
 */

// --------------------------------------------------------------------------
// Primitives
// --------------------------------------------------------------------------

export const crmObjectTypeSchema = z
  .enum(['contacts', 'companies', 'deals'])
  .describe('Which HubSpot CRM object type to act on.');

export const associableObjectTypeSchema = z
  .enum([
    'contacts',
    'companies',
    'deals',
    'tickets',
    'notes',
    'tasks',
    'calls',
    'meetings',
    'emails',
  ])
  .describe(
    'The object type on the other side of the association. Restricted to pairs with a verified ' +
      'HubSpot-defined association type ID.'
  );

const RECORD_ID_PATTERN = /^\d+$/u;

export const recordIdSchema = z
  .string()
  .trim()
  .min(1, 'Record ID must not be empty.')
  .regex(RECORD_ID_PATTERN, 'A HubSpot record ID is numeric, e.g. "51234567890".')
  .describe('The numeric HubSpot record ID.');

/** HubSpot stores every property as a scalar; objects and arrays are rejected upstream. */
export const propertyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const propertyBagSchema = z
  .record(z.string().min(1), propertyValueSchema)
  .describe(
    'Properties as flat key/value pairs, using HubSpot internal (lowercase) names. ' +
      'contacts: email, firstname, lastname, phone, jobtitle, lifecyclestage. ' +
      'companies: name, domain, industry, city, numberofemployees. ' +
      'deals: dealname, amount, dealstage, pipeline, closedate. Custom properties are supported.'
  );

const propertyListSchema = z
  .array(z.string().trim().min(1))
  .max(200, 'Request at most 200 properties at a time.')
  .optional()
  .describe(
    'Specific property names to return. Omit for a curated default set for the object type.'
  );

/**
 * Response-size control, and the main runtime lever an agent has over its own
 * latency: HubSpot echoes every requested property including the empty ones,
 * and on a typical record more than half come back null. Dropping them by
 * default roughly halves the JSON the orchestrator has to read back.
 */
const includeEmptyPropertiesSchema = z
  .boolean()
  .default(false)
  .describe(
    'Include properties whose value is null or empty. Defaults to false, which keeps responses ' +
      'small; set true only when you must distinguish "empty" from "not returned".'
  );

const paginationCursorSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe('Pagination cursor ("after") returned by a previous call. Omit for the first page.');

const ownerIdSchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, 'HubSpot owner IDs are numeric.')
  .optional()
  .describe('HubSpot owner (user) ID to attribute this to.');

const timestampSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO 8601 date-time, e.g. "2026-08-05T14:30:00Z".',
  })
  .optional()
  .describe('ISO 8601 date-time. Defaults to now.');

const associationsOnCreateSchema = z
  .array(
    z.object({
      toObjectType: z
        .enum(['contacts', 'companies', 'deals', 'tickets'])
        .describe('Object type to associate the new record with.'),
      toObjectId: recordIdSchema.describe('Record ID to associate.'),
    })
  )
  .max(100)
  .optional()
  .describe('Records to associate with the new record in the same request.');

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

export const getRecordInputSchema = z
  .object({
    objectType: crmObjectTypeSchema,
    recordId: z
      .string()
      .trim()
      .min(1)
      .describe(
        'The record ID, or — when idProperty is set — the value of that unique property ' +
          '(e.g. an email address).'
      ),
    idProperty: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Look the record up by a unique property instead of its ID. Use "email" to fetch a ' +
          'contact by email address. Omit to treat recordId as the numeric record ID.'
      ),
    properties: propertyListSchema,
    includeAssociations: z
      .array(associableObjectTypeSchema)
      .max(9)
      .optional()
      .describe(
        'Object types whose associated record IDs should be returned alongside the record.'
      ),
    archived: z
      .boolean()
      .default(false)
      .describe(
        'Read an archived (deleted) record. Archived records stay readable for 90 days. ' +
          'Not compatible with idProperty.'
      ),
    includeEmptyProperties: includeEmptyPropertiesSchema,
  })
  .superRefine((input, ctx) => {
    if (input.idProperty === undefined && !RECORD_ID_PATTERN.test(input.recordId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['recordId'],
        message:
          'A HubSpot record ID is numeric. To look a record up by email or another unique ' +
          'property, set idProperty (e.g. idProperty: "email").',
      });
    }

    if (input.idProperty !== undefined && input.archived) {
      ctx.addIssue({
        code: 'custom',
        path: ['archived'],
        message: 'Archived records can only be read by record ID, not by a unique property.',
      });
    }
  });

/** HubSpot's documented CRM search operators. */
export const searchOperatorSchema = z
  .enum([
    'EQ',
    'NEQ',
    'LT',
    'LTE',
    'GT',
    'GTE',
    'BETWEEN',
    'IN',
    'NOT_IN',
    'HAS_PROPERTY',
    'NOT_HAS_PROPERTY',
    'CONTAINS_TOKEN',
    'NOT_CONTAINS_TOKEN',
  ])
  .describe(
    'EQ/NEQ exact match; LT/LTE/GT/GTE ordering; BETWEEN needs value and highValue; ' +
      'IN/NOT_IN need values[]; HAS_PROPERTY/NOT_HAS_PROPERTY need no value; CONTAINS_TOKEN ' +
      'does word-prefix matching (use * for wildcards).'
  );

const searchFilterSchema = z
  .object({
    propertyName: z
      .string()
      .trim()
      .min(1)
      .describe('HubSpot internal property name to filter on, e.g. "lifecyclestage".'),
    operator: searchOperatorSchema,
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .describe(
        'Comparison value. Required for every operator except IN/NOT_IN and HAS_PROPERTY/NOT_HAS_PROPERTY.'
      ),
    values: z
      .array(z.union([z.string(), z.number()]))
      .max(100)
      .optional()
      .describe('Value list for IN and NOT_IN.'),
    highValue: z.union([z.string(), z.number()]).optional().describe('Upper bound for BETWEEN.'),
  })
  // Catches the operator/argument mismatches that otherwise surface as an
  // opaque HubSpot 400, and names the exact field to supply.
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

/**
 * Search *and* list in one contract.
 *
 * With no `query` and no `filterGroups` this is a plain paged listing, and the
 * tool routes it to HubSpot's list endpoint rather than the search endpoint —
 * which is both cheaper and sits in a separate, more generous rate-limit
 * bucket. That routing is why a separate list tool buys nothing.
 */
export const searchRecordsInputSchema = z
  .object({
    objectType: crmObjectTypeSchema,
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Free-text search across the default searchable properties for the object type.'),
    filterGroups: z
      .array(
        z.object({
          filters: z
            .array(searchFilterSchema)
            .min(1)
            .max(6, 'HubSpot allows at most 6 filters per group.')
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
      .describe(
        'Results per page (1-200, or 1-100 when listing without criteria). Defaults to 25.'
      ),
    after: paginationCursorSchema,
    archived: z
      .boolean()
      .default(false)
      .describe('List archived (deleted) records. Only valid without query/filterGroups.'),
    includeEmptyProperties: includeEmptyPropertiesSchema,
  })
  .superRefine((input, ctx) => {
    const groups = input.filterGroups ?? [];
    const totalFilters = groups.reduce((sum, group) => sum + group.filters.length, 0);

    if (totalFilters > 18) {
      ctx.addIssue({
        code: 'custom',
        path: ['filterGroups'],
        message: `HubSpot allows at most 18 filters in total; received ${totalFilters}.`,
      });
    }

    const isListing = input.query === undefined && groups.length === 0;

    if (isListing && input.limit > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['limit'],
        message:
          "HubSpot's list endpoint caps limit at 100. Supply a query or filterGroups to use the " +
          'search endpoint, which allows up to 200.',
      });
    }

    if (!isListing && input.archived) {
      ctx.addIssue({
        code: 'custom',
        path: ['archived'],
        message:
          'HubSpot search cannot filter on archived records. Omit query/filterGroups to list ' +
          'archived records instead.',
      });
    }
  });

// --------------------------------------------------------------------------
// Write
// --------------------------------------------------------------------------

export const createRecordInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  properties: propertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message:
      'Provide at least one property (contacts: email; companies: name or domain; deals: dealname).',
  }),
  associations: associationsOnCreateSchema,
  includeEmptyProperties: includeEmptyPropertiesSchema,
});

export const updateRecordInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  recordId: recordIdSchema,
  properties: propertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property to update.',
  }),
  includeEmptyProperties: includeEmptyPropertiesSchema,
});

// --------------------------------------------------------------------------
// Destructive
// --------------------------------------------------------------------------

export const deleteRecordInputSchema = z
  .object({
    objectType: crmObjectTypeSchema,
    recordId: recordIdSchema,
    mode: z
      .enum(['archive', 'permanent'])
      .default('archive')
      .describe(
        'archive = soft delete, recoverable from the HubSpot recycle bin for 90 days (the ' +
          'default, and what "delete this record" normally means). permanent = irreversible ' +
          'GDPR erasure of the record and its history.'
      ),
    confirmPermanentDeletion: z
      .literal(true)
      .optional()
      .describe('Required, and must be exactly true, when mode is "permanent".'),
  })
  // A literal-true gate on the irreversible path only. An agent can reach this
  // tool from an instruction as loose as "get rid of this record"; requiring
  // the flag puts the intent in the tool call itself, where a human reviewing
  // the transcript can see it. Archiving is recoverable, so it is not gated —
  // gating a reversible action just trains the model to set every flag.
  .superRefine((input, ctx) => {
    if (input.mode === 'permanent' && input.confirmPermanentDeletion !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPermanentDeletion'],
        message:
          'Permanent deletion is irreversible and requires confirmPermanentDeletion: true. ' +
          'Use mode "archive" unless permanent erasure was explicitly requested.',
      });
    }
  });

export const restoreRecordInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  recordId: recordIdSchema,
  confirmRecreate: z
    .literal(true)
    .describe(
      'Must be exactly true. HubSpot has no un-archive API, so this recreates the record from ' +
        'its archived snapshot as a NEW record with a NEW ID; associations, engagements, and ' +
        'timeline history are NOT restored. For a true in-place restore, use the HubSpot UI ' +
        'recycle bin within 90 days.'
    ),
  properties: propertyListSchema,
});

export const mergeRecordsInputSchema = z
  .object({
    objectType: crmObjectTypeSchema,
    primaryRecordId: recordIdSchema.describe(
      'The record that survives the merge and keeps its ID. Its values win on conflict.'
    ),
    recordIdToMerge: recordIdSchema.describe(
      'The record absorbed into the primary. It ceases to exist separately.'
    ),
    confirmMerge: z
      .literal(true)
      .describe('Must be exactly true. Merging cannot be undone through the API.'),
  })
  .refine((input) => input.primaryRecordId !== input.recordIdToMerge, {
    message: 'A record cannot be merged into itself.',
    path: ['recordIdToMerge'],
  });

// --------------------------------------------------------------------------
// Batch
// --------------------------------------------------------------------------

/** HubSpot caps batch object endpoints at 100 inputs per request. */
const BATCH_LIMIT = 100;

export const batchRecordsInputSchema = z
  .object({
    objectType: crmObjectTypeSchema,
    operation: z
      .enum(['create', 'read', 'update', 'archive'])
      .describe(
        'create needs records[].properties; update needs records[].recordId + properties; ' +
          'read and archive need recordIds[].'
      ),
    records: z
      .array(
        z.object({
          recordId: recordIdSchema.optional().describe('Required for update, ignored for create.'),
          properties: propertyBagSchema,
        })
      )
      .min(1)
      .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
      .optional()
      .describe('Records to create or update. Up to 100 per call.'),
    recordIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
      .optional()
      .describe(
        'Record IDs to read or archive — or unique property values when idProperty is set. Up to 100.'
      ),
    idProperty: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('For read: treat recordIds as values of this unique property, e.g. "email".'),
    properties: propertyListSchema,
    confirmArchive: z
      .literal(true)
      .optional()
      .describe('Required, and must be exactly true, when operation is "archive".'),
    includeEmptyProperties: includeEmptyPropertiesSchema,
  })
  .superRefine((input, ctx) => {
    const needsRecords = input.operation === 'create' || input.operation === 'update';

    if (needsRecords && (input.records === undefined || input.records.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['records'],
        message: `The "${input.operation}" operation requires a non-empty records array.`,
      });
    }

    if (!needsRecords && (input.recordIds === undefined || input.recordIds.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['recordIds'],
        message: `The "${input.operation}" operation requires a non-empty recordIds array.`,
      });
    }

    if (input.operation === 'update') {
      const missing = (input.records ?? []).findIndex((record) => record.recordId === undefined);
      if (missing >= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['records', missing, 'recordId'],
          message: 'Every record in a batch update must carry its recordId.',
        });
      }
    }

    // Archiving 100 records in one call is the single highest-blast-radius
    // operation in the catalogue, and unlike a single archive it is tedious to
    // undo one record at a time — hence the explicit gate.
    if (input.operation === 'archive' && input.confirmArchive !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmArchive'],
        message: 'Batch archive requires confirmArchive: true.',
      });
    }
  });

// --------------------------------------------------------------------------
// Associations
// --------------------------------------------------------------------------

export const manageAssociationsInputSchema = z
  .object({
    action: z
      .enum(['list', 'create', 'delete'])
      .describe('list = read associated records; create = link two records; delete = unlink them.'),
    objectType: crmObjectTypeSchema.describe('Object type of the record you are working from.'),
    recordId: recordIdSchema.describe('Record ID you are working from.'),
    toObjectType: associableObjectTypeSchema,
    toObjectId: recordIdSchema
      .optional()
      .describe('The record on the other side. Required for create and delete.'),
    associationTypeId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Custom (labelled) association type ID, for create only. Omit to use the ' +
          'HubSpot-defined default for this object pair.'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe('For list: maximum associations to return (1-500). Defaults to 100.'),
    after: paginationCursorSchema,
  })
  .superRefine((input, ctx) => {
    if (input.action !== 'list' && input.toObjectId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['toObjectId'],
        message: `The "${input.action}" action requires toObjectId.`,
      });
    }
  });

// --------------------------------------------------------------------------
// Engagements
// --------------------------------------------------------------------------

export const noteBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Note body must not be empty.')
    .max(65_536)
    .describe('The note text. Supports basic HTML.'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

export const taskBodySchema = z.object({
  subject: z.string().trim().min(1).max(500).describe('Task title, e.g. "Follow up on pricing".'),
  body: z.string().trim().max(65_536).optional().describe('Task detail.'),
  status: z.enum(['NOT_STARTED', 'COMPLETED']).default('NOT_STARTED'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  taskType: z.enum(['EMAIL', 'CALL', 'TODO']).default('TODO'),
  dueDate: timestampSchema.describe('ISO 8601 due date. Defaults to now.'),
  ownerId: ownerIdSchema,
});

export const callBodySchema = z.object({
  title: z.string().trim().min(1).max(500).describe('Call title, e.g. "Discovery call".'),
  body: z.string().trim().max(65_536).optional().describe('Call notes.'),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(86_400_000)
    .optional()
    .describe('Call duration in milliseconds — HubSpot stores durations in ms, not seconds.'),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('OUTBOUND'),
  status: z
    .enum([
      'BUSY',
      'CALLING_CRM_USER',
      'CANCELED',
      'COMPLETED',
      'CONNECTING',
      'FAILED',
      'IN_PROGRESS',
      'NO_ANSWER',
      'QUEUED',
      'RINGING',
    ])
    .default('COMPLETED'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

export const meetingBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500).describe('Meeting title.'),
    body: z.string().trim().max(65_536).optional().describe('Agenda or description.'),
    startTime: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'Must be a valid ISO 8601 date-time.',
      })
      .describe('ISO 8601 meeting start time.'),
    endTime: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'Must be a valid ISO 8601 date-time.',
      })
      .describe('ISO 8601 meeting end time.'),
    location: z.string().trim().max(500).optional().describe('Physical or virtual location.'),
    outcome: z
      .enum(['SCHEDULED', 'COMPLETED', 'RESCHEDULED', 'NO_SHOW', 'CANCELED'])
      .default('SCHEDULED'),
    ownerId: ownerIdSchema,
  })
  .refine((body) => Date.parse(body.endTime) > Date.parse(body.startTime), {
    message: 'endTime must be after startTime.',
    path: ['endTime'],
  });

export const emailBodySchema = z.object({
  subject: z.string().trim().min(1).max(998).describe('Email subject line.'),
  body: z.string().trim().max(65_536).describe('Plain-text email body.'),
  direction: z
    .enum(['EMAIL', 'INCOMING_EMAIL', 'FORWARDED_EMAIL'])
    .default('EMAIL')
    .describe(
      'EMAIL = sent from the CRM or logged via BCC; INCOMING_EMAIL = a reply received; ' +
        'FORWARDED_EMAIL = forwarded into the CRM.'
    ),
  status: z.enum(['BOUNCED', 'FAILED', 'SCHEDULED', 'SENDING', 'SENT']).default('SENT'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

/**
 * The engagement payload is nested per type rather than flattened into one
 * object of all-optional fields. Flattening would make `subject`, `title`, and
 * `body` mean different things depending on a sibling enum — the shape most
 * likely to produce a plausible-looking call that HubSpot rejects. Nesting
 * makes the required fields for the chosen type structurally obvious in the
 * JSON Schema the orchestrator reads.
 */
export const createEngagementInputSchema = z
  .object({
    objectType: crmObjectTypeSchema.describe('Object type of the record to log the activity on.'),
    recordId: recordIdSchema.describe('Record the activity is logged against.'),
    engagementType: z
      .enum(['note', 'task', 'call', 'meeting', 'email'])
      .describe('Which activity to create. Supply the matching payload field below.'),
    note: noteBodySchema.optional(),
    task: taskBodySchema.optional(),
    call: callBodySchema.optional(),
    meeting: meetingBodySchema.optional(),
    email: emailBodySchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input[input.engagementType] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [input.engagementType],
        message: `engagementType "${input.engagementType}" requires the "${input.engagementType}" payload object.`,
      });
    }
  });

export const getTimelineInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  recordId: recordIdSchema,
  types: z
    .array(z.enum(['notes', 'tasks', 'calls', 'meetings', 'emails']))
    .min(1)
    .max(5)
    .default(['notes', 'tasks', 'calls', 'meetings', 'emails'])
    .describe('Activity types to include. Narrow this to cut latency — each type is a round trip.'),
  limitPerType: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum activities per type before merging (1-100). Defaults to 20.'),
});

// --------------------------------------------------------------------------
// Property (schema) administration
// --------------------------------------------------------------------------

const propertyNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[a-z][a-z0-9_]*$/u,
    'HubSpot internal property names are lowercase snake_case, e.g. "renewal_risk".'
  )
  .describe('The internal property name (lowercase), not the display label.');

const propertyOptionSchema = z.object({
  label: z.string().trim().min(1).describe('Option label shown in the HubSpot UI.'),
  value: z.string().trim().min(1).describe('The stored value for this option.'),
  hidden: z.boolean().optional().describe('Hide from the picker without deleting.'),
  displayOrder: z.number().int().optional().describe('Position in the picker; lower shows first.'),
});

export const managePropertiesInputSchema = z
  .object({
    action: z
      .enum(['list', 'get', 'create', 'update', 'delete', 'history'])
      .describe(
        'list/get read property definitions; create/update/delete change the portal schema ' +
          '(admin); history reads the value trail of properties on one record.'
      ),
    objectType: crmObjectTypeSchema,
    propertyName: propertyNameSchema
      .optional()
      .describe('Required for get, create, update, and delete.'),
    label: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe('Display label. Required on create.'),
    type: z
      .enum(['string', 'number', 'date', 'datetime', 'bool', 'enumeration'])
      .optional()
      .describe('Underlying data type. Required on create.'),
    fieldType: z
      .enum([
        'text',
        'textarea',
        'number',
        'select',
        'radio',
        'checkbox',
        'booleancheckbox',
        'date',
        'phonenumber',
      ])
      .optional()
      .describe(
        'Input widget, which must suit the type ("select" needs type "enumeration"). Required on create.'
      ),
    groupName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Existing property group to file this under, e.g. "contactinformation". Required on create.'
      ),
    description: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Help text shown under the field.'),
    options: z
      .array(propertyOptionSchema)
      .max(1000)
      .optional()
      .describe(
        'Selectable values for an enumeration property. On update this REPLACES the full list — ' +
          'include every option you want to keep.'
      ),
    hidden: z.boolean().optional().describe('For update: hide the property from forms and views.'),
    recordId: recordIdSchema.optional().describe('For history: the record to read history for.'),
    propertyNames: z
      .array(propertyNameSchema)
      .min(1)
      .max(50)
      .optional()
      .describe('For history: which properties to trace, e.g. ["dealstage", "amount"].'),
    confirmDeletion: z
      .literal(true)
      .optional()
      .describe('Required, and must be exactly true, when action is "delete".'),
  })
  .superRefine((input, ctx) => {
    const needsName =
      input.action === 'get' ||
      input.action === 'create' ||
      input.action === 'update' ||
      input.action === 'delete';

    if (needsName && input.propertyName === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['propertyName'],
        message: `The "${input.action}" action requires propertyName.`,
      });
    }

    if (input.action === 'create') {
      for (const field of ['label', 'type', 'fieldType', 'groupName'] as const) {
        if (input[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `Creating a property requires ${field}.`,
          });
        }
      }

      if (input.type === 'enumeration' && (input.options ?? []).length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'An enumeration property requires at least one option.',
        });
      }
    }

    if (input.action === 'history') {
      if (input.recordId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['recordId'],
          message: 'Reading property history requires recordId.',
        });
      }
      if (input.propertyNames === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['propertyNames'],
          message: 'Reading property history requires propertyNames.',
        });
      }
    }

    // HubSpot exposes no way to restore a deleted property definition, or the
    // values it held on existing records. That is unrecoverable data loss
    // across every record of the object type, so it is gated.
    if (input.action === 'delete' && input.confirmDeletion !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmDeletion'],
        message:
          'Deleting a property definition is irreversible and destroys its values on every ' +
          'record of this object type. It requires confirmDeletion: true.',
      });
    }
  });

export const listPipelinesInputSchema = z.object({
  objectType: z
    .enum(['deals', 'tickets'])
    .default('deals')
    .describe('Which object type to list pipelines for.'),
});

// --------------------------------------------------------------------------
// Output contracts
//
// Deliberately lean. Output schemas ride along in `tools/list` on every turn,
// so an exhaustively-described output contract is paid for on every request
// while adding nothing to tool selection — the orchestrator picks a tool from
// its inputs and description, not from the shape of its result.
// --------------------------------------------------------------------------

export const recordOutputSchema = z.object({
  id: z.string(),
  properties: z.record(z.string(), z.string().nullable()),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  archived: z.boolean(),
  associations: z.record(z.string(), z.array(z.string())).optional(),
});

export const recordPageOutputSchema = z.object({
  objectType: z.string(),
  results: z.array(recordOutputSchema),
  count: z.number(),
  after: z.string().nullable().describe('Cursor for the next page; null when there are no more.'),
  total: z.number().nullable(),
});

export const batchOutcomeOutputSchema = z.object({
  objectType: z.string(),
  operation: z.string(),
  status: z.enum(['COMPLETE', 'PARTIAL', 'ERROR']),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(recordOutputSchema),
  errors: z.array(
    z.object({
      message: z.string(),
      category: z.string().nullable(),
      context: z.record(z.string(), z.unknown()).nullable(),
    })
  ),
});

export const operationResultSchema = z.object({
  success: z.boolean(),
  objectType: z.string(),
  recordId: z.string().nullable(),
  message: z.string().describe('Human-readable outcome, suitable for relaying to a user.'),
});

export const associationResultSchema = z.object({
  action: z.string(),
  objectType: z.string(),
  recordId: z.string(),
  toObjectType: z.string(),
  results: z
    .array(
      z.object({
        toObjectId: z.string(),
        associationTypes: z.array(
          z.object({ category: z.string(), typeId: z.number(), label: z.string().nullable() })
        ),
      })
    )
    .optional(),
  count: z.number().optional(),
  after: z.string().nullable().optional(),
  success: z.boolean().optional(),
  message: z.string(),
});

export const engagementOutputSchema = z.object({
  success: z.boolean(),
  engagementId: z.string(),
  engagementType: z.string(),
  objectType: z.string(),
  recordId: z.string(),
  timestamp: z.string().nullable(),
  message: z.string(),
});

export const timelineOutputSchema = z.object({
  objectType: z.string(),
  recordId: z.string(),
  entries: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      timestamp: z.string().nullable(),
      title: z.string().nullable(),
      body: z.string().nullable(),
      ownerId: z.string().nullable(),
      details: z.record(z.string(), z.string().nullable()),
    })
  ),
  count: z.number(),
  countsByType: z.record(z.string(), z.number()),
  truncated: z
    .boolean()
    .describe('True when a type returned the maximum requested, meaning more activities exist.'),
});

export const propertyResultSchema = z.object({
  action: z.string(),
  objectType: z.string(),
  properties: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.string(),
        fieldType: z.string(),
        groupName: z.string().nullable(),
        description: z.string().nullable(),
        options: z.array(
          z.object({
            label: z.string(),
            value: z.string(),
            hidden: z.boolean().optional(),
            displayOrder: z.number().optional(),
          })
        ),
        hidden: z.boolean(),
        hasUniqueValue: z.boolean(),
        calculated: z.boolean(),
      })
    )
    .optional(),
  count: z.number().optional(),
  history: z
    .record(
      z.string(),
      z.array(
        z.object({
          value: z.string().nullable(),
          timestamp: z.string().nullable(),
          sourceType: z.string().nullable(),
          sourceId: z.string().nullable(),
          sourceLabel: z.string().nullable(),
          updatedByUserId: z.number().nullable(),
        })
      )
    )
    .optional(),
  success: z.boolean().optional(),
  message: z.string(),
});

export const pipelinesOutputSchema = z.object({
  objectType: z.string(),
  pipelines: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      displayOrder: z.number(),
      stages: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          displayOrder: z.number(),
          probability: z.number().nullable(),
          isClosed: z.boolean(),
        })
      ),
    })
  ),
  count: z.number(),
});

// --------------------------------------------------------------------------
// Inferred input types
// --------------------------------------------------------------------------

export type GetRecordInput = z.output<typeof getRecordInputSchema>;
export type SearchRecordsInput = z.output<typeof searchRecordsInputSchema>;
export type CreateRecordInput = z.output<typeof createRecordInputSchema>;
export type UpdateRecordInput = z.output<typeof updateRecordInputSchema>;
export type DeleteRecordInput = z.output<typeof deleteRecordInputSchema>;
export type RestoreRecordInput = z.output<typeof restoreRecordInputSchema>;
export type MergeRecordsInput = z.output<typeof mergeRecordsInputSchema>;
export type BatchRecordsInput = z.output<typeof batchRecordsInputSchema>;
export type ManageAssociationsInput = z.output<typeof manageAssociationsInputSchema>;
export type CreateEngagementInput = z.output<typeof createEngagementInputSchema>;
export type GetTimelineInput = z.output<typeof getTimelineInputSchema>;
export type ManagePropertiesInput = z.output<typeof managePropertiesInputSchema>;
export type ListPipelinesInput = z.output<typeof listPipelinesInputSchema>;

export type NoteBody = z.output<typeof noteBodySchema>;
export type TaskBody = z.output<typeof taskBodySchema>;
export type CallBody = z.output<typeof callBodySchema>;
export type MeetingBody = z.output<typeof meetingBodySchema>;
export type EmailBody = z.output<typeof emailBodySchema>;
