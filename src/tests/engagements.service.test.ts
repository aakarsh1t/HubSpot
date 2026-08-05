import { describe, expect, it } from 'vitest';
import { AssociationsService } from '../services/associations.service.js';
import { EngagementsService } from '../services/engagements.service.js';
import { FakeHubSpotClient } from './helpers/fake-hubspot-client.js';
import { testLogger } from './helpers/fixtures.js';

function buildEngagements(): { service: EngagementsService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  const service = new EngagementsService({ client: client.asClient(), logger: testLogger() });
  return { service, client };
}

function buildAssociations(): { service: AssociationsService; client: FakeHubSpotClient } {
  const client = new FakeHubSpotClient();
  const service = new AssociationsService({ client: client.asClient(), logger: testLogger() });
  return { service, client };
}

interface EngagementBody {
  properties: Record<string, string>;
  associations: { to: { id: string }; types: { associationTypeId: number }[] }[];
}

describe('EngagementsService.createNote', () => {
  it('creates the note and its contact association in one request', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '900' });

    await service.createNote({ contactId: '512', body: 'Called about pricing.' });

    const request = client.lastRequest();
    expect(request.path).toBe('/crm/v3/objects/notes');

    const body = request.body as EngagementBody;
    expect(body.properties['hs_note_body']).toBe('Called about pricing.');
    // Two calls would strand an orphaned note if the second failed.
    expect(body.associations[0]?.to.id).toBe('512');
  });

  it('uses the note-to-contact association type ID, not the reverse', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '900' });

    await service.createNote({ contactId: '512', body: 'x' });

    // 202 is note→contact. 201 is contact→note and would be rejected here.
    expect((client.lastRequest().body as EngagementBody).associations[0]?.types[0]).toEqual({
      associationCategory: 'HUBSPOT_DEFINED',
      associationTypeId: 202,
    });
  });

  it('defaults the timestamp to now and never retries', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '900' });

    const before = Date.now();
    await service.createNote({ contactId: '512', body: 'x' });

    const timestamp = (client.lastRequest().body as EngagementBody).properties['hs_timestamp'];
    expect(Date.parse(timestamp!)).toBeGreaterThanOrEqual(before - 1_000);
    // Replaying would duplicate a note on a customer record.
    expect(client.lastRequest().retryable).toBe(false);
  });

  it('normalises a supplied timestamp to ISO 8601', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '900' });

    await service.createNote({
      contactId: '512',
      body: 'x',
      timestamp: '2026-08-01T09:30:00.000Z',
    });

    expect((client.lastRequest().body as EngagementBody).properties['hs_timestamp']).toBe(
      '2026-08-01T09:30:00.000Z'
    );
  });
});

describe('EngagementsService.createTask', () => {
  it('maps the due date onto hs_timestamp and sets task fields', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '901' });

    await service.createTask({
      contactId: '512',
      subject: 'Send deck',
      status: 'NOT_STARTED',
      priority: 'HIGH',
      taskType: 'EMAIL',
      dueDate: '2026-08-12T17:00:00.000Z',
    });

    const properties = (client.lastRequest().body as EngagementBody).properties;
    // HubSpot models a task due date as hs_timestamp, which is unintuitive.
    expect(properties['hs_timestamp']).toBe('2026-08-12T17:00:00.000Z');
    expect(properties['hs_task_subject']).toBe('Send deck');
    expect(properties['hs_task_priority']).toBe('HIGH');
    expect(properties['hs_task_type']).toBe('EMAIL');
  });

  it('uses association type 204 (task to contact)', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '901' });

    await service.createTask({
      contactId: '512',
      subject: 'x',
      status: 'NOT_STARTED',
      priority: 'MEDIUM',
      taskType: 'TODO',
    });

    expect(
      (client.lastRequest().body as EngagementBody).associations[0]?.types[0]?.associationTypeId
    ).toBe(204);
  });

  it('omits the body property entirely when not supplied', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '901' });

    await service.createTask({
      contactId: '512',
      subject: 'x',
      status: 'NOT_STARTED',
      priority: 'MEDIUM',
      taskType: 'TODO',
    });

    expect((client.lastRequest().body as EngagementBody).properties).not.toHaveProperty(
      'hs_task_body'
    );
  });
});

