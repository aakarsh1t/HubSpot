import type { Logger } from 'pino';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type {
  CrmObjectType,
  PropertyDefinition,
  PropertyHistoryEntry,
  PropertyHistoryResult,
  PropertyOption,
} from '../types/crm.types.js';

interface RawPropertyDefinition {
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly fieldType: string;
  readonly groupName?: string;
  readonly description?: string;
  readonly options?: RawPropertyOption[];
  readonly hidden?: boolean;
  readonly hasUniqueValue?: boolean;
  readonly calculated?: boolean;
}

interface RawPropertyOption {
  readonly label: string;
  readonly value: string;
  readonly hidden?: boolean;
  readonly displayOrder?: number;
}

interface RawPropertyList {
  readonly results?: RawPropertyDefinition[];
}

interface RawHistoryVersion {
  readonly value?: string | null;
  readonly timestamp?: string;
  readonly sourceType?: string;
  readonly sourceId?: string | null;
  readonly sourceLabel?: string | null;
  readonly updatedByUserId?: number | null;
}

interface RawObjectWithHistory {
  readonly id: string;
  readonly propertiesWithHistory?: Record<string, RawHistoryVersion[]>;
}

export interface PropertiesServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

export interface CreatePropertyInput {
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly fieldType: string;
  readonly groupName: string;
  readonly description?: string | undefined;
  readonly options?: readonly PropertyOption[] | undefined;
}

export interface UpdatePropertyInput {
  readonly label?: string | undefined;
  readonly description?: string | undefined;
  readonly options?: readonly PropertyOption[] | undefined;
  readonly hidden?: boolean | undefined;
}

/**
 * Custom property (schema) management and property-value history, for any
 * primary CRM object type.
 *
 * This is a genuinely different concern from `CrmObjectService`: that class
 * manages record *data* (a contact's `lifecyclestage` value); this one
 * manages the property *definitions themselves* (whether `lifecyclestage`
 * exists, what values it accepts, which group it displays under) plus the
 * historical trail of value changes on a record. Both are generic across
 * object types for the same underlying reason — HubSpot's Properties API is
 * one surface parameterized by object type, just like the Objects API.
 */
