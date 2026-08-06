import { z } from 'zod';

/**
 * Zod contracts for custom property (schema) management and property-value
 * history, shared across contacts, companies, and deals.
 *
 * Unlike engagements and associations — where a `contactId`-named field beats
 * a generic `objectId` for agent clarity on frequent, hot-path operations —
 * property management is a comparatively rare, advanced operation. Tripling
 * these six tools per object type would add eighteen catalogue entries for a
 * niche feature; one explicit `objectType` enum parameter is the better
 * trade-off here.
 */

export const crmObjectTypeSchema = z
  .enum(['contacts', 'companies', 'deals'])
  .describe('Which CRM object type this property belongs to.');

const propertyNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[a-z][a-z0-9_]*$/u,
    'HubSpot internal property names are lowercase snake_case, e.g. "renewal_risk".'
  )
  .describe(
    'The internal HubSpot property name (lowercase, e.g. "renewal_risk"), not the display label.'
  );

const propertyOptionSchema = z.object({
  label: z.string().trim().min(1).describe('Human-readable option label shown in the HubSpot UI.'),
  value: z.string().trim().min(1).describe('The stored value for this option.'),
  hidden: z.boolean().optional().describe('Hide this option from the picker without deleting it.'),
  displayOrder: z.number().int().optional().describe('Position in the picker; lower shows first.'),
});

export const listPropertiesInputSchema = z.object({
  objectType: crmObjectTypeSchema,
});

export const getPropertyInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  propertyName: propertyNameSchema,
});

export const createPropertyInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  name: propertyNameSchema,
  label: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe('Human-readable label shown in the HubSpot UI.'),
  type: z
    .enum(['string', 'number', 'date', 'datetime', 'bool', 'enumeration'])
    .describe('The underlying data type HubSpot stores.'),
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
    .describe(
      'The input widget shown in the HubSpot UI. Must be compatible with type, e.g. "select" needs type "enumeration".'
    ),
  groupName: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The property group this appears under in HubSpot, e.g. "contactinformation". Must be an ' +
        'existing group in the portal.'
    ),
  description: z.string().trim().max(1000).optional().describe('Help text shown under the field.'),
  options: z
    .array(propertyOptionSchema)
    .max(1000)
    .optional()
    .describe('Required when type is "enumeration": the list of selectable values.'),
});

export const updatePropertyInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  propertyName: propertyNameSchema,
  label: z.string().trim().min(1).max(255).optional().describe('New human-readable label.'),
  description: z.string().trim().max(1000).optional().describe('New help text.'),
  options: z
    .array(propertyOptionSchema)
    .max(1000)
    .optional()
    .describe(
      'Replaces the FULL option list for an enumeration property — this is not a merge, so ' +
        'include every option you want to keep, not just the ones you are adding.'
    ),
  hidden: z.boolean().optional().describe('Hide this property from HubSpot forms and views.'),
});

export const deletePropertyInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  propertyName: propertyNameSchema,
  confirmDeletion: z
    .literal(true)
    .describe(
      'Must be exactly true. Deleting a property definition is irreversible through this API: ' +
        'HubSpot does not expose a way to restore a deleted property or recover the values it ' +
        'held on existing records.'
    ),
});

export const getPropertyHistoryInputSchema = z.object({
  objectType: crmObjectTypeSchema,
  recordId: z
    .string()
    .trim()
    .min(1)
    .regex(/^\d+$/u, 'A HubSpot record ID is numeric, e.g. "512".')
    .describe('The numeric record ID to read property history for.'),
  propertyNames: z
    .array(propertyNameSchema)
    .min(1)
    .max(50, 'Request at most 50 properties of history at a time.')
    .describe('Which properties to fetch the value history for, e.g. ["dealstage", "amount"].'),
});

// -------------------------------------------------------------------- output

const propertyOptionOutputSchema = z.object({
  label: z.string(),
  value: z.string(),
  hidden: z.boolean().optional(),
  displayOrder: z.number().optional(),
});

export const propertyDefinitionOutputSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),
  fieldType: z.string(),
  groupName: z.string().nullable(),
  description: z.string().nullable(),
  options: z.array(propertyOptionOutputSchema),
  hidden: z.boolean(),
  hasUniqueValue: z.boolean(),
  calculated: z.boolean(),
});

export const propertyListOutputSchema = z.object({
  objectType: z.string(),
  properties: z.array(propertyDefinitionOutputSchema),
  count: z.number(),
});

export const propertyOperationResultSchema = z.object({
  success: z.boolean(),
  objectType: z.string(),
  propertyName: z.string().nullable(),
  message: z.string(),
});

const propertyHistoryEntryOutputSchema = z.object({
  value: z.string().nullable(),
  timestamp: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  updatedByUserId: z.number().nullable(),
});

export const propertyHistoryOutputSchema = z.object({
  objectType: z.string(),
  objectId: z.string(),
  history: z.record(z.string(), z.array(propertyHistoryEntryOutputSchema)),
});

export type ListPropertiesInput = z.output<typeof listPropertiesInputSchema>;
export type GetPropertyInput = z.output<typeof getPropertyInputSchema>;
export type CreatePropertyInput = z.output<typeof createPropertyInputSchema>;
export type UpdatePropertyInput = z.output<typeof updatePropertyInputSchema>;
export type DeletePropertyInput = z.output<typeof deletePropertyInputSchema>;
export type GetPropertyHistoryInput = z.output<typeof getPropertyHistoryInputSchema>;
