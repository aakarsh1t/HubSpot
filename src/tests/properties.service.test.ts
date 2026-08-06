import { describe, expect, it } from 'vitest';
import { PropertiesService } from '../services/properties.service.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger } from './helpers/fixtures.js';

function buildService(): { service: PropertiesService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  const service = new PropertiesService({ client: client.asClient(), logger: testLogger() });
  return { service, client };
}

describe('PropertiesService.list', () => {
  it('lists properties for an object type', async () => {
    const { service, client } = buildService();
    client.respondWith({
      results: [
        {
          name: 'lifecyclestage',
          label: 'Lifecycle Stage',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'contactinformation',
          options: [{ label: 'Lead', value: 'lead' }],
        },
      ],
    });

    const properties = await service.list('contacts');

    expect(client.lastRequest().path).toBe('/crm/v3/properties/contacts');
    expect(properties).toHaveLength(1);
    expect(properties[0]?.options).toEqual([{ label: 'Lead', value: 'lead' }]);
  });

  it('defaults optional fields to safe values when HubSpot omits them', async () => {
    const { service, client } = buildService();
    client.respondWith({
      results: [{ name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' }],
    });

    const properties = await service.list('deals');

    expect(properties[0]).toMatchObject({
      groupName: null,
      description: null,
      options: [],
      hidden: false,
      hasUniqueValue: false,
      calculated: false,
    });
  });
});

describe('PropertiesService.get', () => {
  it('reads a single property by name', async () => {
    const { service, client } = buildService();
    client.respondWith({
      name: 'dealstage',
      label: 'Deal Stage',
      type: 'enumeration',
      fieldType: 'select',
    });

    await service.get('deals', 'dealstage');

    expect(client.lastRequest().path).toBe('/crm/v3/properties/deals/dealstage');
  });
});

describe('PropertiesService.create', () => {
  it('posts the property definition and is non-retryable', async () => {
    const { service, client } = buildService();
    client.respondWith({
      name: 'renewal_risk',
      label: 'Renewal Risk',
      type: 'enumeration',
      fieldType: 'select',
    });

    await service.create('contacts', {
      name: 'renewal_risk',
      label: 'Renewal Risk',
      type: 'enumeration',
      fieldType: 'select',
      groupName: 'contactinformation',
      options: [{ label: 'Low', value: 'low' }],
    });

    const request = client.lastRequest();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/crm/v3/properties/contacts');
    expect(request.body).toMatchObject({
      name: 'renewal_risk',
      groupName: 'contactinformation',
      options: [{ label: 'Low', value: 'low' }],
    });
    expect(request.retryable).toBe(false);
  });

  it('omits description and options entirely when not supplied', async () => {
    const { service, client } = buildService();
    client.respondWith({ name: 'x', label: 'X', type: 'string', fieldType: 'text' });

    await service.create('deals', {
      name: 'x',
      label: 'X',
      type: 'string',
      fieldType: 'text',
      groupName: 'dealinformation',
    });

    const body = client.lastRequest().body as Record<string, unknown>;
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('options');
  });
});

describe('PropertiesService.update', () => {
  it('PATCHes only the supplied fields', async () => {
    const { service, client } = buildService();
    client.respondWith({
      name: 'renewal_risk',
      label: 'Churn Risk',
      type: 'enumeration',
      fieldType: 'select',
    });

    await service.update('contacts', 'renewal_risk', { label: 'Churn Risk' });

    const request = client.lastRequest();
    expect(request.method).toBe('PATCH');
    expect(request.path).toBe('/crm/v3/properties/contacts/renewal_risk');
    expect(request.body).toEqual({ label: 'Churn Risk' });
    expect(request.retryable).toBe(true);
  });

  it('replaces the full options array rather than merging', async () => {
    const { service, client } = buildService();
    client.respondWith({ name: 'x', label: 'X', type: 'enumeration', fieldType: 'select' });

    await service.update('contacts', 'renewal_risk', {
      options: [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
    });

    const body = client.lastRequest().body as { options: unknown[] };
    expect(body.options).toHaveLength(2);
  });
});

describe('PropertiesService.delete', () => {
  it('DELETEs the property definition and is non-retryable', async () => {
    const { service, client } = buildService();
    client.respondWith(null);

    await service.delete('deals', 'competitor_name');

    const request = client.lastRequest();
    expect(request.method).toBe('DELETE');
    expect(request.path).toBe('/crm/v3/properties/deals/competitor_name');
    expect(request.retryable).toBe(false);
  });
});

describe('PropertiesService.getHistory', () => {
  it('requests propertiesWithHistory and normalises entries', async () => {
    const { service, client } = buildService();
    client.respondWith({
      id: '9001',
      propertiesWithHistory: {
        dealstage: [
          {
            value: 'closedwon',
            timestamp: '2026-06-01T00:00:00Z',
            sourceType: 'CRM_UI',
            sourceId: null,
            sourceLabel: null,
            updatedByUserId: 42,
          },
          {
            value: 'appointmentscheduled',
            timestamp: '2026-01-01T00:00:00Z',
            sourceType: 'CRM_UI',
            updatedByUserId: 42,
          },
        ],
      },
    });

    const result = await service.getHistory('deals', '9001', ['dealstage']);

    expect(client.lastRequest().query?.propertiesWithHistory).toBe('dealstage');
    expect(result.objectId).toBe('9001');
    expect(result.history.dealstage).toHaveLength(2);
  });

  it('sorts history entries newest first regardless of API order', async () => {
    const { service, client } = buildService();
    client.respondWith({
      id: '9001',
      propertiesWithHistory: {
        amount: [
          { value: '10000', timestamp: '2026-01-01T00:00:00Z' },
          { value: '50000', timestamp: '2026-06-01T00:00:00Z' },
        ],
      },
    });

    const result = await service.getHistory('deals', '9001', ['amount']);

    expect(result.history.amount?.[0]?.value).toBe('50000');
    expect(result.history.amount?.[1]?.value).toBe('10000');
  });

  it('handles a record with no history for the requested properties', async () => {
    const { service, client } = buildService();
    // A response with no propertiesWithHistory key at all must not throw.
    client.respondWith({ id: '9001' });

    const result = await service.getHistory('deals', '9001', ['amount']);
    expect(result.history).toEqual({});
  });
});
