import type { Logger } from 'pino';
import {
  ENGAGEMENT_BODY_PROPERTY,
  ENGAGEMENT_TIMELINE_PROPERTIES,
  ENGAGEMENT_TITLE_PROPERTY,
  ENGAGEMENT_TO_CONTACT_TYPE_ID,
  HUBSPOT_DEFINED,
} from './association-types.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type { EngagementObjectType, TimelineEntry } from '../types/crm.types.js';
import type {
  CreateMeetingInput,
  CreateNoteInput,
  CreateTaskInput,
  GetTimelineInput,
  LogCallInput,
  LogEmailInput,
} from '../schemas/engagement.schema.js';

interface RawEngagement {
  readonly id: string;
  readonly properties?: Record<string, string | null>;
}

interface RawAssociationPage {
  readonly results?: { readonly toObjectId?: number | string }[];
}

interface RawBatchReadResponse {
  readonly results?: RawEngagement[];
}

export interface EngagementResult {
  readonly engagementId: string;
  readonly engagementType: EngagementObjectType;
  readonly contactId: string;
  readonly timestamp: string | null;
}

export interface TimelineResult {
  readonly entries: readonly TimelineEntry[];
  readonly countsByType: Record<string, number>;
  readonly truncated: boolean;
}

export interface EngagementsServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * Engagements logged against a contact: notes, tasks, calls, meetings, emails.
 *
 * Every engagement is created in a single request that both creates the record
 * and associates it with the contact, using the association array HubSpot
 * accepts on create. Doing it in two calls would leave an orphaned engagement
 * behind whenever the second call failed.
 *
 * Note the association direction: these use *engagement→contact* type IDs
 * (note→contact is 202, not the 201 of contact→note). Getting this backwards
 * yields a 400 that reads like a permissions error.
 */