describe('EngagementsService.logCall', () => {
  it('sends duration in milliseconds as a string', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '902' });

    await service.logCall({
      contactId: '512',
      title: 'Discovery',
      durationMs: 1_800_000,
      direction: 'OUTBOUND',
      status: 'COMPLETED',
    });

    const properties = (client.lastRequest().body as EngagementBody).properties;
    expect(properties['hs_call_duration']).toBe('1800000');
    expect(properties['hs_call_direction']).toBe('OUTBOUND');
  });

  it('uses association type 194 (call to contact)', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '902' });

    await service.logCall({
      contactId: '512',
      title: 'x',
      direction: 'INBOUND',
      status: 'COMPLETED',
    });

    expect(
      (client.lastRequest().body as EngagementBody).associations[0]?.types[0]?.associationTypeId
    ).toBe(194);
  });
});

describe('EngagementsService.createMeeting', () => {
  it('sets hs_timestamp to the meeting start time', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '903' });

    await service.createMeeting({
      contactId: '512',
      title: 'Q3 planning',
      startTime: '2026-08-12T14:00:00.000Z',
      endTime: '2026-08-12T15:00:00.000Z',
      outcome: 'SCHEDULED',
    });

    const properties = (client.lastRequest().body as EngagementBody).properties;
    // Matching start time is what places the entry correctly on the timeline.
    expect(properties['hs_timestamp']).toBe('2026-08-12T14:00:00.000Z');
    expect(properties['hs_meeting_start_time']).toBe('2026-08-12T14:00:00.000Z');
    expect(properties['hs_meeting_end_time']).toBe('2026-08-12T15:00:00.000Z');
  });
});

describe('EngagementsService.logEmail', () => {
  it('maps subject, body, direction, and status', async () => {
    const { service, client } = buildEngagements();
    client.respondWith({ id: '904' });

    await service.logEmail({
      contactId: '512',
      subject: 'Pricing',
      body: 'Here you go',
      direction: 'INCOMING_EMAIL',
      status: 'SENT',
    });

    const properties = (client.lastRequest().body as EngagementBody).properties;
    expect(properties['hs_email_subject']).toBe('Pricing');
    expect(properties['hs_email_text']).toBe('Here you go');
    expect(properties['hs_email_direction']).toBe('INCOMING_EMAIL');
  });
});

