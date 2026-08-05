import { describe, expect, it } from 'vitest';
import { mapHubSpotHttpError } from '../clients/hubspot-error.mapper.js';
import { AssociationsService } from '../services/associations.service.js';
import { ContactsService } from '../services/contacts.service.js';
import { EngagementsService } from '../services/engagements.service.js';
import { CreateContactTool } from '../tools/crm/contacts/create-contact.tool.js';
import { DeleteContactTool } from '../tools/crm/contacts/delete-contact.tool.js';
import { MergeContactsTool } from '../tools/crm/contacts/merge-contacts.tool.js';
import { RestoreContactTool } from '../tools/crm/contacts/restore-contact.tool.js';
import { CreateNoteTool } from '../tools/crm/engagements/create-note.tool.js';
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

function buildContacts(): { service: ContactsService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  return {
    service: new ContactsService({ client: client.asClient(), logger: testLogger() }),
    client,
  };
}

describe('CreateContactTool through the registry', () => {
  it('validates, executes, and shapes a successful result', async () => {
    const { service, client } = buildContacts();
    client.respondWith({
      id: '512',
      properties: { email: 'jane@acme.com' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archived: false,
    });

    const registry = new ToolRegistry(testLogger());
    const tool = new CreateContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { properties: { email: 'jane@acme.com' } },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ id: '512' });
  });

  it('rejects an empty properties object before ever calling HubSpot', async () => {
    const { service, client } = buildContacts();
    const registry = new ToolRegistry(testLogger());
    const tool = new CreateContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(tool, { properties: {} }, { signal, sessionId: null });

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });

  it('surfaces a HubSpot duplicate-email conflict as a structured tool error', async () => {
    const { service, client } = buildContacts();
    // FakeHubSpotClient stands in for the already-adapted `HubSpotClient.request()`,
    // not the raw SDK — so it must reject with the same mapped AppError that
    // real client produces, via the real mapper, not an SDK-shaped exception.
    client.failWith(
      mapHubSpotHttpError(409, { message: 'Contact already exists with email jane@acme.com' })
    );

    const registry = new ToolRegistry(testLogger());
    const tool = new CreateContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { properties: { email: 'jane@acme.com' } },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('already exists');
  });

  it('declares itself not idempotent, since retrying could create a duplicate', () => {
    const tool = new CreateContactTool(buildContacts().service);
    expect(tool.annotations.idempotentHint).toBe(false);
  });
});

describe('Destructive tool confirmation gates, enforced end-to-end', () => {
  it('DeleteContactTool rejects a call missing confirmPermanentDeletion', async () => {
    const { service, client } = buildContacts();
    const registry = new ToolRegistry(testLogger());
    const tool = new DeleteContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(tool, { contactId: '512' }, { signal, sessionId: null });

    expect(result.isError).toBe(true);
    // The agent must be able to recognise and correct a validation failure.
    expect(textOf(result)).toContain('VALIDATION_FAILED');
    // Nothing must have reached HubSpot for an unconfirmed permanent deletion.
    expect(client.requests).toHaveLength(0);
  });

  it('DeleteContactTool proceeds only with the literal confirmation', async () => {
    const { service, client } = buildContacts();
    client.respondWith(null);

    const registry = new ToolRegistry(testLogger());
    const tool = new DeleteContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { contactId: '512', confirmPermanentDeletion: true },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    expect(client.lastRequest().path).toBe('/crm/v3/objects/contacts/gdpr-delete');
  });

  it('MergeContactsTool rejects self-merge before touching HubSpot', async () => {
    const { service, client } = buildContacts();
    const registry = new ToolRegistry(testLogger());
    const tool = new MergeContactsTool(service);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { primaryContactId: '512', contactIdToMerge: '512', confirmMerge: true },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });

  it('MergeContactsTool rejects a missing confirmation', async () => {
    const { service } = buildContacts();
    const registry = new ToolRegistry(testLogger());
    const tool = new MergeContactsTool(service);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { primaryContactId: '512', contactIdToMerge: '513' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
  });
});

describe('RestoreContactTool honesty about HubSpot limitations', () => {
  it('reports restoredAsNewRecord: true and a different id, never claiming an in-place restore', async () => {
    const { service, client } = buildContacts();
    client.respondWith(
      { id: '512', properties: { email: 'jane@acme.com' }, archived: true },
      { id: '999', properties: { email: 'jane@acme.com' }, archived: false }
    );

    const registry = new ToolRegistry(testLogger());
    const tool = new RestoreContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { contactId: '512', confirmRecreate: true },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    const output = result.structuredContent as {
      restoredAsNewRecord: boolean;
      originalContactId: string;
      newContactId: string;
      notRestored: string[];
    };

    expect(output.restoredAsNewRecord).toBe(true);
    expect(output.originalContactId).toBe('512');
    expect(output.newContactId).toBe('999');
    expect(output.newContactId).not.toBe(output.originalContactId);
    expect(output.notRestored.length).toBeGreaterThan(0);
  });

  it('rejects a restore call without confirmRecreate', async () => {
    const { service, client } = buildContacts();
    const registry = new ToolRegistry(testLogger());
    const tool = new RestoreContactTool(service);
    registry.register(tool);

    const result = await registry.invoke(tool, { contactId: '512' }, { signal, sessionId: null });

    expect(result.isError).toBe(true);
    expect(client.requests).toHaveLength(0);
  });

  it('states in its description that no un-archive API exists', () => {
    const tool = new RestoreContactTool(buildContacts().service);
    expect(tool.description).toMatch(/no API to un-archive|NEW record/i);
  });
});

describe('CreateNoteTool', () => {
  it('creates a note and reports it is not idempotent', async () => {
    const client = new FakeHubSpotClient();
    const engagements = new EngagementsService({ client: client.asClient(), logger: testLogger() });
    client.respondWith({ id: '900' });

    const registry = new ToolRegistry(testLogger());
    const tool = new CreateNoteTool(engagements);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { contactId: '512', body: 'Discussed pricing.' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBeUndefined();
    expect(tool.annotations.idempotentHint).toBe(false);
  });

  it('rejects an empty note body', async () => {
    const client = new FakeHubSpotClient();
    const engagements = new EngagementsService({ client: client.asClient(), logger: testLogger() });
    const registry = new ToolRegistry(testLogger());
    const tool = new CreateNoteTool(engagements);
    registry.register(tool);

    const result = await registry.invoke(
      tool,
      { contactId: '512', body: '' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
  });
});

describe('Association service seam reused by tools', () => {
  it('resolves the correct default association type without a caller needing to know it', async () => {
    const client = new FakeHubSpotClient();
    const associations = new AssociationsService({
      client: client.asClient(),
      logger: testLogger(),
    });
    client.respondWith({});

    await associations.create({ contactId: '512', toObjectType: 'deals', toObjectId: '99' });

    // 3 is the verified contact→deal association type ID.
    expect(client.lastRequest().body).toEqual([
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 },
    ]);
  });
});
