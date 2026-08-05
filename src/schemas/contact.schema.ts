import { z } from 'zod';

/**
 * Zod contracts for the Contacts module.
 *
 * These schemas do double duty: they validate input at runtime, and the MCP
 * SDK converts them to the JSON Schema that Copilot Studio's orchestrator
 * reads. Every `.describe()` is therefore written for a model to act on — it
 * states what the field is, what format it takes, and when to use it.
 *
 * The numeric bounds are not decoration. HubSpot rejects a search with more
 * than 5 filter groups, 6 filters per group, or a limit above 200; enforcing
 * that here turns a confusing upstream 400 into a precise, local validation
 * message the agent can correct on its next attempt.
 */

/** HubSpot accepts scalar property values; objects and arrays are rejected upstream. */
export const propertyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const propertyBagSchema = z
  .record(z.string().min(1), propertyValueSchema)
  .describe(
    'HubSpot contact properties as a flat key/value object, e.g. ' +
      '{"email":"jane@acme.com","firstname":"Jane","lastname":"Doe","phone":"+15551234567",' +
      '"company":"Acme","jobtitle":"CTO","lifecyclestage":"lead"}. ' +
      'Use HubSpot internal property names (lowercase). Custom properties are supported.'
  );

export const contactIdSchema = z
  .string()
  .trim()
  .min(1, 'Contact ID must not be empty.')
  .regex(/^\d+$/u, 'A HubSpot contact ID is numeric, e.g. "512".')
  .describe('The numeric HubSpot contact record ID, e.g. "51234567890".');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Must be a valid email address.'))
  .describe('The contact email address, e.g. "jane.doe@acme.com".');

const propertyListSchema = z
  .array(z.string().trim().min(1))
  .max(200, 'Request at most 200 properties at a time.')
  .optional()
  .describe(
    'Specific HubSpot property names to return. Omit for a sensible default set ' +
      '(email, first/last name, phone, company, job title, lifecycle stage, owner, timestamps).'
  );

const associationsInputSchema = z
  .array(
    z.object({
      toObjectType: z
        .enum(['companies', 'deals', 'tickets'])
        .describe('The object type to associate the new contact with.'),
      toObjectId: z
        .string()
        .trim()
        .min(1)
        .describe('The numeric record ID of the object to associate.'),
    })
  )
  .max(100)
  .optional()
  .describe('Records to associate with the contact at creation time.');

// --------------------------------------------------------------------------
// Create / update
// --------------------------------------------------------------------------

export const createContactInputSchema = z.object({
  properties: propertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property. "email" is strongly recommended.',
  }),
  associations: associationsInputSchema,
});

export const updateContactInputSchema = z.object({
  contactId: contactIdSchema,
  properties: propertyBagSchema.refine((properties) => Object.keys(properties).length > 0, {
    message: 'Provide at least one property to update.',
  }),
});

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

export const getContactInputSchema = z.object({
  contactId: contactIdSchema,
  properties: propertyListSchema,
  includeAssociations: z
    .array(
      z.enum(['companies', 'deals', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
    )
    .max(8)
    .optional()
    .describe('Object types whose associated record IDs should be returned alongside the contact.'),
  archived: z
    .boolean()
    .default(false)
    .describe(
      'Set true to read a contact that has been archived (deleted). Archived records remain ' +
        'readable for 90 days. Defaults to false.'
    ),
});

export const getContactByEmailInputSchema = z.object({
  email: emailSchema,
  properties: propertyListSchema,
});

export const listContactsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Number of contacts to return per page (1-100). Defaults to 25.'),
  after: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Pagination cursor returned as "after" by a previous call. Omit for the first page.'),
  properties: propertyListSchema,
  archived: z.boolean().default(false).describe('Set true to list archived (deleted) contacts.'),
});

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

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
    'Comparison operator. EQ/NEQ exact match; LT/LTE/GT/GTE ordering; BETWEEN needs value ' +
      'and highValue; IN/NOT_IN need values[]; HAS_PROPERTY/NOT_HAS_PROPERTY need no value; ' +
      'CONTAINS_TOKEN does word-prefix matching (use * for wildcards).'
  );

const searchFilterSchema = z
  .object({
    propertyName: z
      .string()
      .trim()
      .min(1)
      .describe('HubSpot internal property name to filter on, e.g. "email" or "lifecyclestage".'),
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
  // Catches the operator/argument mismatches that otherwise surface as an
  // opaque HubSpot 400, and tells the agent exactly which field to supply.
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

export const searchContactsInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Free-text search across default searchable contact properties.'),
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
          'Provide "query" for free-text search or at least one filter group. ' +
          'To list all contacts without criteria, use the list tool instead.',
      });
    }
  });

// --------------------------------------------------------------------------
// Destructive operations
// --------------------------------------------------------------------------

export const archiveContactInputSchema = z.object({
  contactId: contactIdSchema,
});

