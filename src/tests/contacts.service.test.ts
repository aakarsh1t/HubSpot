import { describe, expect, it } from 'vitest';
import { ContactsService } from '../services/contacts.service.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger } from './helpers/fixtures.js';

function buildService(): { service: ContactsService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  const service = new ContactsService({ client: client.asClient(), logger: testLogger() });
  return { service, client };
}

const contactResponse = {
  id: '512',
  properties: { email: 'jane@acme.com', firstname: 'Jane' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  archived: false,
};

describe('ContactsService.create', () => {
  it('posts properties and returns the created contact', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    const created = await service.create({
      properties: { email: 'jane@acme.com', firstname: 'Jane' },
    });

    const request = client.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/crm/v3/objects/contacts');
    expect(request.body).toEqual({
      properties: { email: 'jane@acme.com', firstname: 'Jane' },
    });
    expect(created.id).toBe('512');
  });

  it('marks creation non-retryable so a timeout cannot duplicate a contact', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.create({ properties: { email: 'jane@acme.com' } });

    expect(client.lastRequest().retryable).toBe(false);
  });

  it('coerces non-string property values, since HubSpot stores everything as strings', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.create({
      properties: { email: 'jane@acme.com', numemployees: 250, is_vip: true, jobtitle: null },
    });

    expect((client.lastRequest().body as { properties: unknown }).properties).toEqual({
      email: 'jane@acme.com',
      numemployees: '250',
      is_vip: 'true',
      // null is preserved rather than stringified: it means "clear this".
      jobtitle: null,
    });
  });

  it('translates association shorthand into HubSpot association objects', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.create({
      properties: { email: 'jane@acme.com' },
      associations: [{ toObjectType: 'companies', toObjectId: '7801' }],
    });

    expect((client.lastRequest().body as { associations: unknown }).associations).toEqual([
      {
        to: { id: '7801' },
        // 279 is the verified contact→company type ID; the reverse (280) would
        // be rejected by HubSpot.
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 }],
      },
    ]);
  });
});

describe('ContactsService.update', () => {
  it('PATCHes by id and stays retryable because it is idempotent', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.update({ contactId: '512', properties: { lifecyclestage: 'customer' } });

    const request = client.lastRequest();
    expect(request.method).toBe('PATCH');
    expect(request.path).toBe('/crm/v3/objects/contacts/512');
    expect(request.retryable).toBe(true);
  });
});

describe('ContactsService reads', () => {
  it('requests a useful default property set', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.getById({ contactId: '512' });

    const properties = String(client.lastRequest().query?.properties);
    expect(properties).toContain('email');
    expect(properties).toContain('lifecyclestage');
  });

  it('passes the archived flag through so deleted records can be inspected', async () => {
    const { service, client } = buildService();
    client.respondWith({ ...contactResponse, archived: true });

    const contact = await service.getById({ contactId: '512', archived: true });

    expect(client.lastRequest().query?.archived).toBe('true');
    expect(contact.archived).toBe(true);
  });

  it('flattens the associations block into id arrays', async () => {
    const { service, client } = buildService();
    client.respondWith({
      ...contactResponse,
      associations: {
        companies: {
          results: [
            { id: '7801', type: 'x' },
            { id: '7802', type: 'x' },
          ],
        },
      },
    });

    const contact = await service.getById({ contactId: '512', associations: ['companies'] });

    expect(contact.associations).toEqual({ companies: ['7801', '7802'] });
  });

  it('looks a contact up by email via idProperty rather than a search', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.getByEmail({ email: 'jane@acme.com' });

    const request = client.lastRequest();
    expect(request.method).toBe('GET');
    // An indexed alternate-key read, not the separately rate-limited search API.
    expect(request.query?.idProperty).toBe('email');
    expect(request.path).toContain('jane%40acme.com');
  });

  it('rewrites a 404 from an email lookup into an actionable message', async () => {
    const { service, client } = buildService();
    client.failWith(new NotFoundError('not found'));

    await expect(service.getByEmail({ email: 'nobody@acme.com' })).rejects.toThrow(
      /No HubSpot contact exists with the email address "nobody@acme.com"/
    );
  });

  it('maps a list response into results plus a paging cursor', async () => {
    const { service, client } = buildService();
    client.respondWith({
      results: [contactResponse],
      paging: { next: { after: 'cursor-2' } },
    });

    const page = await service.list({ limit: 25, archived: false });

    expect(page.results).toHaveLength(1);
    expect(page.after).toBe('cursor-2');
  });

  it('returns a null cursor on the final page', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [contactResponse] });

    expect((await service.list({ limit: 25, archived: false })).after).toBeNull();
  });
});