export class EngagementsService {
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: EngagementsServiceDependencies) {
    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'engagements-service' });
  }

  /**
   * Creates a note on a contact's timeline.
   *
   * @example
   * ```ts
   * await engagements.createNote({
   *   contactId: '512',
   *   body: 'Customer asked about enterprise pricing.',
   * });
   * ```
   */
  async createNote(input: CreateNoteInput): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(input.timestamp);

    return this.createEngagement('notes', input.contactId, {
      hs_timestamp: timestamp,
      hs_note_body: input.body,
      ...(input.ownerId === undefined ? {} : { hubspot_owner_id: input.ownerId }),
    });
  }

  /**
   * Creates a task associated with a contact.
   * `hs_timestamp` carries the due date for tasks.
   */
  async createTask(input: CreateTaskInput): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(input.dueDate);

    return this.createEngagement('tasks', input.contactId, {
      hs_timestamp: timestamp,
      hs_task_subject: input.subject,
      hs_task_status: input.status,
      hs_task_priority: input.priority,
      hs_task_type: input.taskType,
      ...(input.body === undefined ? {} : { hs_task_body: input.body }),
      ...(input.ownerId === undefined ? {} : { hubspot_owner_id: input.ownerId }),
    });
  }

  /** Logs a call against a contact. Durations are milliseconds, per HubSpot. */
  async logCall(input: LogCallInput): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(input.timestamp);

    return this.createEngagement('calls', input.contactId, {
      hs_timestamp: timestamp,
      hs_call_title: input.title,
      hs_call_direction: input.direction,
      hs_call_status: input.status,
      ...(input.body === undefined ? {} : { hs_call_body: input.body }),
      ...(input.durationMs === undefined ? {} : { hs_call_duration: String(input.durationMs) }),
      ...(input.ownerId === undefined ? {} : { hubspot_owner_id: input.ownerId }),
    });
  }

  /** Creates a meeting on a contact's timeline. */
  async createMeeting(input: CreateMeetingInput): Promise<EngagementResult> {
    const startTime = new Date(input.startTime).toISOString();
    const endTime = new Date(input.endTime).toISOString();

    return this.createEngagement('meetings', input.contactId, {
      // HubSpot expects hs_timestamp to match the meeting start.
      hs_timestamp: startTime,
      hs_meeting_title: input.title,
      hs_meeting_start_time: startTime,
      hs_meeting_end_time: endTime,
      hs_meeting_outcome: input.outcome,
      ...(input.body === undefined ? {} : { hs_meeting_body: input.body }),
      ...(input.location === undefined ? {} : { hs_meeting_location: input.location }),
      ...(input.ownerId === undefined ? {} : { hubspot_owner_id: input.ownerId }),
    });
  }

  /** Logs an email against a contact. */
  async logEmail(input: LogEmailInput): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(input.timestamp);

    return this.createEngagement('emails', input.contactId, {
      hs_timestamp: timestamp,
      hs_email_subject: input.subject,
      hs_email_text: input.body,
      hs_email_direction: input.direction,
      hs_email_status: input.status,
      ...(input.ownerId === undefined ? {} : { hubspot_owner_id: input.ownerId }),
    });
  }

  /**
   * Builds a contact's activity timeline by aggregating its engagements.
   *
   * A note on naming: HubSpot's "Timeline Events API" is a different feature —
   * it creates *custom* event types and requires a developer app with an event
   * template, which a private app cannot do. What users almost always mean by
   * "the contact's timeline" is the activity feed shown on the record, which
   * is exactly what this reconstructs from associated engagements.
   *
   * Executed as: for each requested type, list associated IDs, then batch-read
   * their properties. Types are fetched concurrently, so wall-clock cost is
   * that of the slowest type rather than the sum.
   */
  async getTimeline(input: GetTimelineInput): Promise<TimelineResult> {
    const perType = await Promise.all(
      input.types.map(async (type) => ({
        type,
        entries: await this.fetchEngagementsOfType(input.contactId, type, input.limitPerType),
      }))
    );

    const countsByType: Record<string, number> = {};
    let truncated = false;
    const entries: TimelineEntry[] = [];

    for (const { type, entries: typeEntries } of perType) {
      countsByType[type] = typeEntries.length;
      // Hitting the requested ceiling means HubSpot almost certainly has more.
      if (typeEntries.length >= input.limitPerType) {
        truncated = true;
      }
      entries.push(...typeEntries);
    }

    // Newest first, matching the CRM UI. Entries without a timestamp sort last
    // rather than being dropped.
    entries.sort((a, b) => {
      const left = a.timestamp === null ? -Infinity : Date.parse(a.timestamp);
      const right = b.timestamp === null ? -Infinity : Date.parse(b.timestamp);
      return right - left;
    });

    this.logger.debug(
      { contactId: input.contactId, total: entries.length, countsByType },
      'Built contact activity timeline.'
    );

    return { entries, countsByType, truncated };
  }

  /**
   * Creates an engagement and associates it with the contact in one request.
   *
   * `retryable: false` throughout: engagement creation is not idempotent, and
   * a replay after a timeout would leave duplicate notes or double-logged
   * calls on the customer's timeline.
   */
  private async createEngagement(
    type: EngagementObjectType,
    contactId: string,
    properties: Record<string, string>
  ): Promise<EngagementResult> {
    const response = await this.client.request<RawEngagement>({
      method: 'POST',
      path: `/crm/v3/objects/${type}`,
      body: {
        properties,
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: HUBSPOT_DEFINED,
                associationTypeId: ENGAGEMENT_TO_CONTACT_TYPE_ID[type],
              },
            ],
          },
        ],
      },
      retryable: false,
    });

    this.logger.info(
      { engagementType: type, engagementId: response.data.id, contactId },
      'Created engagement on contact.'
    );

    return {
      engagementId: response.data.id,
      engagementType: type,
      contactId,
      timestamp: properties['hs_timestamp'] ?? null,
    };
  }

  private async fetchEngagementsOfType(
    contactId: string,
    type: EngagementObjectType,
    limit: number
  ): Promise<TimelineEntry[]> {
    const associations = await this.client.request<RawAssociationPage>({
      method: 'GET',
      path: `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/${type}`,
      query: { limit },
    });

    const ids = (associations.data.results ?? [])
      .map((result) => String(result.toObjectId ?? ''))
      .filter((id) => id !== '');

    if (ids.length === 0) {
      return [];
    }

    const batch = await this.client.request<RawBatchReadResponse>({
      method: 'POST',
      path: `/crm/v3/objects/${type}/batch/read`,
      body: {
        properties: ENGAGEMENT_TIMELINE_PROPERTIES[type],
        inputs: ids.map((id) => ({ id })),
      },
      retryable: true,
    });

    return (batch.data.results ?? []).map((engagement) => toTimelineEntry(type, engagement));
  }
}

function toTimelineEntry(type: EngagementObjectType, raw: RawEngagement): TimelineEntry {
  const properties = raw.properties ?? {};
  const titleProperty = ENGAGEMENT_TITLE_PROPERTY[type];
  const bodyProperty = ENGAGEMENT_BODY_PROPERTY[type];

  // Everything not already surfaced as title/body/owner/timestamp goes into
  // `details`, so type-specific fields stay visible without a bespoke shape
  // per engagement type.
  const details: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (
      key !== 'hs_timestamp' &&
      key !== 'hubspot_owner_id' &&
      key !== titleProperty &&
      key !== bodyProperty &&
      !key.startsWith('hs_object_id')
    ) {
      details[key] = value;
    }
  }

  return {
    id: raw.id,
    type,
    timestamp: normalizeTimestamp(properties['hs_timestamp'] ?? null),
    title: titleProperty === null ? null : (properties[titleProperty] ?? null),
    body: properties[bodyProperty] ?? null,
    ownerId: properties['hubspot_owner_id'] ?? null,
    details,
  };
}

/**
 * HubSpot accepts either ISO 8601 or Unix milliseconds for `hs_timestamp`.
 * We always send ISO 8601 — it is unambiguous in logs and in error messages.
 */
function resolveTimestamp(value: string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  return new Date(value).toISOString();
}

/** HubSpot returns timestamps as ISO strings or epoch milliseconds; normalise both. */
function normalizeTimestamp(value: string | null): string | null {
  if (value === null || value === '') {
    return null;
  }

  if (/^\d+$/u.test(value)) {
    return new Date(Number(value)).toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
