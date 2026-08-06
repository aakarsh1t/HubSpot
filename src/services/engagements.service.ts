import type { Logger } from 'pino';
import {
  ENGAGEMENT_BODY_PROPERTY,
  ENGAGEMENT_TIMELINE_PROPERTIES,
  ENGAGEMENT_TITLE_PROPERTY,
  getAssociationTypeId,
  HUBSPOT_DEFINED,
} from './association-types.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type { CrmObjectType, EngagementObjectType, TimelineEntry } from '../types/crm.types.js';
import type {
  CallBody,
  EmailBody,
  MeetingBody,
  NoteBody,
  TaskBody,
  TimelineOptions,
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
  readonly objectType: CrmObjectType;
  readonly objectId: string;
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
 * Engagements (notes, tasks, calls, meetings, emails) logged against any
 * primary CRM object — contacts, companies, or deals.
 *
 * Every method takes `(objectType, objectId, body)` rather than one object
 * carrying an ambiguous ID field: `objectType` and `objectId` are how the
 * caller says *which* record, and `body` is exactly the engagement-specific
 * payload with no ID field mixed in (see `*BodySchema` in
 * `engagement.schema.ts`) — a shape that is identical regardless of which
 * object type the engagement is being logged against, which is what lets
 * Contacts, Companies, and Deals share this one implementation.
 *
 * Every engagement is created in a single request that both creates the
 * record and associates it with the target object, using the association
 * array HubSpot accepts on create. Doing it in two calls would leave an
 * orphaned engagement behind whenever the second call failed.
 *
 * Association direction is engagement→object (note→company is 190, not the
 * 189 of company→note) — getting this backwards yields a 400 that reads like
 * a permissions error, which is exactly why the type IDs are resolved
 * through the single verified `getAssociationTypeId` lookup rather than
 * re-derived per object type.
 */
export class EngagementsService {
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: EngagementsServiceDependencies) {
    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'engagements-service' });
  }

  /**
   * Creates a note on an object's timeline.
   *
   * @example
   * ```ts
   * await engagements.createNote('contacts', '512', {
   *   body: 'Customer asked about enterprise pricing.',
   * });
   * ```
   */
  async createNote(
    objectType: CrmObjectType,
    objectId: string,
    body: NoteBody
  ): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(body.timestamp);

    return this.createEngagement('notes', objectType, objectId, {
      hs_timestamp: timestamp,
      hs_note_body: body.body,
      ...(body.ownerId === undefined ? {} : { hubspot_owner_id: body.ownerId }),
    });
  }

  /** Creates a task. `hs_timestamp` carries the due date for tasks. */
  async createTask(
    objectType: CrmObjectType,
    objectId: string,
    body: TaskBody
  ): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(body.dueDate);

    return this.createEngagement('tasks', objectType, objectId, {
      hs_timestamp: timestamp,
      hs_task_subject: body.subject,
      hs_task_status: body.status,
      hs_task_priority: body.priority,
      hs_task_type: body.taskType,
      ...(body.body === undefined ? {} : { hs_task_body: body.body }),
      ...(body.ownerId === undefined ? {} : { hubspot_owner_id: body.ownerId }),
    });
  }

  /** Logs a call. Durations are milliseconds, per HubSpot. */
  async logCall(
    objectType: CrmObjectType,
    objectId: string,
    body: CallBody
  ): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(body.timestamp);

    return this.createEngagement('calls', objectType, objectId, {
      hs_timestamp: timestamp,
      hs_call_title: body.title,
      hs_call_direction: body.direction,
      hs_call_status: body.status,
      ...(body.body === undefined ? {} : { hs_call_body: body.body }),
      ...(body.durationMs === undefined ? {} : { hs_call_duration: String(body.durationMs) }),
      ...(body.ownerId === undefined ? {} : { hubspot_owner_id: body.ownerId }),
    });
  }

  /** Creates a meeting. */
  async createMeeting(
    objectType: CrmObjectType,
    objectId: string,
    body: MeetingBody
  ): Promise<EngagementResult> {
    const startTime = new Date(body.startTime).toISOString();
    const endTime = new Date(body.endTime).toISOString();

    return this.createEngagement('meetings', objectType, objectId, {
      hs_timestamp: startTime,
      hs_meeting_title: body.title,
      hs_meeting_start_time: startTime,
      hs_meeting_end_time: endTime,
      hs_meeting_outcome: body.outcome,
      ...(body.body === undefined ? {} : { hs_meeting_body: body.body }),
      ...(body.location === undefined ? {} : { hs_meeting_location: body.location }),
      ...(body.ownerId === undefined ? {} : { hubspot_owner_id: body.ownerId }),
    });
  }

  /** Logs an email. */
  async logEmail(
    objectType: CrmObjectType,
    objectId: string,
    body: EmailBody
  ): Promise<EngagementResult> {
    const timestamp = resolveTimestamp(body.timestamp);

    return this.createEngagement('emails', objectType, objectId, {
      hs_timestamp: timestamp,
      hs_email_subject: body.subject,
      hs_email_text: body.body,
      hs_email_direction: body.direction,
      hs_email_status: body.status,
      ...(body.ownerId === undefined ? {} : { hubspot_owner_id: body.ownerId }),
    });
  }

  /**
   * Builds an object's activity timeline by aggregating its engagements.
   *
   * A note on naming: HubSpot's "Timeline Events API" is a different feature
   * — it creates *custom* event types and requires a developer app with an
   * event template, which a private app cannot do. What users almost always
   * mean by "the record's timeline" is the activity feed shown on the
   * record, which is exactly what this reconstructs from associated
   * engagements.
   *
   * Executed as: for each requested type, list associated IDs, then
   * batch-read their properties. Types are fetched concurrently, so
   * wall-clock cost is that of the slowest type rather than the sum.
   */
  async getTimeline(
    objectType: CrmObjectType,
    objectId: string,
    options: TimelineOptions
  ): Promise<TimelineResult> {
    const perType = await Promise.all(
      options.types.map(async (type) => ({
        type,
        entries: await this.fetchEngagementsOfType(
          objectType,
          objectId,
          type,
          options.limitPerType
        ),
      }))
    );

    const countsByType: Record<string, number> = {};
    let truncated = false;
    const entries: TimelineEntry[] = [];

    for (const { type, entries: typeEntries } of perType) {
      countsByType[type] = typeEntries.length;
      if (typeEntries.length >= options.limitPerType) {
        truncated = true;
      }
      entries.push(...typeEntries);
    }

    entries.sort((a, b) => {
      const left = a.timestamp === null ? -Infinity : Date.parse(a.timestamp);
      const right = b.timestamp === null ? -Infinity : Date.parse(b.timestamp);
      return right - left;
    });

    this.logger.debug(
      { objectType, objectId, total: entries.length, countsByType },
      'Built activity timeline.'
    );

    return { entries, countsByType, truncated };
  }

  /**
   * Creates an engagement and associates it with the target object in one
   * request. `retryable: false` throughout: engagement creation is not
   * idempotent, and a replay after a timeout would leave duplicate notes or
   * double-logged calls on the record's timeline.
   */
  private async createEngagement(
    type: EngagementObjectType,
    objectType: CrmObjectType,
    objectId: string,
    properties: Record<string, string>
  ): Promise<EngagementResult> {
    const response = await this.client.request<RawEngagement>({
      method: 'POST',
      path: `/crm/v3/objects/${type}`,
      body: {
        properties,
        associations: [
          {
            to: { id: objectId },
            types: [
              {
                associationCategory: HUBSPOT_DEFINED,
                associationTypeId: getAssociationTypeId(type, objectType),
              },
            ],
          },
        ],
      },
      retryable: false,
    });

    this.logger.info(
      { engagementType: type, engagementId: response.data.id, objectType, objectId },
      'Created engagement.'
    );

    return {
      engagementId: response.data.id,
      engagementType: type,
      objectType,
      objectId,
      timestamp: properties.hs_timestamp ?? null,
    };
  }

  private async fetchEngagementsOfType(
    objectType: CrmObjectType,
    objectId: string,
    type: EngagementObjectType,
    limit: number
  ): Promise<TimelineEntry[]> {
    const associations = await this.client.request<RawAssociationPage>({
      method: 'GET',
      path: `/crm/v4/objects/${objectType}/${encodeURIComponent(objectId)}/associations/${type}`,
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
      body: { properties: ENGAGEMENT_TIMELINE_PROPERTIES[type], inputs: ids.map((id) => ({ id })) },
      retryable: true,
    });

    return (batch.data.results ?? []).map((engagement) => toTimelineEntry(type, engagement));
  }
}

function toTimelineEntry(type: EngagementObjectType, raw: RawEngagement): TimelineEntry {
  const properties = raw.properties ?? {};
  const titleProperty = ENGAGEMENT_TITLE_PROPERTY[type];
  const bodyProperty = ENGAGEMENT_BODY_PROPERTY[type];

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
    timestamp: normalizeTimestamp(properties.hs_timestamp ?? null),
    title: titleProperty === null ? null : (properties[titleProperty] ?? null),
    body: properties[bodyProperty] ?? null,
    ownerId: properties.hubspot_owner_id ?? null,
    details,
  };
}

/**
 * HubSpot accepts either ISO 8601 or Unix milliseconds for `hs_timestamp`.
 * We always send ISO 8601 — it is unambiguous in logs and in error messages.
 */
function resolveTimestamp(value: string | undefined): string {
  return value === undefined ? new Date().toISOString() : new Date(value).toISOString();
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
