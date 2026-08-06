/**
 * CRM domain types shared by the contacts, companies, deals, associations,
 * engagements, and properties services.
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
 * The primary CRM objects this server manages directly (as opposed to
 * `tickets`, which it only associates *with*, since a Tickets module is not
 * implemented). Shared by every generic service — `CrmObjectService`,
 * `AssociationsService`, `EngagementsService`, `PropertiesService` — so
 * supporting a fourth object type in future is one union member, not a
 * rewrite of any of them.
 */
export type CrmObjectType = 'contacts' | 'companies' | 'deals';

/**
 * CRM object types any of the primary objects can be associated with.
 *
 * Restricted to the set we have verified association type IDs for (see
 * `association-types.ts`), so an agent cannot invent an object type and
 * produce a confusing 400 — or worse, a silently wrong association direction.
 */
export type AssociableObjectType =
  | 'contacts'
  | 'companies'
  | 'deals'
  | 'tickets'
  | 'notes'
  | 'tasks'
  | 'calls'
  | 'meetings'
  | 'emails';

export type EngagementObjectType = 'notes' | 'tasks' | 'calls' | 'meetings' | 'emails';

/** A single association between a CRM object and another record. */
export interface AssociationRef {
  readonly toObjectId: string;
  readonly toObjectType: string;
  readonly associationTypes: readonly {
    readonly category: string;
    readonly typeId: number;
    readonly label: string | null;
  }[];
}

/** One entry in an object's aggregated activity timeline. */
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

/** One historical value of a property, as returned by `propertiesWithHistory`. */
export interface PropertyHistoryEntry {
  readonly value: string | null;
  /** ISO 8601 timestamp of when this value became active. */
  readonly timestamp: string | null;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly sourceLabel: string | null;
  readonly updatedByUserId: number | null;
}

/** Full property-value history for one record, keyed by property name. */
export interface PropertyHistoryResult {
  readonly objectId: string;
  readonly history: Readonly<Record<string, readonly PropertyHistoryEntry[]>>;
}

/** HubSpot's allowed data types for a custom property definition. */
export type PropertyType = 'string' | 'number' | 'date' | 'datetime' | 'bool' | 'enumeration';

/** HubSpot's allowed input widgets for a custom property definition. */
export type PropertyFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'booleancheckbox'
  | 'date'
  | 'phonenumber';

export interface PropertyOption {
  readonly label: string;
  readonly value: string;
  // `| undefined` rather than a bare `?:` because Zod's inferred optional
  // type is `T | undefined`, not "absent or T" — under
  // `exactOptionalPropertyTypes`, those are different types, and a Zod
  // schema's output would not otherwise satisfy this interface.
  readonly hidden?: boolean | undefined;
  readonly displayOrder?: number | undefined;
}

/** A custom property definition, as returned by the Properties API. */
export interface PropertyDefinition {
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly fieldType: string;
  readonly groupName: string | null;
  readonly description: string | null;
  readonly options: readonly PropertyOption[];
  readonly hidden: boolean;
  readonly hasUniqueValue: boolean;
  readonly calculated: boolean;
}

/** One stage within a deal pipeline. */
export interface PipelineStage {
  readonly id: string;
  readonly label: string;
  readonly displayOrder: number;
  readonly probability: number | null;
  readonly isClosed: boolean;
}

/** A deal pipeline and its ordered stages. */
export interface Pipeline {
  readonly id: string;
  readonly label: string;
  readonly displayOrder: number;
  readonly stages: readonly PipelineStage[];
}
