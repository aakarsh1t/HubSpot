import type { AssociableObjectType, EngagementObjectType } from '../types/crm.types.js';

/**
 * HubSpot-defined association type IDs, keyed by direction.
 *
 * These are verified against HubSpot's published association type ID tables.
 * They matter more than they look: association direction is **not**
 * symmetric — "contact to note" is 201 while "note to contact" is 202 — and
 * using the wrong one produces a 400 that reads like a permissions problem.
 *
 * Engagements are created with the *engagement-to-contact* direction, because
 * the engagement is the record being created and the contact already exists.
 * Associating an existing contact outward uses the *contact-to-object*
 * direction.
 *
 * Source: HubSpot CRM API — Association type ID reference.
 */

/** Contact → other object. Used when associating an existing contact outward. */
export const CONTACT_TO_OBJECT_TYPE_ID: Readonly<Record<AssociableObjectType, number>> =
  Object.freeze({
    companies: 279,
    deals: 3,
    tickets: 15,
    notes: 201,
    tasks: 203,
    calls: 193,
    meetings: 199,
    emails: 197,
  });

/** Engagement → contact. Used when creating an engagement against a contact. */
export const ENGAGEMENT_TO_CONTACT_TYPE_ID: Readonly<Record<EngagementObjectType, number>> =
  Object.freeze({
    notes: 202,
    tasks: 204,
    calls: 194,
    meetings: 200,
    emails: 198,
  });

/** HubSpot's association category for its own built-in association types. */
export const HUBSPOT_DEFINED = 'HUBSPOT_DEFINED' as const;

/**
 * Properties fetched for each engagement type when building a timeline.
 *
 * Requested explicitly rather than relying on defaults: HubSpot returns only a
 * small default property set, and the fields that make a timeline readable
 * (call duration, task status, meeting outcome) are not among them.
 */
export const ENGAGEMENT_TIMELINE_PROPERTIES: Readonly<Record<EngagementObjectType, string[]>> =
  Object.freeze({
    notes: ['hs_timestamp', 'hs_note_body', 'hubspot_owner_id'],
    tasks: [
      'hs_timestamp',
      'hs_task_subject',
      'hs_task_body',
      'hs_task_status',
      'hs_task_priority',
      'hs_task_type',
      'hubspot_owner_id',
    ],
    calls: [
      'hs_timestamp',
      'hs_call_title',
      'hs_call_body',
      'hs_call_duration',
      'hs_call_direction',
      'hs_call_status',
      'hs_call_disposition',
      'hubspot_owner_id',
    ],
    meetings: [
      'hs_timestamp',
      'hs_meeting_title',
      'hs_meeting_body',
      'hs_meeting_start_time',
      'hs_meeting_end_time',
      'hs_meeting_outcome',
      'hs_meeting_location',
      'hubspot_owner_id',
    ],
    emails: [
      'hs_timestamp',
      'hs_email_subject',
      'hs_email_text',
      'hs_email_direction',
      'hs_email_status',
      'hubspot_owner_id',
    ],
  });

/**
 * Which property carries the human-readable title for each engagement type.
 * Notes have no title field — their body is the content.
 */
export const ENGAGEMENT_TITLE_PROPERTY: Readonly<Record<EngagementObjectType, string | null>> =
  Object.freeze({
    notes: null,
    tasks: 'hs_task_subject',
    calls: 'hs_call_title',
    meetings: 'hs_meeting_title',
    emails: 'hs_email_subject',
  });

export const ENGAGEMENT_BODY_PROPERTY: Readonly<Record<EngagementObjectType, string>> =
  Object.freeze({
    notes: 'hs_note_body',
    tasks: 'hs_task_body',
    calls: 'hs_call_body',
    meetings: 'hs_meeting_body',
    emails: 'hs_email_text',
  });

/**
 * Contact properties returned when the caller does not ask for specific ones.
 *
 * HubSpot's own default set is narrow and omits the fields most requests
 * actually want, which leads agents to make a second call for every record.
 */
export const DEFAULT_CONTACT_PROPERTIES: readonly string[] = Object.freeze([
  'email',
  'firstname',
  'lastname',
  'phone',
  'mobilephone',
  'company',
  'jobtitle',
  'website',
  'lifecyclestage',
  'hs_lead_status',
  'hubspot_owner_id',
  'createdate',
  'lastmodifieddate',
]);
