import { describe, expect, it } from 'vitest';
import { CompaniesService } from '../services/companies.service.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger } from './helpers/fixtures.js';

/**
 * CompaniesService composes the generic `CrmObjectService` for everything
 * identical across object types (create/update/search/batch/merge/restore),
 * which is already exercised thoroughly via ContactsService's 28 tests in
 * contacts.service.test.ts — that coverage transfers, since both classes
 * wrap the same shared implementation. These tests focus on what is
 * genuinely specific to Companies: which object-type path it hits and which
 * association type IDs it resolves.
 */

function buildService(): { service: CompaniesService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  const service = new CompaniesService({ client: client.asClient(), logger: testLogger() });
  return { service, client };
}

const companyResponse = {
  id: '7801',
  properties: { name: 'Acme Corp', domain: 'acme.com' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archived: false,
};

describe('CompaniesService.create', () => {
  it('posts to the companies object path', async () => {
    const { service, client } = buildService();
    client.respondWith(companyResponse);

    await service.create({ properties: { name: 'Acme Corp' } });

    expect(client.lastRequest().path).toBe('/crm/v3/objects/companies');
    expect(client.lastRequest().retryable).toBe(false);
  });

  it('resolves the company-to-contact association type ID (280), not contact-to-company (279)', async () => {
    const { service, client } = buildService();
    client.respondWith(companyResponse);

    await service.create({
      properties: { name: 'Acme Corp' },
      associations: [{ toObjectType: 'contacts', toObjectId: '512' }],
    });

    const body = client.lastRequest().body as {
      associations: { to: { id: string }; types: { associationTypeId: number }[] }[];
    };
    // Direction matters: 279 (contact→company) would be silently wrong here.
    expect(body.associations[0]?.types[0]?.associationTypeId).toBe(280);
  });

  it('resolves the company-to-deal association type ID (342)', async () => {
    const { service, client } = buildService();
    client.respondWith(companyResponse);

    await service.create({
      properties: { name: 'Acme Corp' },
      associations: [{ toObjectType: 'deals', toObjectId: '9001' }],
    });

    const body = client.lastRequest().body as {
      associations: { types: { associationTypeId: number }[] }[];
    };
    expect(body.associations[0]?.types[0]?.associationTypeId).toBe(342);
  });
});

describe('CompaniesService reads', () => {
  it('requests the company default property set', async () => {
    const { service, client } = buildService();
    client.respondWith(companyResponse);

    await service.getById({ companyId: '7801' });

    const properties = String(client.lastRequest().query?.properties);
    expect(properties).toContain('domain');
    expect(properties).toContain('industry');
    // Contact-specific defaults must not leak into the company default set.
    expect(properties).not.toContain('jobtitle');
  });

  it('reads an archived company via the archived query flag', async () => {
    const { service, client } = buildService();
    client.respondWith({ ...companyResponse, archived: true });

    const company = await service.getById({ companyId: '7801', archived: true });

    expect(client.lastRequest().query?.archived).toBe('true');
    expect(company.archived).toBe(true);
  });
});

describe('CompaniesService destructive operations', () => {
  it('archives via DELETE on the companies path', async () => {
    const { service, client } = buildService();
    client.respondWith(null);

    await service.archive('7801');

    expect(client.lastRequest().method).toBe('DELETE');
    expect(client.lastRequest().path).toBe('/crm/v3/objects/companies/7801');
  });

  it('uses the companies GDPR-delete endpoint', async () => {
    const { service, client } = buildService();
    client.respondWith(null);

    await service.deletePermanently('7801');

    expect(client.lastRequest().path).toBe('/crm/v3/objects/companies/gdpr-delete');
    expect(client.lastRequest().body).toEqual({ objectId: '7801' });
  });

  it('strips company-specific read-only properties when recreating from archive', async () => {
    const { service, client } = buildService();
    client.respondWith(
      {
        id: '7801',
        properties: { name: 'Acme Corp', hs_all_team_ids: '1;2', createdate: '2026-01-01' },
        archived: true,
      },
      { id: '9999', properties: {}, archived: false }
    );

    await service.recreateFromArchive({ companyId: '7801' });

    const createBody = client.requests[1]?.body as { properties: Record<string, unknown> };
    expect(createBody.properties).toEqual({ name: 'Acme Corp' });
  });
});

describe('CompaniesService batch operations', () => {
  it('wraps batch create for companies', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [companyResponse] });

    await service.batchCreate({ companies: [{ properties: { name: 'Acme Corp' } }] });

    expect(client.lastRequest().path).toBe('/crm/v3/objects/companies/batch/create');
  });

  it('maps companyId to id for batch update', async () => {
    const { service, client } = buildService();
    client.respondWith({ results: [companyResponse] });

    await service.batchUpdate({
      companies: [{ companyId: '7801', properties: { lifecyclestage: 'customer' } }],
    });

    expect(client.lastRequest().body).toEqual({
      inputs: [{ id: '7801', properties: { lifecyclestage: 'customer' } }],
    });
  });
});
