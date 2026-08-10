import { beforeEach, describe, expect, it } from 'vitest';
import { AssociationsService } from '../services/associations.service.js';
import { CrmService } from '../services/crm.service.js';
import { EngagementsService } from '../services/engagements.service.js';
import { PropertiesService } from '../services/properties.service.js';
import {
  BatchRecordsTool,
  CreateEngagementTool,
  CreateRecordTool,
  DeleteRecordTool,
  GetRecordTool,
  ListPipelinesTool,
  ManageAssociationsTool,
  ManagePropertiesTool,
  MergeRecordsTool,
  SearchRecordsTool,
  UpdateRecordTool,
} from '../tools/crm/index.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger, toolContext } from './helpers/fixtures.js';

/**
 * Behavioural tests for the consolidated CRM tools.
 *
 * The thing worth testing about these tools is precisely what the consolidation
 * introduced: `objectType` arriving as an argument must reach the right HubSpot
 * path, and an `action`/`operation`/`engagementType` discriminator must reach
 * the right method. A tool that quietly writes a deal to `/crm/v3/objects/contacts`
 * is the failure mode that replaces "wrong tool selected", so every dispatch
 * assertion below checks the actual outbound request.
 */

const CONTACT_RESPONSE = {
  id: '512',
  properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: null, phone: '' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  archived: false,
};

function build(): {
  client: FakeHubSpotClient;
  crm: CrmService;
  associations: AssociationsService;
  engagements: EngagementsService;
  properties: PropertiesService;
} {
  const client = new FakeHubSpotClient();
  const logger = testLogger();

  return {
    client,
    crm: new CrmService({ client: client.asClient(), logger }),
    associations: new AssociationsService({ client: client.asClient(), logger }),
    engagements: new EngagementsService({ client: client.asClient(), logger }),
    properties: new PropertiesService({ client: client.asClient(), logger }),
  };
}

describe('hubspot_get_record', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('routes to the object type given at call time', async () => {
    harness.client.respondWith({ id: '9001', properties: { dealname: 'Acme' } });

    await new GetRecordTool(harness.crm).execute(
      {
        objectType: 'deals',
        recordId: '9001',
        archived: false,
        includeEmptyProperties: false,
      },
      toolContext()
    );

    expect(harness.client.lastRequest().path).toBe('/crm/v3/objects/deals/9001');
  });

  it('uses HubSpot alternate-key lookup rather than search when idProperty is set', async () => {
    harness.client.respondWith(CONTACT_RESPONSE);

    await new GetRecordTool(harness.crm).execute(
      {
        objectType: 'contacts',
        recordId: 'jane@acme.com',
        idProperty: 'email',
        archived: false,
        includeEmptyProperties: false,
      },
      toolContext()
    );

    const request = harness.client.lastRequest();
    // A single indexed read, not a POST to /search: faster, and outside the
    // search API's separate and tighter rate limit.
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/crm/v3/objects/contacts/jane%40acme.com');
    expect(request.query).toMatchObject({ idProperty: 'email' });
  });

  it('drops empty property values by default and keeps them on request', async () => {
    harness.client.respondWith(CONTACT_RESPONSE);

    const trimmed = await new GetRecordTool(harness.crm).execute(
      { objectType: 'contacts', recordId: '512', archived: false, includeEmptyProperties: false },
      toolContext()
    );

    expect(trimmed.properties).toEqual({ email: 'jane@acme.com', firstname: 'Jane' });

    harness.client.respondWith(CONTACT_RESPONSE);

    const full = await new GetRecordTool(harness.crm).execute(
      { objectType: 'contacts', recordId: '512', archived: false, includeEmptyProperties: true },
      toolContext()
    );

    expect(full.properties).toHaveProperty('lastname', null);
    expect(full.properties).toHaveProperty('phone', '');
  });

  it('omits the associations map unless associations were requested', async () => {
    harness.client.respondWith(CONTACT_RESPONSE);

    const without = await new GetRecordTool(harness.crm).execute(
      { objectType: 'contacts', recordId: '512', archived: false, includeEmptyProperties: false },
      toolContext()
    );
    expect(without.associations).toBeUndefined();

    harness.client.respondWith({
      ...CONTACT_RESPONSE,
      associations: { companies: { results: [{ id: '7801', type: 'contact_to_company' }] } },
    });

    const with_ = await new GetRecordTool(harness.crm).execute(
      {
        objectType: 'contacts',
        recordId: '512',
        includeAssociations: ['companies'],
        archived: false,
        includeEmptyProperties: false,
      },
      toolContext()
    );
    expect(with_.associations).toEqual({ companies: ['7801'] });
  });
});

