import type { CrmObjectType, EngagementObjectType } from '../types/crm.types.js';

/**
 * HubSpot-defined association type IDs, verified against HubSpot's published
 * association type ID reference and cross-checked by exact row label (not
 * inferred or recalled from general knowledge — a prior version of this file
 * shipped `contacts -> deals: 3`, which is actually the *reverse* direction
 * (deal to contact); the correct contact-to-deal ID is 4. That class of
 * mistake is exactly why every entry below was re-verified explicitly rather
 * than trusted from memory.
 *
 * Association direction is **not symmetric** in HubSpot: contact→company and
 * company→contact are different numeric IDs, and using the wrong one
 * produces a 400 that reads like a permissions problem rather than what it
 * is — a directionality bug.
 *
 * Keyed as a flat `"fromType:toType"` lookup rather than nested per-object
 * maps, since a nested structure does not scale cleanly once associations
 * exist between three primary objects plus five engagement types — one flat,
 * exhaustively-verified table serves every module without duplicating the
 * pattern per object.
 *
 * Source: HubSpot CRM API — Association type ID reference
 * (developers.hubspot.com/docs/reference/api/crm/associations/association-details).
 */
const ASSOCIATION_TYPE_IDS: ReadonlyMap<string, number> = new Map([
  // --------------------------------------------------------- primary objects
  ['contacts:companies', 279],
  ['companies:contacts', 280],
  ['contacts:deals', 4],
  ['deals:contacts', 3],
  ['contacts:tickets', 15],
  ['tickets:contacts', 16],
  ['companies:deals', 342],
  ['deals:companies', 341],
  ['companies:tickets', 340],
  ['tickets:companies', 339],
  ['deals:tickets', 27],
  ['tickets:deals', 28],

  // ------------------------------------------------- engagements to contacts
  ['notes:contacts', 202],
  ['contacts:notes', 201],
  ['tasks:contacts', 204],
  ['contacts:tasks', 203],
  ['calls:contacts', 194],
  ['contacts:calls', 193],
  ['meetings:contacts', 200],
  ['contacts:meetings', 199],
  ['emails:contacts', 198],
  ['contacts:emails', 197],

  // ------------------------------------------------ engagements to companies
  ['notes:companies', 190],
  ['companies:notes', 189],
  ['tasks:companies', 192],
  ['companies:tasks', 191],
  ['calls:companies', 182],
  ['companies:calls', 181],
  ['meetings:companies', 188],
  ['companies:meetings', 187],
  ['emails:companies', 186],
  ['companies:emails', 185],

  // ----------------------------------------------------- engagements to deals
  ['notes:deals', 214],
  ['deals:notes', 213],
  ['tasks:deals', 216],
  ['deals:tasks', 215],
  ['calls:deals', 206],
  ['deals:calls', 205],
  ['meetings:deals', 212],
  ['deals:meetings', 211],
  ['emails:deals', 210],
  ['deals:emails', 209],
]);

export const HUBSPOT_DEFINED = 'HUBSPOT_DEFINED' as const;

/**
 * Resolves the HubSpot-defined default association type ID between two
 * object types, in the given direction.
 *
 * @throws {Error} if the pair has not been verified and added to the table
 *   above. This fails loudly rather than guessing, since a wrong association
 *   type ID does not error obviously — it silently creates the wrong
 *   relationship (or none at all).
 */
export function getAssociationTypeId(fromType: string, toType: string): number {
  const id = ASSOCIATION_TYPE_IDS.get(`${fromType}:${toType}`);

  if (id === undefined) {
    throw new Error(
      `No verified HubSpot association type ID for "${fromType}" -> "${toType}". ` +
        'Add it to ASSOCIATION_TYPE_IDS only after confirming the exact numeric ID ' +
        "from HubSpot's association type reference — do not guess."
    );
  }

  return id;
}

/**
 * Properties fetched for each engagement type when building a timeline.
 * Requested explicitly rather than relying on defaults: HubSpot returns only
 * a small default property set, and the fields that make a timeline readable
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
 * Default properties returned when a caller does not request specific ones,
 * per primary object type. HubSpot's own default set is narrow and omits the
 * fields most requests actually want, which leads agents to make a second
 * call for every record.
 */
export const DEFAULT_OBJECT_PROPERTIES: Readonly<Record<CrmObjectType, readonly string[]>> =
  Object.freeze({
    contacts: [
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
    ],
    companies: [
      'name',
      'domain',
      'website',
      'phone',
      'industry',
      'city',
      'state',
      'country',
      'numberofemployees',
      'annualrevenue',
      'lifecyclestage',
      'hubspot_owner_id',
      'createdate',
      'hs_lastmodifieddate',
    ],
    deals: [
      'dealname',
      'dealstage',
      'pipeline',
      'amount',
      'closedate',
      'dealtype',
      'hs_forecast_category',
      'hs_forecast_probability',
      'hubspot_owner_id',
      'createdate',
      'hs_lastmodifieddate',
    ],
  });

/** HubSpot's REST path segment for each primary object type. */
export const OBJECT_TYPE_PATH: Readonly<Record<CrmObjectType, string>> = Object.freeze({
  contacts: 'contacts',
  companies: 'companies',
  deals: 'deals',
});