export const deleteContactInputSchema = z.object({
  contactId: contactIdSchema,
  /**
   * A literal-true gate on an irreversible action.
   *
   * An agent can reach this tool from an ambiguous instruction like "get rid
   * of this contact". Requiring an explicit boolean forces the intent to be
   * stated in the tool call itself, where a human reviewing the transcript can
   * see it.
   */
  confirmPermanentDeletion: z
    .literal(true)
    .describe(
      'Must be exactly true. This performs a GDPR-compliant PERMANENT deletion: the contact ' +
        'and its history are unrecoverable, and the email address is added to a blocklist that ' +
        'prevents it being re-added. Use the archive tool instead unless permanent erasure is ' +
        'explicitly required.'
    ),
});

export const restoreContactInputSchema = z.object({
  contactId: contactIdSchema,
  confirmRecreate: z
    .literal(true)
    .describe(
      'Must be exactly true. HubSpot provides no un-archive API, so this recreates the contact ' +
        'from its archived snapshot as a NEW record with a NEW ID. Associations, engagements, ' +
        'and timeline history are NOT restored. For a true restore, use the HubSpot UI recycle ' +
        'bin within 90 days of deletion.'
    ),
  properties: propertyListSchema,
});

export const mergeContactsInputSchema = z
  .object({
    primaryContactId: contactIdSchema.describe(
      'The contact that survives the merge and keeps its ID. Its property values win on conflict.'
    ),
    contactIdToMerge: contactIdSchema.describe(
      'The contact absorbed into the primary. This record ceases to exist as a separate contact.'
    ),
    confirmMerge: z
      .literal(true)
      .describe('Must be exactly true. Merging cannot be undone through the API.'),
  })
  .refine((input) => input.primaryContactId !== input.contactIdToMerge, {
    message: 'A contact cannot be merged into itself.',
    path: ['contactIdToMerge'],
  });

// --------------------------------------------------------------------------
// Batch
// --------------------------------------------------------------------------

/** HubSpot caps batch object endpoints at 100 inputs per request. */
const BATCH_LIMIT = 100;

export const batchCreateContactsInputSchema = z.object({
  contacts: z
    .array(z.object({ properties: propertyBagSchema }))
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 contacts to create in one request.'),
});

export const batchUpdateContactsInputSchema = z.object({
  contacts: z
    .array(z.object({ contactId: contactIdSchema, properties: propertyBagSchema }))
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 contacts to update in one request.'),
});

export const batchArchiveContactsInputSchema = z.object({
  contactIds: z
    .array(contactIdSchema)
    .min(1)
    .max(BATCH_LIMIT, `HubSpot accepts at most ${BATCH_LIMIT} records per batch.`)
    .describe('Up to 100 contact IDs to archive (soft delete, recoverable for 90 days).'),
  confirmArchive: z
    .literal(true)
    .describe('Must be exactly true. Archives every listed contact in a single operation.'),
});

export const batchReadContactsInputSchema = z.object({
  contactIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(BATCH_LIMIT)
    .describe('Up to 100 contact IDs, or email addresses when idProperty is "email".'),
  idProperty: z
    .enum(['id', 'email'])
    .default('id')
    .describe('Whether contactIds contains record IDs or email addresses.'),
  properties: propertyListSchema,
});

// --------------------------------------------------------------------------
// Output schemas
// --------------------------------------------------------------------------

export const contactOutputSchema = z.object({
  id: z.string().describe('The HubSpot contact record ID.'),
  properties: z.record(z.string(), z.string().nullable()).describe('Returned property values.'),
  createdAt: z.string().nullable().describe('ISO 8601 creation timestamp.'),
  updatedAt: z.string().nullable().describe('ISO 8601 last-modified timestamp.'),
  archived: z.boolean().describe('True when the record is archived (deleted).'),
});

export const contactPageOutputSchema = z.object({
  results: z.array(contactOutputSchema),
  after: z
    .string()
    .nullable()
    .describe('Cursor for the next page; null when there are no further results.'),
  total: z.number().nullable().describe('Total matching records, when HubSpot reports it.'),
  count: z.number().describe('Number of records in this page.'),
});

export const batchOutcomeOutputSchema = z.object({
  status: z.enum(['COMPLETE', 'PARTIAL', 'ERROR']),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(contactOutputSchema),
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
  contactId: z.string().nullable(),
  message: z.string().describe('Human-readable outcome, suitable for relaying to a user.'),
});

export type CreateContactInput = z.output<typeof createContactInputSchema>;
export type UpdateContactInput = z.output<typeof updateContactInputSchema>;
export type GetContactInput = z.output<typeof getContactInputSchema>;
export type GetContactByEmailInput = z.output<typeof getContactByEmailInputSchema>;
export type ListContactsInput = z.output<typeof listContactsInputSchema>;
export type SearchContactsInput = z.output<typeof searchContactsInputSchema>;
export type ArchiveContactInput = z.output<typeof archiveContactInputSchema>;
export type DeleteContactInput = z.output<typeof deleteContactInputSchema>;
export type RestoreContactInput = z.output<typeof restoreContactInputSchema>;
export type MergeContactsInput = z.output<typeof mergeContactsInputSchema>;
export type BatchCreateContactsInput = z.output<typeof batchCreateContactsInputSchema>;
export type BatchUpdateContactsInput = z.output<typeof batchUpdateContactsInputSchema>;
export type BatchArchiveContactsInput = z.output<typeof batchArchiveContactsInputSchema>;
export type BatchReadContactsInput = z.output<typeof batchReadContactsInputSchema>;