export class PropertiesService {
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: PropertiesServiceDependencies) {
    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'properties-service' });
  }

  /** Lists every property defined for an object type, standard and custom. */
  async list(objectType: CrmObjectType): Promise<readonly PropertyDefinition[]> {
    const response = await this.client.request<RawPropertyList>({
      method: 'GET',
      path: `/crm/v3/properties/${objectType}`,
    });

    return (response.data.results ?? []).map(toPropertyDefinition);
  }

  /** Reads a single property definition by internal name. */
  async get(objectType: CrmObjectType, name: string): Promise<PropertyDefinition> {
    const response = await this.client.request<RawPropertyDefinition>({
      method: 'GET',
      path: `/crm/v3/properties/${objectType}/${encodeURIComponent(name)}`,
    });

    return toPropertyDefinition(response.data);
  }

  /**
   * Creates a new custom property.
   *
   * @example
   * ```ts
   * await properties.create('contacts', {
   *   name: 'renewal_risk',
   *   label: 'Renewal Risk',
   *   type: 'enumeration',
   *   fieldType: 'select',
   *   groupName: 'contactinformation',
   *   options: [
   *     { label: 'Low', value: 'low' },
   *     { label: 'High', value: 'high' },
   *   ],
   * });
   * ```
   */
  async create(objectType: CrmObjectType, input: CreatePropertyInput): Promise<PropertyDefinition> {
    const body: Record<string, unknown> = {
      name: input.name,
      label: input.label,
      type: input.type,
      fieldType: input.fieldType,
      groupName: input.groupName,
    };

    if (input.description !== undefined) body.description = input.description;
    if (input.options !== undefined) body.options = input.options;

    const response = await this.client.request<RawPropertyDefinition>({
      method: 'POST',
      path: `/crm/v3/properties/${objectType}`,
      body,
      // Creating with a name that already exists is a 409, not silently
      // duplicated, but replay risk on a real network failure is still real.
      retryable: false,
    });

    this.logger.info({ objectType, name: input.name }, 'Created custom property.');
    return toPropertyDefinition(response.data);
  }

  /** Partially updates a property definition — only the supplied fields change. */
  async update(
    objectType: CrmObjectType,
    name: string,
    input: UpdatePropertyInput
  ): Promise<PropertyDefinition> {
    const body: Record<string, unknown> = {};
    if (input.label !== undefined) body.label = input.label;
    if (input.description !== undefined) body.description = input.description;
    if (input.options !== undefined) body.options = input.options;
    if (input.hidden !== undefined) body.hidden = input.hidden;

    const response = await this.client.request<RawPropertyDefinition>({
      method: 'PATCH',
      path: `/crm/v3/properties/${objectType}/${encodeURIComponent(name)}`,
      body,
      retryable: true,
    });

    this.logger.info({ objectType, name }, 'Updated custom property.');
    return toPropertyDefinition(response.data);
  }

  /**
   * Archives (deletes) a property definition.
   *
   * Irreversible through this API: HubSpot does not expose a way to restore
   * a deleted property definition or recover the values it held on existing
   * records. Callers gate this behind an explicit confirmation at the tool
   * layer for exactly that reason.
   */
  async delete(objectType: CrmObjectType, name: string): Promise<void> {
    await this.client.request<null>({
      method: 'DELETE',
      path: `/crm/v3/properties/${objectType}/${encodeURIComponent(name)}`,
      retryable: false,
    });

    this.logger.warn({ objectType, name }, 'Deleted custom property definition.');
  }

  /**
   * Reads the historical value trail for one or more properties on a record,
   * via HubSpot's `propertiesWithHistory` parameter on the single-object GET.
   *
   * @example
   * ```ts
   * const history = await properties.getHistory('deals', '9001', ['dealstage', 'amount']);
   * // history.history['dealstage'] -> every value dealstage has held, newest first
   * ```
   */
  async getHistory(
    objectType: CrmObjectType,
    id: string,
    propertyNames: readonly string[]
  ): Promise<PropertyHistoryResult> {
    const response = await this.client.request<RawObjectWithHistory>({
      method: 'GET',
      path: `/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`,
      query: { propertiesWithHistory: propertyNames.join(',') },
    });

    const history: Record<string, PropertyHistoryEntry[]> = {};
    for (const [property, versions] of Object.entries(response.data.propertiesWithHistory ?? {})) {
      history[property] = versions.map(toHistoryEntry).sort((a, b) => {
        const left = a.timestamp === null ? 0 : Date.parse(a.timestamp);
        const right = b.timestamp === null ? 0 : Date.parse(b.timestamp);
        return right - left;
      });
    }

    return { objectId: response.data.id, history };
  }
}

function toPropertyDefinition(raw: RawPropertyDefinition): PropertyDefinition {
  return {
    name: raw.name,
    label: raw.label,
    type: raw.type,
    fieldType: raw.fieldType,
    groupName: raw.groupName ?? null,
    description: raw.description ?? null,
    options: (raw.options ?? []).map(toPropertyOption),
    hidden: raw.hidden ?? false,
    hasUniqueValue: raw.hasUniqueValue ?? false,
    calculated: raw.calculated ?? false,
  };
}

function toPropertyOption(raw: RawPropertyOption): PropertyOption {
  return {
    label: raw.label,
    value: raw.value,
    ...(raw.hidden === undefined ? {} : { hidden: raw.hidden }),
    ...(raw.displayOrder === undefined ? {} : { displayOrder: raw.displayOrder }),
  };
}

function toHistoryEntry(raw: RawHistoryVersion): PropertyHistoryEntry {
  return {
    value: raw.value ?? null,
    timestamp: raw.timestamp ?? null,
    sourceType: raw.sourceType ?? null,
    sourceId: raw.sourceId ?? null,
    sourceLabel: raw.sourceLabel ?? null,
    updatedByUserId: raw.updatedByUserId ?? null,
  };
}