describe('hubspot_search_records', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('uses the list endpoint when no criteria are supplied', async () => {
    harness.client.respondWith({ results: [CONTACT_RESPONSE], paging: {} });

    const page = await new SearchRecordsTool(harness.crm).execute(
      { objectType: 'contacts', limit: 25, archived: false, includeEmptyProperties: false },
      toolContext()
    );

    const request = harness.client.lastRequest();
    // Cheaper than /search and in a separate rate-limit bucket. Routing this
    // here is what let the list tools be removed without losing the behaviour.
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/crm/v3/objects/contacts');
    expect(page.count).toBe(1);
  });

  it('uses the search endpoint when a query or filters are supplied', async () => {
    harness.client.respondWith({ results: [], paging: {}, total: 0 });

    await new SearchRecordsTool(harness.crm).execute(
      {
        objectType: 'companies',
        query: 'acme',
        limit: 50,
        archived: false,
        includeEmptyProperties: false,
      },
      toolContext()
    );

    const request = harness.client.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/crm/v3/objects/companies/search');
    expect(request.body).toMatchObject({ query: 'acme', limit: 50 });
  });
});

describe('hubspot_create_record / hubspot_update_record', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('resolves association type IDs in the correct direction on create', async () => {
    harness.client.respondWith({ id: '9001', properties: { dealname: 'Acme' } });

    await new CreateRecordTool(harness.crm).execute(
      {
        objectType: 'deals',
        properties: { dealname: 'Acme' },
        associations: [{ toObjectType: 'contacts', toObjectId: '512' }],
        includeEmptyProperties: false,
      },
      toolContext()
    );

    const body = harness.client.lastRequest().body as {
      associations: { types: { associationTypeId: number }[] }[];
    };
    // deals -> contacts is 3; contacts -> deals is 4. Direction is not
    // symmetric, and the reverse ID fails as an opaque 400.
    expect(body.associations[0]?.types[0]?.associationTypeId).toBe(3);
  });

  it('creates non-retryably and updates retryably', async () => {
    harness.client.respondWith({ id: '512', properties: {} });
    await new CreateRecordTool(harness.crm).execute(
      { objectType: 'contacts', properties: { email: 'a@b.com' }, includeEmptyProperties: false },
      toolContext()
    );
    // Replaying a create after a timeout duplicates a customer record.
    expect(harness.client.lastRequest().retryable).toBe(false);

    harness.client.respondWith({ id: '512', properties: {} });
    await new UpdateRecordTool(harness.crm).execute(
      {
        objectType: 'contacts',
        recordId: '512',
        properties: { firstname: 'Jane' },
        includeEmptyProperties: false,
      },
      toolContext()
    );
    expect(harness.client.lastRequest().retryable).toBe(true);
  });

  it('moves a deal stage through the generic update path', async () => {
    harness.client.respondWith({ id: '9001', properties: { dealstage: 'contractsent' } });

    await new UpdateRecordTool(harness.crm).execute(
      {
        objectType: 'deals',
        recordId: '9001',
        properties: { dealstage: 'contractsent', pipeline: 'default' },
        includeEmptyProperties: false,
      },
      toolContext()
    );

    const request = harness.client.lastRequest();
    expect(request.method).toBe('PATCH');
    expect(request.path).toBe('/crm/v3/objects/deals/9001');
    expect(request.body).toEqual({
      properties: { dealstage: 'contractsent', pipeline: 'default' },
    });
  });
});

describe('hubspot_delete_record', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('archives by default', async () => {
    harness.client.respondWith(null);

    const result = await new DeleteRecordTool(harness.crm).execute(
      { objectType: 'companies', recordId: '7801', mode: 'archive' },
      toolContext()
    );

    const request = harness.client.lastRequest();
    expect(request.method).toBe('DELETE');
    expect(request.path).toBe('/crm/v3/objects/companies/7801');
    expect(result.message).toContain('recycle bin');
  });

  it('routes permanent deletion to the GDPR endpoint', async () => {
    harness.client.respondWith(null);

    const result = await new DeleteRecordTool(harness.crm).execute(
      {
        objectType: 'contacts',
        recordId: '512',
        mode: 'permanent',
        confirmPermanentDeletion: true,
      },
      toolContext()
    );

    const request = harness.client.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/crm/v3/objects/contacts/gdpr-delete');
    expect(request.body).toEqual({ objectId: '512' });
    expect(result.message).toContain('cannot be undone');
  });
});

