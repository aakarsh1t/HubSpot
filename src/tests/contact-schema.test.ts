import { describe, expect, it } from 'vitest';
import {
  archiveContactInputSchema,
  batchArchiveContactsInputSchema,
  batchCreateContactsInputSchema,
  contactIdSchema,
  createContactInputSchema,
  deleteContactInputSchema,
  emailSchema,
  getContactInputSchema,
  mergeContactsInputSchema,
  restoreContactInputSchema,
  searchContactsInputSchema,
  updateContactInputSchema,
} from '../schemas/contact.schema.js';

describe('contactIdSchema', () => {
  it('accepts a numeric HubSpot id', () => {
    expect(contactIdSchema.safeParse('51234567890').success).toBe(true);
  });

  it('rejects a non-numeric id, catching a confused email-as-id mistake', () => {
    const result = contactIdSchema.safeParse('jane@acme.com');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(contactIdSchema.safeParse('').success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('lower-cases and trims', () => {
    const result = emailSchema.safeParse('  Jane@ACME.com  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('jane@acme.com');
    }
  });

  it('rejects an invalid address', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('createContactInputSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = createContactInputSchema.safeParse({
      properties: { email: 'jane@acme.com' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty properties object', () => {
    const result = createContactInputSchema.safeParse({ properties: {} });
    expect(result.success).toBe(false);
  });

  it('accepts scalar property types HubSpot supports', () => {
    const result = createContactInputSchema.safeParse({
      properties: { email: 'a@b.com', numemployees: 100, is_public: true, note: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a nested object as a property value, which HubSpot cannot store', () => {
    const result = createContactInputSchema.safeParse({
      properties: { email: 'a@b.com', bad: { nested: true } },
    });
    expect(result.success).toBe(false);
  });

  it('validates association object types against the allowed set', () => {
    const result = createContactInputSchema.safeParse({
      properties: { email: 'a@b.com' },
      associations: [{ toObjectType: 'not_a_real_type', toObjectId: '1' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateContactInputSchema', () => {
  it('requires at least one property to update', () => {
    expect(updateContactInputSchema.safeParse({ contactId: '512', properties: {} }).success).toBe(
      false
    );
  });
});

describe('getContactInputSchema', () => {
  it('defaults archived to false', () => {
    const result = getContactInputSchema.safeParse({ contactId: '512' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archived).toBe(false);
    }
  });

  it('caps the number of requested properties', () => {
    const result = getContactInputSchema.safeParse({
      contactId: '512',
      properties: Array.from({ length: 201 }, (_, i) => `prop_${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('searchContactsInputSchema', () => {
  it('accepts a free-text query alone', () => {
    expect(searchContactsInputSchema.safeParse({ query: 'acme' }).success).toBe(true);
  });

  it('requires either a query or a filter group', () => {
    const result = searchContactsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('enforces the 6-filters-per-group limit', () => {
    const filters = Array.from({ length: 7 }, (_, i) => ({
      propertyName: `p${i}`,
      operator: 'EQ' as const,
      value: 'x',
    }));

    const result = searchContactsInputSchema.safeParse({ filterGroups: [{ filters }] });
    expect(result.success).toBe(false);
  });

  it('enforces the 5-filter-groups limit', () => {
    const groups = Array.from({ length: 6 }, () => ({
      filters: [{ propertyName: 'p', operator: 'EQ' as const, value: 'x' }],
    }));

    expect(searchContactsInputSchema.safeParse({ filterGroups: groups }).success).toBe(false);
  });

  it('enforces the 18-filters-total limit across groups', () => {
    // 4 groups x 5 filters = 20 total, each group under its own 6-filter cap.
    const groups = Array.from({ length: 4 }, () => ({
      filters: Array.from({ length: 5 }, (_, i) => ({
        propertyName: `p${i}`,
        operator: 'EQ' as const,
        value: 'x',
      })),
    }));

    const result = searchContactsInputSchema.safeParse({ filterGroups: groups });
    expect(result.success).toBe(false);
  });

  it('caps limit at 200', () => {
    expect(searchContactsInputSchema.safeParse({ query: 'x', limit: 201 }).success).toBe(false);
  });

  it('requires values[] for the IN operator', () => {
    const result = searchContactsInputSchema.safeParse({
      filterGroups: [{ filters: [{ propertyName: 'p', operator: 'IN' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('requires highValue for the BETWEEN operator', () => {
    const result = searchContactsInputSchema.safeParse({
      filterGroups: [{ filters: [{ propertyName: 'p', operator: 'BETWEEN', value: '1' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('requires no value for HAS_PROPERTY', () => {
    const result = searchContactsInputSchema.safeParse({
      filterGroups: [{ filters: [{ propertyName: 'p', operator: 'HAS_PROPERTY' }] }],
    });
    expect(result.success).toBe(true);
  });

  it('requires value for EQ', () => {
    const result = searchContactsInputSchema.safeParse({
      filterGroups: [{ filters: [{ propertyName: 'p', operator: 'EQ' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a complete, valid BETWEEN filter', () => {
    const result = searchContactsInputSchema.safeParse({
      filterGroups: [
        {
          filters: [
            { propertyName: 'createdate', operator: 'BETWEEN', value: '1', highValue: '2' },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('destructive operation gates', () => {
  it('rejects delete without the literal confirmation', () => {
    expect(
      deleteContactInputSchema.safeParse({ contactId: '512', confirmPermanentDeletion: false })
        .success
    ).toBe(false);
    expect(deleteContactInputSchema.safeParse({ contactId: '512' }).success).toBe(false);
  });

  it('accepts delete only with confirmPermanentDeletion: true', () => {
    expect(
      deleteContactInputSchema.safeParse({ contactId: '512', confirmPermanentDeletion: true })
        .success
    ).toBe(true);
  });

  it('rejects a truthy-but-not-literal-true confirmation value', () => {
    const result = deleteContactInputSchema.safeParse({
      contactId: '512',
      confirmPermanentDeletion: 'true',
    });
    expect(result.success).toBe(false);
  });

  it('requires confirmRecreate: true for restore', () => {
    expect(restoreContactInputSchema.safeParse({ contactId: '512' }).success).toBe(false);
    expect(
      restoreContactInputSchema.safeParse({ contactId: '512', confirmRecreate: true }).success
    ).toBe(true);
  });

  it('requires confirmArchive: true for batch archive', () => {
    expect(batchArchiveContactsInputSchema.safeParse({ contactIds: ['512'] }).success).toBe(false);
    expect(
      batchArchiveContactsInputSchema.safeParse({ contactIds: ['512'], confirmArchive: true })
        .success
    ).toBe(true);
  });

  it('archive (soft-delete) requires no confirmation, unlike permanent delete', () => {
    // Archiving is reversible for 90 days, so it is intentionally not gated
    // the way permanent deletion and merge are.
    expect(archiveContactInputSchema.safeParse({ contactId: '512' }).success).toBe(true);
  });
});

describe('mergeContactsInputSchema', () => {
  it('rejects merging a contact into itself', () => {
    const result = mergeContactsInputSchema.safeParse({
      primaryContactId: '512',
      contactIdToMerge: '512',
      confirmMerge: true,
    });
    expect(result.success).toBe(false);
  });

  it('requires confirmMerge: true', () => {
    const result = mergeContactsInputSchema.safeParse({
      primaryContactId: '512',
      contactIdToMerge: '513',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid merge request', () => {
    const result = mergeContactsInputSchema.safeParse({
      primaryContactId: '512',
      contactIdToMerge: '513',
      confirmMerge: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('batchCreateContactsInputSchema', () => {
  it('enforces the 100-record batch cap', () => {
    const contacts = Array.from({ length: 101 }, (_, i) => ({
      properties: { email: `user${i}@acme.com` },
    }));
    expect(batchCreateContactsInputSchema.safeParse({ contacts }).success).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(batchCreateContactsInputSchema.safeParse({ contacts: [] }).success).toBe(false);
  });

  it('accepts exactly 100 records', () => {
    const contacts = Array.from({ length: 100 }, (_, i) => ({
      properties: { email: `user${i}@acme.com` },
    }));
    expect(batchCreateContactsInputSchema.safeParse({ contacts }).success).toBe(true);
  });
});
