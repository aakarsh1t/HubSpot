import { z } from 'zod';
import { contactIdSchema } from './contact.schema.js';

/**
 * Zod contracts for contact association management (HubSpot associations v4).
 */

export const associableObjectTypeSchema = z
  .enum(['companies', 'deals', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails'])
  .describe(
    'The HubSpot object type on the other side of the association. Restricted to types with ' +
      'known HubSpot-defined association IDs.'
  );

export const listAssociationsInputSchema = z.object({
  contactId: contactIdSchema,
  toObjectType: associableObjectTypeSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum associations to return (1-500). Defaults to 100.'),
  after: z.string().trim().min(1).optional().describe('Pagination cursor from a previous call.'),
});

export const createAssociationInputSchema = z.object({
  contactId: contactIdSchema,
  toObjectType: associableObjectTypeSchema,
  toObjectId: z
    .string()
    .trim()
    .min(1)
    .describe('The numeric record ID of the object to associate the contact with.'),
  associationTypeId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Optional custom association type ID (for labelled associations). Omit to use the ' +
        'HubSpot-defined default association for this object pair.'
    ),
});

export const deleteAssociationInputSchema = z.object({
  contactId: contactIdSchema,
  toObjectType: associableObjectTypeSchema,
  toObjectId: z.string().trim().min(1).describe('The record ID to disassociate from the contact.'),
  confirmRemoval: z
    .literal(true)
    .describe(
      'Must be exactly true. Removes ALL association types between these two records. ' +
        'The records themselves are not deleted.'
    ),
});

export const associationOutputSchema = z.object({
  toObjectId: z.string(),
  toObjectType: z.string(),
  associationTypes: z.array(
    z.object({
      category: z.string(),
      typeId: z.number(),
      label: z.string().nullable(),
    })
  ),
});

export const associationPageOutputSchema = z.object({
  contactId: z.string(),
  toObjectType: z.string(),
  results: z.array(associationOutputSchema),
  after: z.string().nullable(),
  count: z.number(),
});

export const associationMutationOutputSchema = z.object({
  success: z.boolean(),
  contactId: z.string(),
  toObjectType: z.string(),
  toObjectId: z.string(),
  message: z.string(),
});

export type ListAssociationsInput = z.output<typeof listAssociationsInputSchema>;
export type CreateAssociationInput = z.output<typeof createAssociationInputSchema>;
export type DeleteAssociationInput = z.output<typeof deleteAssociationInputSchema>;