describe('hubspot_batch_records', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('dispatches each operation to its own HubSpot endpoint', async () => {
    const tool = new BatchRecordsTool(harness.crm);

    harness.client.respondWith({ status: 'COMPLETE', results: [{ id: '1', properties: {} }] });
    await tool.execute(
      {
        objectType: 'contacts',
        operation: 'create',
        records: [{ properties: { email: 'a@b.com' } }],
        includeEmptyProperties: false,
      },
      toolContext()
    );
    expect(harness.client.lastRequest().path).toBe('/crm/v3/objects/contacts/batch/create');

    harness.client.respondWith({ status: 'COMPLETE', results: [{ id: '1', properties: {} }] });
    await tool.execute(
      {
        objectType: 'deals',
        operation: 'update',
        records: [{ recordId: '9001', properties: { amount: 1 } }],
        includeEmptyProperties: false,
      },
      toolContext()
    );
    expect(harness.client.lastRequest().path).toBe('/crm/v3/objects/deals/batch/update');
    expect(harness.client.lastRequest().body).toMatchObject({
      inputs: [{ id: '9001', properties: { amount: '1' } }],
    });

    harness.client.respondWith({ status: 'COMPLETE', results: [] });
    await tool.execute(
      {
        objectType: 'companies',
        operation: 'read',
        recordIds: ['7801'],
        includeEmptyProperties: false,
      },
      toolContext()
    );
    expect(harness.client.lastRequest().path).toBe('/crm/v3/objects/companies/batch/read');
  });

  it('reports partial success rather than reading a 207 as a clean result', async () => {
    harness.client.respondWith({
      status: 'PARTIAL',
      results: [{ id: '1', properties: {} }],
      errors: [{ message: 'Invalid email', category: 'VALIDATION_ERROR' }],
    });

    const outcome = await new BatchRecordsTool(harness.crm).execute(
      {
        objectType: 'contacts',
        operation: 'create',
        records: [{ properties: { email: 'a@b.com' } }, { properties: { email: 'nope' } }],
        includeEmptyProperties: false,
      },
      toolContext()
    );

    expect(outcome.status).toBe('PARTIAL');
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
  });

  it('reports an archive batch as complete despite HubSpot returning no body', async () => {
    harness.client.respondWith(null);

    const outcome = await new BatchRecordsTool(harness.crm).execute(
      {
        objectType: 'contacts',
        operation: 'archive',
        recordIds: ['1', '2', '3'],
        confirmArchive: true,
        includeEmptyProperties: false,
      },
      toolContext()
    );

    expect(harness.client.lastRequest().path).toBe('/crm/v3/objects/contacts/batch/archive');
    expect(outcome).toMatchObject({ status: 'COMPLETE', requested: 3, succeeded: 3, failed: 0 });
  });
});

describe('hubspot_manage_associations', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('lists, creates, and removes against the v4 association API', async () => {
    const tool = new ManageAssociationsTool(harness.associations);

    harness.client.respondWith({ results: [{ toObjectId: 7801, associationTypes: [] }] });
    const listed = await tool.execute(
      {
        action: 'list',
        objectType: 'contacts',
        recordId: '512',
        toObjectType: 'companies',
        limit: 100,
      },
      toolContext()
    );
    expect(harness.client.lastRequest().path).toBe(
      '/crm/v4/objects/contacts/512/associations/companies'
    );
    expect(listed.count).toBe(1);

    harness.client.respondWith(null);
    await tool.execute(
      {
        action: 'create',
        objectType: 'deals',
        recordId: '9001',
        toObjectType: 'companies',
        toObjectId: '7801',
        limit: 100,
      },
      toolContext()
    );
    const created = harness.client.lastRequest();
    expect(created.method).toBe('PUT');
    // PUT is idempotent — associating twice is a no-op, so it stays retryable.
    expect(created.retryable).toBe(true);
    expect(created.body).toEqual([
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 341 },
    ]);

    harness.client.respondWith(null);
    await tool.execute(
      {
        action: 'delete',
        objectType: 'deals',
        recordId: '9001',
        toObjectType: 'companies',
        toObjectId: '7801',
        limit: 100,
      },
      toolContext()
    );
    expect(harness.client.lastRequest().method).toBe('DELETE');
  });
});