describe('ContactsService.search', () => {
  it('builds a filterGroups body and posts to the search endpoint', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [contactResponse], total: 1 });

    await service.search({
      filterGroups: [
        { filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' }] },
      ],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 25,
    });

    const request = client.lastRequest();
    expect(request.path).toBe('/crm/v3/objects/contacts/search');
    expect(request.body).toMatchObject({
      filterGroups: [
        { filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' }] },
      ],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 25,
    });
    // A search is a read despite using POST, so replaying it is harmless.
    expect(request.retryable).toBe(true);
  });

  it('omits absent optional fields rather than sending undefined', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [] });

    await service.search({ query: 'acme', limit: 10 });

    const body = client.lastRequest().body as Record<string, unknown>;
    expect(body.query).toBe('acme');
    expect(body).not.toHaveProperty('filterGroups');
    expect(body).not.toHaveProperty('after');
  });

  it('forwards values and highValue for IN and BETWEEN filters', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [] });

    await service.search({
      filterGroups: [
        {
          filters: [
            { propertyName: 'hs_lead_status', operator: 'IN', values: ['NEW', 'OPEN'] },
            { propertyName: 'createdate', operator: 'BETWEEN', value: '1', highValue: '2' },
          ],
        },
      ],
      limit: 25,
    });

    const body = client.lastRequest().body as {
      filterGroups: { filters: Record<string, unknown>[] }[];
    };
    expect(body.filterGroups[0]!.filters[0]).toEqual({
      propertyName: 'hs_lead_status',
      operator: 'IN',
      values: ['NEW', 'OPEN'],
    });
    expect(body.filterGroups[0]!.filters[1]).toMatchObject({ highValue: '2' });
  });
});

describe('ContactsService destructive operations', () => {
  it('archives with DELETE and does not retry', async () => {
    const { service, client } = buildService();
    client.respondWith(null);

    await service.archive('512');

    const request = client.lastRequest();
    expect(request.method).toBe('DELETE');
    expect(request.path).toBe('/crm/v3/objects/contacts/512');
    // A replayed DELETE 404s after succeeding, which would read as a failure.
    expect(request.retryable).toBe(false);
  });

  it('uses the separate GDPR endpoint for permanent deletion', async () => {
    const { service, client } = buildService();
    client.respondWith(null);

    await service.deletePermanently('512');

    const request = client.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/crm/v3/objects/contacts/gdpr-delete');
    expect(request.body).toEqual({ objectId: '512' });
  });

  it('merges using primaryObjectId and objectIdToMerge', async () => {
    const { service, client } = buildService();
    client.respondWith(contactResponse);

    await service.merge('512', '513');

    const request = client.lastRequest();
    expect(request.path).toBe('/crm/v3/objects/contacts/merge');
    expect(request.body).toEqual({ primaryObjectId: '512', objectIdToMerge: '513' });
    expect(request.retryable).toBe(false);
  });
});

