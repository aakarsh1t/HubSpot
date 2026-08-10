import { describe, expect, it } from 'vitest';
import {
  batchRecordsInputSchema,
  createEngagementInputSchema,
  deleteRecordInputSchema,
  getRecordInputSchema,
  managePropertiesInputSchema,
  manageAssociationsInputSchema,
  mergeRecordsInputSchema,
  searchRecordsInputSchema,
} from '../schemas/crm.schema.js';

/**
 * The consolidated tools carry their discriminated shapes in refinements
 * rather than in their names, so these refinements are now load-bearing in a
 * way the old per-object schemas never were: they are the only thing standing
 * between "engagementType: meeting with a note payload" and an opaque HubSpot
 * 400. Each case below is one an agent can plausibly produce.
 */

function messagesFor(schema: { safeParse: (value: unknown) => unknown }, value: unknown): string[] {
  const result = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => issue.message);
}

describe('getRecordInputSchema', () => {
  it('accepts a numeric ID and a unique-property lookup', () => {
    expect(getRecordInputSchema.safeParse({ objectType: 'deals', recordId: '9001' }).success).toBe(
      true
    );
    expect(
      getRecordInputSchema.safeParse({
        objectType: 'contacts',
        recordId: 'jane@acme.com',
        idProperty: 'email',
      }).success
    ).toBe(true);
  });

  it('points a non-numeric ID at idProperty instead of failing opaquely', () => {
    const messages = messagesFor(getRecordInputSchema, {
      objectType: 'contacts',
      recordId: 'jane@acme.com',
    });
    expect(messages.join(' ')).toContain('idProperty');
  });

  it('rejects an archived read by unique property, which HubSpot cannot serve', () => {
    expect(
      getRecordInputSchema.safeParse({
        objectType: 'contacts',
        recordId: 'jane@acme.com',
        idProperty: 'email',
        archived: true,
      }).success
    ).toBe(false);
  });
});

describe('searchRecordsInputSchema', () => {
  it('allows a bare listing, which routes to the list endpoint', () => {
    const parsed = searchRecordsInputSchema.parse({ objectType: 'contacts' });
    expect(parsed).toMatchObject({ limit: 25, archived: false, includeEmptyProperties: false });
  });

  it("caps a bare listing at the list endpoint's limit of 100", () => {
    expect(searchRecordsInputSchema.safeParse({ objectType: 'contacts', limit: 200 }).success).toBe(
      false
    );
    // The same limit is fine once criteria make it a search request.
    expect(
      searchRecordsInputSchema.safeParse({ objectType: 'contacts', query: 'acme', limit: 200 })
        .success
    ).toBe(true);
  });

  it('rejects an archived search, which HubSpot silently ignores rather than honours', () => {
    expect(
      searchRecordsInputSchema.safeParse({
        objectType: 'contacts',
        query: 'acme',
        archived: true,
      }).success
    ).toBe(false);
  });

  it('enforces HubSpot filter limits locally instead of spending a call to learn them', () => {
    const group = {
      filters: [{ propertyName: 'email', operator: 'HAS_PROPERTY' }],
    };

    expect(
      searchRecordsInputSchema.safeParse({
        objectType: 'contacts',
        filterGroups: Array.from({ length: 6 }, () => group),
      }).success
    ).toBe(false);
  });

  it('names the missing argument when an operator and its arguments disagree', () => {
    expect(
      messagesFor(searchRecordsInputSchema, {
        objectType: 'deals',
        filterGroups: [{ filters: [{ propertyName: 'amount', operator: 'BETWEEN', value: 1 }] }],
      }).join(' ')
    ).toContain('highValue');

    expect(
      messagesFor(searchRecordsInputSchema, {
        objectType: 'deals',
        filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'IN' }] }],
      }).join(' ')
    ).toContain('values');
  });
});

describe('destructive confirmation gates', () => {
  it('lets an archive through unconfirmed but gates permanent erasure', () => {
    // Archiving is recoverable for 90 days; gating a reversible action only
    // trains a model to set every flag it sees.
    expect(
      deleteRecordInputSchema.safeParse({ objectType: 'contacts', recordId: '512' }).success
    ).toBe(true);

    expect(
      deleteRecordInputSchema.safeParse({
        objectType: 'contacts',
        recordId: '512',
        mode: 'permanent',
      }).success
    ).toBe(false);

    expect(
      deleteRecordInputSchema.safeParse({
        objectType: 'contacts',
        recordId: '512',
        mode: 'permanent',
        confirmPermanentDeletion: true,
      }).success
    ).toBe(true);
  });

  it('gates a bulk archive but not a bulk update', () => {
    expect(
      batchRecordsInputSchema.safeParse({
        objectType: 'contacts',
        operation: 'archive',
        recordIds: ['1', '2'],
      }).success
    ).toBe(false);

    expect(
      batchRecordsInputSchema.safeParse({
        objectType: 'contacts',
        operation: 'update',
        records: [{ recordId: '1', properties: { firstname: 'Jane' } }],
      }).success
    ).toBe(true);
  });

  it('refuses to merge a record into itself', () => {
    expect(
      mergeRecordsInputSchema.safeParse({
        objectType: 'contacts',
        primaryRecordId: '512',
        recordIdToMerge: '512',
        confirmMerge: true,
      }).success
    ).toBe(false);
  });

  it('gates deleting a property definition, which destroys values on every record', () => {
    expect(
      managePropertiesInputSchema.safeParse({
        action: 'delete',
        objectType: 'contacts',
        propertyName: 'renewal_risk',
      }).success
    ).toBe(false);

    expect(
      managePropertiesInputSchema.safeParse({
        action: 'delete',
        objectType: 'contacts',
        propertyName: 'renewal_risk',
        confirmDeletion: true,
      }).success
    ).toBe(true);
  });
});