describe('hubspot_create_engagement', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('creates each engagement type on the right object, associated in one request', async () => {
    const tool = new CreateEngagementTool(harness.engagements);

    harness.client.respondWith({ id: 'note-1', properties: {} });
    await tool.execute(
      {
        objectType: 'companies',
        recordId: '7801',
        engagementType: 'note',
        note: { body: 'Checked in with the account team.' },
      },
      toolContext()
    );

    const noteRequest = harness.client.lastRequest();
    expect(noteRequest.path).toBe('/crm/v3/objects/notes');
    // notes -> companies is 190. One request creates and associates, so a
    // failure cannot leave an orphaned note behind.
    expect(noteRequest.body).toMatchObject({
      associations: [{ to: { id: '7801' }, types: [{ associationTypeId: 190 }] }],
    });
    expect(noteRequest.retryable).toBe(false);

    harness.client.respondWith({ id: 'call-1', properties: {} });
    await tool.execute(
      {
        objectType: 'deals',
        recordId: '9001',
        engagementType: 'call',
        call: {
          title: 'Pricing follow-up',
          durationMs: 900_000,
          direction: 'OUTBOUND',
          status: 'COMPLETED',
        },
      },
      toolContext()
    );

    const callRequest = harness.client.lastRequest();
    expect(callRequest.path).toBe('/crm/v3/objects/calls');
    expect(callRequest.body).toMatchObject({
      properties: { hs_call_title: 'Pricing follow-up', hs_call_duration: '900000' },
    });
  });
});

describe('hubspot_manage_properties', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('dispatches every action to the properties API', async () => {
    const tool = new ManagePropertiesTool(harness.properties);

    harness.client.respondWith({
      results: [{ name: 'dealname', label: 'Deal Name', type: 'string', fieldType: 'text' }],
    });
    const listed = await tool.execute({ action: 'list', objectType: 'deals' }, toolContext());
    expect(harness.client.lastRequest().path).toBe('/crm/v3/properties/deals');
    expect(listed.count).toBe(1);

    harness.client.respondWith({
      name: 'renewal_risk',
      label: 'Renewal Risk',
      type: 'enumeration',
      fieldType: 'select',
    });
    await tool.execute(
      {
        action: 'create',
        objectType: 'contacts',
        propertyName: 'renewal_risk',
        label: 'Renewal Risk',
        type: 'enumeration',
        fieldType: 'select',
        groupName: 'contactinformation',
        options: [{ label: 'Low', value: 'low' }],
      },
      toolContext()
    );
    const created = harness.client.lastRequest();
    expect(created.method).toBe('POST');
    expect(created.body).toMatchObject({ name: 'renewal_risk', groupName: 'contactinformation' });

    harness.client.respondWith({ id: '9001', propertiesWithHistory: { amount: [] } });
    const history = await tool.execute(
      {
        action: 'history',
        objectType: 'deals',
        recordId: '9001',
        propertyNames: ['amount'],
      },
      toolContext()
    );
    expect(harness.client.lastRequest().query).toMatchObject({ propertiesWithHistory: 'amount' });
    expect(history.history).toBeDefined();
  });
});

describe('hubspot_merge_records and hubspot_list_pipelines', () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it('merges into the primary record', async () => {
    harness.client.respondWith({ id: '512', properties: { email: 'jane@acme.com' } });

    const result = await new MergeRecordsTool(harness.crm).execute(
      {
        objectType: 'contacts',
        primaryRecordId: '512',
        recordIdToMerge: '513',
        confirmMerge: true,
      },
      toolContext()
    );

    expect(harness.client.lastRequest().body).toEqual({
      primaryObjectId: '512',
      objectIdToMerge: '513',
    });
    expect(result.survivingRecordId).toBe('512');
    expect(result.mergedRecordId).toBe('513');
  });

  it('reads pipelines for the requested object type', async () => {
    harness.client.respondWith({
      results: [
        {
          id: 'default',
          label: 'Sales Pipeline',
          stages: [
            { id: 'contractsent', label: 'Contract Sent', metadata: { probability: '0.8' } },
          ],
        },
      ],
    });

    const result = await new ListPipelinesTool(harness.crm).execute(
      { objectType: 'deals' },
      toolContext()
    );

    expect(harness.client.lastRequest().path).toBe('/crm/v3/pipelines/deals');
    expect(result.pipelines[0]?.stages[0]).toMatchObject({
      id: 'contractsent',
      probability: 0.8,
      isClosed: false,
    });
  });
});
