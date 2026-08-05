/**
 * CRM domain types shared by the contacts, associations, and engagement
 * services.
 */

/** A HubSpot property value as accepted on the wire. */
export type PropertyValue = string | number | boolean | null;

/** Property bag for a CRM record. HubSpot portals allow arbitrary custom properties. */
export type PropertyBag = Record<string, PropertyValue>;

/** Canonical shape of a CRM object returned by the v3 object APIs. */
export interface CrmObject {
  readonly id: string;
  readonly properties: Record<string, string | null>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archived: boolean;
}

/** A page of CRM objects plus the cursor needed to fetch the next one. */
export interface CrmPage<T> {
  readonly results: readonly T[];
  /** Opaque cursor for the next page, or null when the page is the last. */
  readonly after: string | null;
  readonly total: number | null;
}

/** Per-item outcome of a batch operation. */
export interface BatchOutcome<T> {
  readonly status: 'COMPLETE' | 'PARTIAL' | 'ERROR';
  readonly results: readonly T[];
  readonly errors: readonly BatchError[];
  readonly requested: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface BatchError {
  readonly message: string;
  readonly category: string | null;
  /** Index or id of the failing input, when HubSpot reports it. */
  readonly context: Record<string, unknown> | null;
}

/**
 * CRM object types this server can associate contacts with.
 *
 * Restricted to the set we have verified association type IDs for, so an
 * agent cannot invent an object type and produce a confusing 400.
 */
export type AssociableObjectType =
  'companies' | 'deals' | 'tickets' | 'notes' | 'tasks' | 'calls' | 'meetings' | 'emails';

export type EngagementObjectType = 'notes' | 'tasks' | 'calls' | 'meetings' | 'emails';

/** A single association between a contact and another record. */
export interface AssociationRef {
  readonly toObjectId: string;
  readonly toObjectType: string;
  readonly associationTypes: readonly {
    readonly category: string;
    readonly typeId: number;
    readonly label: string | null;
  }[];
}

/** One entry in a contact's aggregated activity timeline. */
export interface TimelineEntry {
  readonly id: string;
  readonly type: EngagementObjectType;
  /** ISO 8601. Sourced from `hs_timestamp` so ordering matches the CRM UI. */
  readonly timestamp: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly ownerId: string | null;
  /** Type-specific fields (call duration, task status, meeting outcome, …). */
  readonly details: Record<string, string | null>;
}