describe('ContactsService.recreateFromArchive', () => {
  it('reads the archived record then creates a new one from its properties', async () => {
    const { service, client } = buildService();
    client.respondWith(
      {
        id: '512',
        properties: { email: 'jane@acme.com', firstname: 'Jane' },
        archived: true,
      },
      { id: '999', properties: { email: 'jane@acme.com' }, archived: false }
    );

    const { created } = await service.recreateFromArchive({ contactId: '512' });

    expect(client.requests[0]?.query?.archived).toBe('true');
    expect(client.requests[1]?.method).toBe('POST');
    // A NEW id — HubSpot cannot restore in place.
    expect(created.id).toBe('999');
  });

  it('strips HubSpot-managed read-only properties before recreating', async () => {
    const { service, client } = buildService();
    client.respondWith(
      {
        id: '512',
        properties: {
          email: 'jane@acme.com',
          createdate: '2026-01-01T00:00:00Z',
          lastmodifieddate: '2026-02-01T00:00:00Z',
          hs_object_id: '512',
        },
        archived: true,
      },
      { id: '999', properties: {}, archived: false }
    );

    await service.recreateFromArchive({ contactId: '512' });

    const createBody = client.requests[1]?.body as { properties: Record<string, unknown> };
    expect(createBody.properties).toEqual({ email: 'jane@acme.com' });
    // Sending these back would be rejected by HubSpot as read-only.
    expect(createBody.properties).not.toHaveProperty('createdate');
    expect(createBody.properties).not.toHaveProperty('hs_object_id');
  });

  it('fails clearly when nothing restorable remains', async () => {
    const { service, client } = buildService();
    client.respondWith({ id: '512', properties: { createdate: '2026-01-01' }, archived: true });

    await expect(service.recreateFromArchive({ contactId: '512' })).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe('ContactsService batch operations', () => {
  it('wraps batch create inputs and marks them non-retryable', async () => {
    const { service, client } = buildService();
    client.respondWith({ status: 'COMPLETE', results: [contactResponse] });

    await service.batchCreate({ contacts: [{ properties: { email: 'a@acme.com' } }] });

    const request = client.lastRequest();
    expect(request.path).toBe('/crm/v3/objects/contacts/batch/create');
    expect(request.body).toEqual({ inputs: [{ properties: { email: 'a@acme.com' } }] });
    expect(request.retryable).toBe(false);
  });

  it('reports a fully successful batch as COMPLETE', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [contactResponse, { ...contactResponse, id: '513' }] });

    const outcome = await service.batchCreate({
      contacts: [{ properties: { email: 'a@acme.com' } }, { properties: { email: 'b@acme.com' } }],
    });

    expect(outcome).toMatchObject({ status: 'COMPLETE', requested: 2, succeeded: 2, failed: 0 });
  });

  it('surfaces a partial batch failure instead of reporting success', async () => {
    const { service, client } = buildService();
    client.respondWith({
      results: [contactResponse],
      errors: [{ message: 'Contact already exists', category: 'CONFLICT' }],
    });

    const outcome = await service.batchCreate({
      contacts: [{ properties: { email: 'a@acme.com' } }, { properties: { email: 'b@acme.com' } }],
    });

    // HubSpot answers a mixed batch with 207; a caller checking only the status
    // code would silently lose the failed record.
    expect(outcome.status).toBe('PARTIAL');
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.errors[0]?.message).toBe('Contact already exists');
  });

  it('reports a wholly failed batch as ERROR', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [], errors: [{ message: 'bad' }, { message: 'bad' }] });

    const outcome = await service.batchUpdate({
      contacts: [
        { contactId: '1', properties: { firstname: 'A' } },
        { contactId: '2', properties: { firstname: 'B' } },
      ],
    });

    expect(outcome.status).toBe('ERROR');
    expect(outcome.succeeded).toBe(0);
  });

  it('sends idProperty when batch reading by email', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [contactResponse] });

    await service.batchRead({
      contactIds: ['a@acme.com'],
      idProperty: 'email',
    });

    expect(client.lastRequest().body).toMatchObject({ idProperty: 'email' });
  });

  it('omits idProperty when batch reading by record id', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [contactResponse] });

    await service.batchRead({ contactIds: ['512'], idProperty: 'id' });

    expect(client.lastRequest().body).not.toHaveProperty('idProperty');
  });

  it('archives a batch through the batch endpoint', async () => {
    const { service, client } = buildService();
    client.respondWith(null);

    const count = await service.batchArchive(['1', '2', '3']);

    expect(client.lastRequest().path).toBe('/crm/v3/objects/contacts/batch/archive');
    expect(client.lastRequest().body).toEqual({ inputs: [{ id: '1' }, { id: '2' }, { id: '3' }] });
    expect(count).toBe(3);
  });
});