describe('batchRecordsInputSchema', () => {
  it('requires the argument array that matches the operation', () => {
    expect(
      messagesFor(batchRecordsInputSchema, {
        objectType: 'contacts',
        operation: 'create',
        recordIds: ['1'],
      }).join(' ')
    ).toContain('records');

    expect(
      messagesFor(batchRecordsInputSchema, {
        objectType: 'contacts',
        operation: 'read',
        records: [{ properties: {} }],
      }).join(' ')
    ).toContain('recordIds');
  });

  it('requires every record in a batch update to carry its ID', () => {
    expect(
      messagesFor(batchRecordsInputSchema, {
        objectType: 'deals',
        operation: 'update',
        records: [{ recordId: '1', properties: {} }, { properties: {} }],
      }).join(' ')
    ).toContain('recordId');
  });

  it("holds the batch to HubSpot's 100-input ceiling", () => {
    expect(
      batchRecordsInputSchema.safeParse({
        objectType: 'contacts',
        operation: 'read',
        recordIds: Array.from({ length: 101 }, (_, index) => String(index)),
      }).success
    ).toBe(false);
  });
});

describe('createEngagementInputSchema', () => {
  it('requires the payload matching the declared engagement type', () => {
    expect(
      messagesFor(createEngagementInputSchema, {
        objectType: 'contacts',
        recordId: '512',
        engagementType: 'meeting',
        note: { body: 'wrong payload' },
      }).join(' ')
    ).toContain('meeting');
  });

  it('applies the activity defaults so an agent need only supply the content', () => {
    const parsed = createEngagementInputSchema.parse({
      objectType: 'deals',
      recordId: '9001',
      engagementType: 'task',
      task: { subject: 'Send the contract' },
    });

    expect(parsed.task).toMatchObject({
      status: 'NOT_STARTED',
      priority: 'MEDIUM',
      taskType: 'TODO',
    });
  });

  it('rejects a meeting that ends before it starts', () => {
    expect(
      createEngagementInputSchema.safeParse({
        objectType: 'contacts',
        recordId: '512',
        engagementType: 'meeting',
        meeting: {
          title: 'Kickoff',
          startTime: '2026-08-05T15:00:00Z',
          endTime: '2026-08-05T14:00:00Z',
        },
      }).success
    ).toBe(false);
  });
});

describe('manageAssociationsInputSchema', () => {
  it('requires the other record for create and delete but not for list', () => {
    expect(
      manageAssociationsInputSchema.safeParse({
        action: 'list',
        objectType: 'contacts',
        recordId: '512',
        toObjectType: 'deals',
      }).success
    ).toBe(true);

    expect(
      messagesFor(manageAssociationsInputSchema, {
        action: 'create',
        objectType: 'contacts',
        recordId: '512',
        toObjectType: 'deals',
      }).join(' ')
    ).toContain('toObjectId');
  });
});

describe('managePropertiesInputSchema', () => {
  it('requires the full definition when creating a property', () => {
    const messages = messagesFor(managePropertiesInputSchema, {
      action: 'create',
      objectType: 'contacts',
      propertyName: 'renewal_risk',
    }).join(' ');

    expect(messages).toContain('label');
    expect(messages).toContain('type');
    expect(messages).toContain('groupName');
  });

  it('requires options on an enumeration property', () => {
    expect(
      messagesFor(managePropertiesInputSchema, {
        action: 'create',
        objectType: 'contacts',
        propertyName: 'renewal_risk',
        label: 'Renewal Risk',
        type: 'enumeration',
        fieldType: 'select',
        groupName: 'contactinformation',
      }).join(' ')
    ).toContain('option');
  });

  it('requires a record and property names for a history read', () => {
    const messages = messagesFor(managePropertiesInputSchema, {
      action: 'history',
      objectType: 'deals',
    }).join(' ');

    expect(messages).toContain('recordId');
    expect(messages).toContain('propertyNames');
  });

  it('needs nothing beyond the object type to list', () => {
    expect(
      managePropertiesInputSchema.safeParse({ action: 'list', objectType: 'deals' }).success
    ).toBe(true);
  });
});
