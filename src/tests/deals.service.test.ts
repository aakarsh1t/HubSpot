import { describe, expect, it } from 'vitest';
import { DealsService } from '../services/deals.service.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger } from './helpers/fixtures.js';

/**
 * As with CompaniesService, the generic CRUD/search/batch/merge behaviour
 * DealsService composes from `CrmObjectService` is already covered via
 * contacts.service.test.ts. These tests focus on what is genuinely
 * deal-specific: association type ID resolution, and the five methods with
 * no generic-base equivalent — pipelines, stage moves, and forecast category.
 */

function buildService(): { service: DealsService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  const service = new DealsService({ client: client.asClient(), logger: testLogger() });
  return { service, client };
}

const dealResponse = {
  id: '9001',
  properties: { dealname: 'Acme - Enterprise', dealstage: 'appointmentscheduled' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archived: false,
};

describe('DealsService.create', () => {
  it('posts to the deals object path', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.create({ properties: { dealname: 'Acme - Enterprise' } });

    expect(client.lastRequest().path).toBe('/crm/v3/objects/deals');
    expect(client.lastRequest().retryable).toBe(false);
  });

  it('resolves the deal-to-contact association type ID (3), the corrected value', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.create({
      properties: { dealname: 'x' },
      associations: [{ toObjectType: 'contacts', toObjectId: '512' }],
    });

    const body = client.lastRequest().body as {
      associations: { types: { associationTypeId: number }[] }[];
    };
    // 3 is deal→contact. 4 (contact→deal, the reverse) would be wrong here —
    // this is the exact pair that was backwards in the original shipped table.
    expect(body.associations[0]?.types[0]?.associationTypeId).toBe(3);
  });

  it('resolves the deal-to-company association type ID (341)', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.create({
      properties: { dealname: 'x' },
      associations: [{ toObjectType: 'companies', toObjectId: '7801' }],
    });

    const body = client.lastRequest().body as {
      associations: { types: { associationTypeId: number }[] }[];
    };
    expect(body.associations[0]?.types[0]?.associationTypeId).toBe(341);
  });
});

describe('DealsService reads', () => {
  it('requests the deal default property set', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.getById({ dealId: '9001' });

    const properties = String(client.lastRequest().query?.properties);
    expect(properties).toContain('dealstage');
    expect(properties).toContain('hs_forecast_category');
    expect(properties).not.toContain('domain');
  });
});

describe('DealsService.listPipelines / getPipeline', () => {
  it('lists pipelines and normalises stage metadata', async () => {
    const { service, client } = buildService();
    client.respondWith({
      results: [
        {
          id: 'default',
          label: 'Sales Pipeline',
          displayOrder: 0,
          stages: [
            {
              id: 'appointmentscheduled',
              label: 'Appointment Scheduled',
              displayOrder: 0,
              metadata: { probability: '0.2', isClosed: 'false' },
            },
            {
              id: 'closedwon',
              label: 'Closed Won',
              displayOrder: 1,
              metadata: { probability: '1.0', isClosed: 'true' },
            },
          ],
        },
      ],
    });

    const pipelines = await service.listPipelines();

    expect(client.lastRequest().path).toBe('/crm/v3/pipelines/deals');
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages[0]).toEqual({
      id: 'appointmentscheduled',
      label: 'Appointment Scheduled',
      displayOrder: 0,
      probability: 0.2,
      isClosed: false,
    });
    expect(pipelines[0]?.stages[1]?.isClosed).toBe(true);
  });

  it('gets a single pipeline by ID', async () => {
    const { service, client } = buildService();
    client.respondWith({ id: 'default', label: 'Sales Pipeline', displayOrder: 0, stages: [] });

    await service.getPipeline('default');

    expect(client.lastRequest().path).toBe('/crm/v3/pipelines/deals/default');
  });

  it('defaults missing probability to null rather than 0', async () => {
    const { service, client } = buildService();
    client.respondWith({
      results: [
        {
          id: 'default',
          label: 'Sales',
          stages: [{ id: 's1', label: 'Stage 1', metadata: {} }],
        },
      ],
    });

    const pipelines = await service.listPipelines();
    expect(pipelines[0]?.stages[0]?.probability).toBeNull();
  });
});

describe('DealsService.moveStage', () => {
  it('PATCHes only dealstage', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.moveStage('9001', 'closedwon');

    expect(client.lastRequest().method).toBe('PATCH');
    expect(client.lastRequest().path).toBe('/crm/v3/objects/deals/9001');
    expect(client.lastRequest().body).toEqual({ properties: { dealstage: 'closedwon' } });
  });
});

describe('DealsService.changePipeline', () => {
  it('sets pipeline and dealstage together in one request', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.changePipeline('9001', 'other-pipeline', 'newstage');

    // Both in a single PATCH: a deal must never be left with a pipeline and
    // stage that disagree, which two separate calls could momentarily produce.
    expect(client.requests).toHaveLength(1);
    expect(client.lastRequest().body).toEqual({
      properties: { pipeline: 'other-pipeline', dealstage: 'newstage' },
    });
  });
});

describe('DealsService.setForecastCategory', () => {
  it('sets hs_forecast_category', async () => {
    const { service, client } = buildService();
    client.respondWith(dealResponse);

    await service.setForecastCategory('9001', 'commit');

    expect(client.lastRequest().body).toEqual({ properties: { hs_forecast_category: 'commit' } });
  });
});

describe('DealsService destructive operations', () => {
  it('excludes computed fields from the read-only set correctly (probability is read-only, amount is not)', async () => {
    const { service, client } = buildService();
    client.respondWith(
      {
        id: '9001',
        properties: {
          dealname: 'Acme',
          amount: '50000',
          hs_deal_stage_probability: '0.5',
          hs_is_closed: 'false',
        },
        archived: true,
      },
      { id: '9999', properties: {}, archived: false }
    );

    await service.recreateFromArchive({ dealId: '9001' });

    const createBody = client.requests[1]?.body as { properties: Record<string, unknown> };
    expect(createBody.properties).toEqual({ dealname: 'Acme', amount: '50000' });
    expect(createBody.properties).not.toHaveProperty('hs_deal_stage_probability');
  });
});
