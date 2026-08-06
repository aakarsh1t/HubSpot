import { describe, expect, it } from 'vitest';
import { CompaniesService } from '../services/companies.service.js';
import { DealsService } from '../services/deals.service.js';
import { PropertiesService } from '../services/properties.service.js';
import { CreateCompanyTool } from '../tools/crm/companies/create-company.tool.js';
import { DeleteCompanyTool } from '../tools/crm/companies/delete-company.tool.js';
import { RestoreCompanyTool } from '../tools/crm/companies/restore-company.tool.js';
import { ChangeDealPipelineTool } from '../tools/crm/deals/change-deal-pipeline.tool.js';
import { CreateDealTool } from '../tools/crm/deals/create-deal.tool.js';
import { MergeDealsTool } from '../tools/crm/deals/merge-deals.tool.js';
import { MoveDealStageTool } from '../tools/crm/deals/move-deal-stage.tool.js';
import { DeletePropertyTool } from '../tools/crm/properties/delete-property.tool.js';
import { ListPropertiesTool } from '../tools/crm/properties/list-properties.tool.js';
import { ToolRegistry } from '../tools/tool.registry.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger } from './helpers/fixtures.js';

const signal = new AbortController().signal;

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const first = result.content[0];
  if (first?.type !== 'text' || first.text === undefined) {
    throw new Error('Expected a text content block.');
  }
  return first.text;
}

describe('CreateCompanyTool through the registry', () => {
  it('creates a company and returns structured content', async () => {
    const client = new FakeHubSpotClient();
    const companies = new CompaniesService({ client: client.asClient(), logger: testLogger() });
    client.respondWith({
      id: '7801',
      properties: { name: 'Acme Corp' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archived: false,
    });

    const registry = new ToolRegistry(testLogger());
    const tool = new CreateCompanyTool(companies);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { properties: { name: 'Acme Corp' } },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ id: '7801' });
  });

  it('rejects an empty properties object before calling HubSpot', async () => {
    const client = new FakeHubSpotClient();
    const companies = new CompaniesService({ client: client.asClient(), logger: testLogger() });
    const registry = new ToolRegistry(testLogger());
    const tool = new CreateCompanyTool(companies);
    registry.register(tool);

    const result = await registry.invoke(tool, { properties: {} }, { signal, sessionId: null });

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });
});

describe('Companies destructive gates', () => {
  it('DeleteCompanyTool rejects a call missing confirmPermanentDeletion', async () => {
    const client = new FakeHubSpotClient();
    const companies = new CompaniesService({ client: client.asClient(), logger: testLogger() });
    const registry = new ToolRegistry(testLogger());
    const tool = new DeleteCompanyTool(companies);
    registry.register(tool);

    const result = await registry.invoke(tool, { companyId: '7801' }, { signal, sessionId: null });

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });

  it('RestoreCompanyTool never claims an in-place restore', async () => {
    const client = new FakeHubSpotClient();
    const companies = new CompaniesService({ client: client.asClient(), logger: testLogger() });
    client.respondWith(
      { id: '7801', properties: { name: 'Acme Corp' }, archived: true },
      { id: '9999', properties: { name: 'Acme Corp' }, archived: false }
    );

    const registry = new ToolRegistry(testLogger());
    const tool = new RestoreCompanyTool(companies);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { companyId: '7801', confirmRecreate: true },
      { signal, sessionId: null }
    );

    const output = result.structuredContent as { newCompanyId: string; originalCompanyId: string };
    expect(output.newCompanyId).not.toBe(output.originalCompanyId);
  });
});

describe('CreateDealTool and deal-specific tools', () => {
  it('creates a deal', async () => {
    const client = new FakeHubSpotClient();
    const deals = new DealsService({ client: client.asClient(), logger: testLogger() });
    client.respondWith({
      id: '9001',
      properties: { dealname: 'Acme deal' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archived: false,
    });

    const registry = new ToolRegistry(testLogger());
    const tool = new CreateDealTool(deals);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { properties: { dealname: 'Acme deal' } },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
  });

  it('MoveDealStageTool sends only dealstage in the PATCH', async () => {
    const client = new FakeHubSpotClient();
    const deals = new DealsService({ client: client.asClient(), logger: testLogger() });
    client.respondWith({ id: '9001', properties: {}, archived: false });

    const registry = new ToolRegistry(testLogger());
    const tool = new MoveDealStageTool(deals);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { dealId: '9001', stageId: 'closedwon' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    expect(client.lastRequest().body).toEqual({ properties: { dealstage: 'closedwon' } });
  });

  it('ChangeDealPipelineTool requires both pipelineId and stageId at the schema level', async () => {
    const client = new FakeHubSpotClient();
    const deals = new DealsService({ client: client.asClient(), logger: testLogger() });
    const registry = new ToolRegistry(testLogger());
    const tool = new ChangeDealPipelineTool(deals);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { dealId: '9001', pipelineId: 'p2' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });

  it('MergeDealsTool rejects self-merge before touching HubSpot', async () => {
    const client = new FakeHubSpotClient();
    const deals = new DealsService({ client: client.asClient(), logger: testLogger() });
    const registry = new ToolRegistry(testLogger());
    const tool = new MergeDealsTool(deals);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { primaryDealId: '9001', dealIdToMerge: '9001', confirmMerge: true },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });
});

describe('Property tools', () => {
  it('ListPropertiesTool returns properties for the requested object type', async () => {
    const client = new FakeHubSpotClient();
    const properties = new PropertiesService({ client: client.asClient(), logger: testLogger() });
    client.respondWith({
      results: [
        { name: 'dealstage', label: 'Deal Stage', type: 'enumeration', fieldType: 'select' },
      ],
    });

    const registry = new ToolRegistry(testLogger());
    const tool = new ListPropertiesTool(properties);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { objectType: 'deals' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as { count: number };
    expect(output.count).toBe(1);
  });

  it('DeletePropertyTool rejects a call missing confirmDeletion', async () => {
    const client = new FakeHubSpotClient();
    const properties = new PropertiesService({ client: client.asClient(), logger: testLogger() });
    const registry = new ToolRegistry(testLogger());
    const tool = new DeletePropertyTool(properties);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { objectType: 'contacts', propertyName: 'renewal_risk' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('VALIDATION_FAILED');
    expect(client.requests).toHaveLength(0);
  });

  it('DeletePropertyTool proceeds only with confirmDeletion: true', async () => {
    const client = new FakeHubSpotClient();
    const properties = new PropertiesService({ client: client.asClient(), logger: testLogger() });
    client.respondWith(null);

    const registry = new ToolRegistry(testLogger());
    const tool = new DeletePropertyTool(properties);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { objectType: 'contacts', propertyName: 'renewal_risk', confirmDeletion: true },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    expect(client.lastRequest().path).toBe('/crm/v3/properties/contacts/renewal_risk');
  });
});
