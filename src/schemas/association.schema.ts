import { z } from 'zod';

/**
 * Zod contracts for association management (HubSpot associations v4), for
 * any primary object type — contacts, companies, or deals.
 *
 * Structured the same way as `engagement.schema.ts`: one validated ID field
 * per module (`contactId` / `companyId` / `dealId`, for agent clarity) around
 * an otherwise identical body, built via `idField` + a small set of
 * per-module `associableObjectTypeSchema` variants that exclude the module's
 * own type (a company cannot usefully be "associated with companies" through
 * this API) as well as any pair without a verified association type ID.
 */

const RECORD_ID_PATTERN = /^\d+$/u;

function idField(field: string, noun: string) {
  return z
    .string()
    .trim()
    .min(1, `${field} must not be empty.`)
    .regex(RECORD_ID_PATTERN, `A HubSpot ${noun} ID is numeric, e.g. "512".`)
    .describe(`The numeric HubSpot ${noun} record ID.`);
}

const limitField = z
  .number()
  .int()
  .min(1)
  .max(500)
  .default(100)
  .describe('Maximum associations to return (1-500). Defaults to 100.');

const afterField = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe('Pagination cursor from a previous call.');

const associationTypeIdField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    'Optional custom association type ID (for labelled associations). Omit to use the ' +
      'HubSpot-defined default association for this object pair.'
  );

// ------------------------------------------------------------------- contacts

export const contactAssociableObjectTypeSchema = z
  .enum(['companies', 'deals', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
  .describe(
    'The HubSpot object type on the other side of the association. Restricted to types with ' +
      'known HubSpot-defined association IDs.'
  );

export const listAssociationsInputSchema = z.object({
  contactId: idField('contactId', 'contact'),
  toObjectType: contactAssociableObjectTypeSchema,
  limit: limitField,
  after: afterField,
});

export const createAssociationInputSchema = z.object({
  contactId: idField('contactId', 'contact'),
  toObjectType: contactAssociableObjectTypeSchema,
  toObjectId: z
    .string()
    .trim()
    .min(1)
    .describe('The numeric record ID of the object to associate.'),
  associationTypeId: associationTypeIdField,
});

export const deleteAssociationInputSchema = z.object({
  contactId: idField('contactId', 'contact'),
  toObjectType: contactAssociableObjectTypeSchema,
  toObjectId: z.string().trim().min(1).describe('The record ID to disassociate.'),
  confirmRemoval: z
    .literal(true)
    .describe(
      'Must be exactly true. Removes ALL association types between these two records. ' +
        'The records themselves are not deleted.'
    ),
});

// ------------------------------------------------------------------- companies

export const companyAssociableObjectTypeSchema = z
  .enum(['contacts', 'deals', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
  .describe(
    'The HubSpot object type on the other side of the association. Restricted to types with ' +
      'known HubSpot-defined association IDs.'
  );

export const listCompanyAssociationsInputSchema = z.object({
  companyId: idField('companyId', 'company'),
  toObjectType: companyAssociableObjectTypeSchema,
  limit: limitField,
  after: afterField,
});

export const createCompanyAssociationInputSchema = z.object({
  companyId: idField('companyId', 'company'),
  toObjectType: companyAssociableObjectTypeSchema,
  toObjectId: z
    .string()
    .trim()
    .min(1)
    .describe('The numeric record ID of the object to associate.'),
  associationTypeId: associationTypeIdField,
});

export const deleteCompanyAssociationInputSchema = z.object({
  companyId: idField('companyId', 'company'),
  toObjectType: companyAssociableObjectTypeSchema,
  toObjectId: z.string().trim().min(1).describe('The record ID to disassociate.'),
  confirmRemoval: z
    .literal(true)
    .describe(
      'Must be exactly true. Removes ALL association types between these two records. ' +
        'The records themselves are not deleted.'
    ),
});

// ---------------------------------------------------------------------- deals

export const dealAssociableObjectTypeSchema = z
  .enum(['contacts', 'companies', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
  .describe(
    'The HubSpot object type on the other side of the association. Restricted to types with ' +
      'known HubSpot-defined association IDs.'
  );

export const listDealAssociationsInputSchema = z.object({
  dealId: idField('dealId', 'deal'),
  toObjectType: dealAssociableObjectTypeSchema,
  limit: limitField,
  after: afterField,
});

export const createDealAssociationInputSchema = z.object({
  dealId: idField('dealId', 'deal'),
  toObjectType: dealAssociableObjectTypeSchema,
  toObjectId: z
    .string()
    .trim()
    .min(1)
    .describe('The numeric record ID of the object to associate.'),
  associationTypeId: associationTypeIdField,
});

export const deleteDealAssociationInputSchema = z.object({
  dealId: idField('dealId', 'deal'),
  toObjectType: dealAssociableObjectTypeSchema,
  toObjectId: z.string().trim().min(1).describe('The record ID to disassociate.'),
  confirmRemoval: z
    .literal(true)
    .describe(
      'Must be exactly true. Removes ALL association types between these two records. ' +
        'The records themselves are not deleted.'
    ),
});

// -------------------------------------------------------------------- output

export const associationOutputSchema = z.object({
  toObjectId: z.string(),
  toObjectType: z.string(),
  associationTypes: z.array(
    z.object({ category: z.string(), typeId: z.number(), label: z.string().nullable() })
  ),
});

export const associationPageOutputSchema = z.object({
  objectId: z.string(),
  toObjectType: z.string(),
  results: z.array(associationOutputSchema),
  after: z.string().nullable(),
  count: z.number(),
});

export const associationMutationOutputSchema = z.object({
  success: z.boolean(),
  objectId: z.string(),
  toObjectType: z.string(),
  toObjectId: z.string(),
  message: z.string(),
});

export type ListAssociationsInput = z.output<typeof listAssociationsInputSchema>;
export type CreateAssociationInput = z.output<typeof createAssociationInputSchema>;
export type DeleteAssociationInput = z.output<typeof deleteAssociationInputSchema>;

export type ListCompanyAssociationsInput = z.output<typeof listCompanyAssociationsInputSchema>;
export type CreateCompanyAssociationInput = z.output<typeof createCompanyAssociationInputSchema>;
export type DeleteCompanyAssociationInput = z.output<typeof deleteCompanyAssociationInputSchema>;

export type ListDealAssociationsInput = z.output<typeof listDealAssociationsInputSchema>;
export type CreateDealAssociationInput = z.output<typeof createDealAssociationInputSchema>;
export type DeleteDealAssociationInput = z.output<typeof deleteDealAssociationInputSchema>;
