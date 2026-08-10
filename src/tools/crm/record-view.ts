import type { BatchOutcome, CrmObject, CrmObjectType, CrmPage } from '../../types/crm.types.js';

/**
 * Shaping of HubSpot records on the way out to the agent.
 *
 * This is a latency concern as much as a formatting one. HubSpot echoes every
 * requested property whether or not it holds a value, and on a typical record
 * more than half come back `null` — so the default property set for a contact
 * routinely spends half its bytes saying nothing. Every one of those bytes is a
 * token the Copilot Studio orchestrator reads back before it can answer.
 *
 * Empty values are therefore dropped by default, and callers that genuinely
 * need to distinguish "empty" from "not returned" opt back in per call with
 * `includeEmptyProperties`. Nothing is dropped silently in a way that changes
 * meaning: an absent key reads as "no value", which is exactly what a `null`
 * or `""` from HubSpot means.
 */

export interface RecordView {
  readonly id: string;
  readonly properties: Record<string, string | null>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archived: boolean;
  readonly associations?: Record<string, string[]>;
}

export interface RecordViewOptions {
  readonly includeEmptyProperties: boolean;
  readonly associations?: Record<string, string[]> | undefined;
}

export function toRecordView(record: CrmObject, options: RecordViewOptions): RecordView {
  return {
    id: record.id,
    properties: options.includeEmptyProperties
      ? record.properties
      : withoutEmptyValues(record.properties),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archived: record.archived,
    ...(options.associations === undefined ? {} : { associations: options.associations }),
  };
}

export interface RecordPageView {
  readonly objectType: CrmObjectType;
  readonly results: readonly RecordView[];
  readonly count: number;
  readonly after: string | null;
  readonly total: number | null;
}

export function toRecordPageView(
  objectType: CrmObjectType,
  page: CrmPage<CrmObject>,
  includeEmptyProperties: boolean
): RecordPageView {
  return {
    objectType,
    results: page.results.map((record) => toRecordView(record, { includeEmptyProperties })),
    count: page.results.length,
    after: page.after,
    total: page.total,
  };
}

export interface BatchView {
  readonly objectType: CrmObjectType;
  readonly operation: string;
  readonly status: BatchOutcome<CrmObject>['status'];
  readonly requested: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly results: readonly RecordView[];
  readonly errors: BatchOutcome<CrmObject>['errors'];
}

export function toBatchView(
  objectType: CrmObjectType,
  operation: string,
  outcome: BatchOutcome<CrmObject>,
  includeEmptyProperties: boolean
): BatchView {
  return {
    objectType,
    operation,
    status: outcome.status,
    requested: outcome.requested,
    succeeded: outcome.succeeded,
    failed: outcome.failed,
    results: outcome.results.map((record) => toRecordView(record, { includeEmptyProperties })),
    errors: outcome.errors,
  };
}

function withoutEmptyValues(
  properties: Record<string, string | null>
): Record<string, string | null> {
  const kept: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value !== null && value !== '') {
      kept[key] = value;
    }
  }

  return kept;
}