describe('EngagementsService.getTimeline', () => {
  it('merges activity types and sorts newest first', async () => {
    const client = new FakeHubSpotClient();
    const service = new EngagementsService({ client: client.asClient(), logger: testLogger() });

    // Every association lookup returns one id; every batch read returns two
    // engagements with known timestamps.
    client.respondWith(
      { results: [{ toObjectId: 900 }] },
      {
        results: [
          { id: '900', properties: { hs_timestamp: '2026-01-01T00:00:00Z', hs_note_body: 'old' } },
          { id: '901', properties: { hs_timestamp: '2026-06-01T00:00:00Z', hs_note_body: 'new' } },
        ],
      }
    );

    const timeline = await service.getTimeline({
      contactId: '512',
      types: ['notes'],
      limitPerType: 20,
    });

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[0]?.body).toBe('new');
    expect(timeline.entries[1]?.body).toBe('old');
    expect(timeline.countsByType['notes']).toBe(2);
  });

  it('converts epoch-millisecond timestamps to ISO 8601', async () => {
    const client = new FakeHubSpotClient();
    const service = new EngagementsService({ client: client.asClient(), logger: testLogger() });

    client.respondWith(
      { results: [{ toObjectId: 900 }] },
      { results: [{ id: '900', properties: { hs_timestamp: '1767225600000' } }] }
    );

    const timeline = await service.getTimeline({
      contactId: '512',
      types: ['notes'],
      limitPerType: 20,
    });

    // HubSpot returns either form; the timeline must be uniform.
    expect(timeline.entries[0]?.timestamp).toBe(new Date(1767225600000).toISOString());
  });

  it('skips the batch read entirely when a type has no associations', async () => {
    const client = new FakeHubSpotClient();
    const service = new EngagementsService({ client: client.asClient(), logger: testLogger() });
    client.respondWith({ results: [] });

    const timeline = await service.getTimeline({
      contactId: '512',
      types: ['notes'],
      limitPerType: 20,
    });

    expect(timeline.entries).toEqual([]);
    // One association lookup, and no wasted batch-read round trip.
    expect(client.requests).toHaveLength(1);
  });

  it('flags truncation when a type returns the requested maximum', async () => {
    const client = new FakeHubSpotClient();
    const service = new EngagementsService({ client: client.asClient(), logger: testLogger() });

    client.respondWith(
      { results: [{ toObjectId: 900 }, { toObjectId: 901 }] },
      {
        results: [
          { id: '900', properties: { hs_timestamp: '2026-01-01T00:00:00Z' } },
          { id: '901', properties: { hs_timestamp: '2026-01-02T00:00:00Z' } },
        ],
      }
    );

    const timeline = await service.getTimeline({
      contactId: '512',
      types: ['notes'],
      limitPerType: 2,
    });

    // The caller must know history is incomplete rather than assume it saw all.
    expect(timeline.truncated).toBe(true);
  });

  it('routes type-specific fields into details', async () => {
    const client = new FakeHubSpotClient();
    const service = new EngagementsService({ client: client.asClient(), logger: testLogger() });

    client.respondWith(
      { results: [{ toObjectId: 902 }] },
      {
        results: [
          {
            id: '902',
            properties: {
              hs_timestamp: '2026-01-01T00:00:00Z',
              hs_call_title: 'Discovery',
              hs_call_body: 'notes',
              hs_call_duration: '1800000',
              hubspot_owner_id: '77',
            },
          },
        ],
      }
    );

    const timeline = await service.getTimeline({
      contactId: '512',
      types: ['calls'],
      limitPerType: 20,
    });

    const entry = timeline.entries[0]!;
    expect(entry.title).toBe('Discovery');
    expect(entry.body).toBe('notes');
    expect(entry.ownerId).toBe('77');
    expect(entry.details['hs_call_duration']).toBe('1800000');
  });
});

describe('AssociationsService', () => {
  it('lists associations through the v4 endpoint', async () => {
    const { service, client } = buildAssociations();
    client.respondWith({
      results: [
        { toObjectId: 7801, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 279 }] },
      ],
    });

    const page = await service.list({ contactId: '512', toObjectType: 'companies', limit: 100 });

    expect(client.lastRequest().path).toBe('/crm/v4/objects/contacts/512/associations/companies');
    expect(page.results[0]?.toObjectId).toBe('7801');
    expect(page.results[0]?.associationTypes[0]?.typeId).toBe(279);
  });

  it('creates an association with PUT and the default HubSpot type', async () => {
    const { service, client } = buildAssociations();
    client.respondWith({});

    await service.create({ contactId: '512', toObjectType: 'companies', toObjectId: '7801' });

    const request = client.lastRequest();
    expect(request.method).toBe('PUT');
    expect(request.body).toEqual([
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 },
    ]);
    // PUT of an existing association is a no-op, so retry is safe.
    expect(request.retryable).toBe(true);
  });

  it('marks a custom association type as USER_DEFINED', async () => {
    const { service, client } = buildAssociations();
    client.respondWith({});

    await service.create({
      contactId: '512',
      toObjectType: 'companies',
      toObjectId: '7801',
      associationTypeId: 145,
    });

    expect(client.lastRequest().body).toEqual([
      { associationCategory: 'USER_DEFINED', associationTypeId: 145 },
    ]);
  });

  it('removes an association with DELETE', async () => {
    const { service, client } = buildAssociations();
    client.respondWith(null);

    await service.remove({ contactId: '512', toObjectType: 'deals', toObjectId: '99' });

    const request = client.lastRequest();
    expect(request.method).toBe('DELETE');
    expect(request.path).toBe('/crm/v4/objects/contacts/512/associations/deals/99');
  });
});
