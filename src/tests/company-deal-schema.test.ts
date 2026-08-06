import { describe, expect, it } from 'vitest';
import {
  createCompanyAssociationInputSchema,
  deleteCompanyAssociationInputSchema,
} from '../schemas/association.schema.js';
import {
  archiveCompanyInputSchema,
  batchArchiveCompaniesInputSchema,
  companyIdSchema,
  createCompanyInputSchema,
  deleteCompanyInputSchema,
  mergeCompaniesInputSchema,
  restoreCompanyInputSchema,
  searchCompaniesInputSchema,
} from '../schemas/company.schema.js';
import {
  archiveDealInputSchema,
  changeDealPipelineInputSchema,
  createDealInputSchema,
  dealIdSchema,
  deleteDealInputSchema,
  mergeDealsInputSchema,
  moveDealStageInputSchema,
  setForecastCategoryInputSchema,
} from '../schemas/deal.schema.js';
import {
  createPropertyInputSchema,
  deletePropertyInputSchema,
  getPropertyHistoryInputSchema,
} from '../schemas/property.schema.js';

describe('companyIdSchema / dealIdSchema', () => {
  it('accepts numeric IDs and rejects non-numeric ones', () => {
    expect(companyIdSchema.safeParse('7801').success).toBe(true);
    expect(companyIdSchema.safeParse('acme.com').success).toBe(false);
    expect(dealIdSchema.safeParse('9001').success).toBe(true);
    expect(dealIdSchema.safeParse('').success).toBe(false);
  });
});

describe('createCompanyInputSchema', () => {
  it('rejects an empty properties object', () => {
    expect(createCompanyInputSchema.safeParse({ properties: {} }).success).toBe(false);
  });

  it('accepts a minimal valid payload', () => {
    const result = createCompanyInputSchema.safeParse({ properties: { name: 'Acme Corp' } });
    expect(result.success).toBe(true);
  });

  it('restricts create-time association types to contacts/deals/tickets (not companies itself)', () => {
    const result = createCompanyInputSchema.safeParse({
      properties: { name: 'Acme Corp' },
      associations: [{ toObjectType: 'companies', toObjectId: '1' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('searchCompaniesInputSchema', () => {
  it('requires query or a filter group', () => {
    expect(searchCompaniesInputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a domain lookup filter — the reliable path since idProperty=domain is not offered', () => {
    const result = searchCompaniesInputSchema.safeParse({
      filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: 'acme.com' }] }],
    });
    expect(result.success).toBe(true);
  });

  it('enforces the 6-filters-per-group limit, same as contacts', () => {
    const filters = Array.from({ length: 7 }, (_, i) => ({
      propertyName: `p${i}`,
      operator: 'EQ' as const,
      value: 'x',
    }));
    expect(searchCompaniesInputSchema.safeParse({ filterGroups: [{ filters }] }).success).toBe(
      false
    );
  });
});

describe('company destructive operation gates', () => {
  it('archive requires no confirmation, unlike permanent delete', () => {
    expect(archiveCompanyInputSchema.safeParse({ companyId: '7801' }).success).toBe(true);
  });

  it('permanent delete requires confirmPermanentDeletion: true', () => {
    expect(deleteCompanyInputSchema.safeParse({ companyId: '7801' }).success).toBe(false);
    expect(
      deleteCompanyInputSchema.safeParse({ companyId: '7801', confirmPermanentDeletion: true })
        .success
    ).toBe(true);
  });

  it('restore requires confirmRecreate: true', () => {
    expect(restoreCompanyInputSchema.safeParse({ companyId: '7801' }).success).toBe(false);
  });

  it('merge rejects a company merging into itself', () => {
    const result = mergeCompaniesInputSchema.safeParse({
      primaryCompanyId: '7801',
      companyIdToMerge: '7801',
      confirmMerge: true,
    });
    expect(result.success).toBe(false);
  });

  it('batch archive requires confirmArchive: true', () => {
    expect(batchArchiveCompaniesInputSchema.safeParse({ companyIds: ['7801'] }).success).toBe(
      false
    );
    expect(
      batchArchiveCompaniesInputSchema.safeParse({ companyIds: ['7801'], confirmArchive: true })
        .success
    ).toBe(true);
  });
});

describe('company association schemas exclude self-type', () => {
  it('rejects "companies" as a toObjectType for a company association', () => {
    const result = createCompanyAssociationInputSchema.safeParse({
      companyId: '7801',
      toObjectType: 'companies',
      toObjectId: '7802',
    });
    expect(result.success).toBe(false);
  });

  it('accepts contacts as a valid toObjectType', () => {
    const result = createCompanyAssociationInputSchema.safeParse({
      companyId: '7801',
      toObjectType: 'contacts',
      toObjectId: '512',
    });
    expect(result.success).toBe(true);
  });

  it('disassociate requires confirmRemoval: true', () => {
    const result = deleteCompanyAssociationInputSchema.safeParse({
      companyId: '7801',
      toObjectType: 'contacts',
      toObjectId: '512',
    });
    expect(result.success).toBe(false);
  });
});

describe('createDealInputSchema', () => {
  it('rejects an empty properties object', () => {
    expect(createDealInputSchema.safeParse({ properties: {} }).success).toBe(false);
  });

  it('accepts a minimal valid payload', () => {
    expect(createDealInputSchema.safeParse({ properties: { dealname: 'Acme deal' } }).success).toBe(
      true
    );
  });
});

describe('deal destructive operation gates', () => {
  it('archive requires no confirmation', () => {
    expect(archiveDealInputSchema.safeParse({ dealId: '9001' }).success).toBe(true);
  });

  it('permanent delete requires confirmPermanentDeletion: true', () => {
    expect(deleteDealInputSchema.safeParse({ dealId: '9001' }).success).toBe(false);
  });

  it('merge rejects a deal merging into itself', () => {
    const result = mergeDealsInputSchema.safeParse({
      primaryDealId: '9001',
      dealIdToMerge: '9001',
      confirmMerge: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('moveDealStageInputSchema / changeDealPipelineInputSchema', () => {
  it('move stage requires only dealId and stageId', () => {
    const result = moveDealStageInputSchema.safeParse({ dealId: '9001', stageId: 'closedwon' });
    expect(result.success).toBe(true);
  });

  it('change pipeline requires pipelineId AND stageId together', () => {
    expect(
      changeDealPipelineInputSchema.safeParse({ dealId: '9001', pipelineId: 'p2' }).success
    ).toBe(false);
    expect(
      changeDealPipelineInputSchema.safeParse({ dealId: '9001', pipelineId: 'p2', stageId: 's1' })
        .success
    ).toBe(true);
  });
});

describe('setForecastCategoryInputSchema', () => {
  it('accepts any non-empty string, since the option set is portal-configurable', () => {
    // Deliberately not a strict enum — see deal.schema.ts for why asserting
    // a fixed list would risk rejecting a legitimate portal-specific value.
    expect(
      setForecastCategoryInputSchema.safeParse({ dealId: '9001', forecastCategory: 'commit' })
        .success
    ).toBe(true);
    expect(
      setForecastCategoryInputSchema.safeParse({ dealId: '9001', forecastCategory: 'custom_value' })
        .success
    ).toBe(true);
  });

  it('rejects an empty forecast category', () => {
    expect(
      setForecastCategoryInputSchema.safeParse({ dealId: '9001', forecastCategory: '' }).success
    ).toBe(false);
  });
});

describe('property schemas', () => {
  it('validates the internal property name format', () => {
    expect(
      createPropertyInputSchema.safeParse({
        objectType: 'contacts',
        name: 'Renewal Risk',
        label: 'Renewal Risk',
        type: 'string',
        fieldType: 'text',
        groupName: 'contactinformation',
      }).success
    ).toBe(false);

    expect(
      createPropertyInputSchema.safeParse({
        objectType: 'contacts',
        name: 'renewal_risk',
        label: 'Renewal Risk',
        type: 'string',
        fieldType: 'text',
        groupName: 'contactinformation',
      }).success
    ).toBe(true);
  });

  it("rejects a type not in HubSpot's allowed set", () => {
    const result = createPropertyInputSchema.safeParse({
      objectType: 'contacts',
      name: 'x',
      label: 'X',
      type: 'array',
      fieldType: 'text',
      groupName: 'contactinformation',
    });
    expect(result.success).toBe(false);
  });

  it('delete requires confirmDeletion: true', () => {
    expect(
      deletePropertyInputSchema.safeParse({ objectType: 'deals', propertyName: 'amount' }).success
    ).toBe(false);
    expect(
      deletePropertyInputSchema.safeParse({
        objectType: 'deals',
        propertyName: 'amount',
        confirmDeletion: true,
      }).success
    ).toBe(true);
  });

  it('property history requires at least one property name and caps at 50', () => {
    expect(
      getPropertyHistoryInputSchema.safeParse({
        objectType: 'deals',
        recordId: '9001',
        propertyNames: [],
      }).success
    ).toBe(false);

    const tooMany = Array.from({ length: 51 }, (_, i) => `prop_${i}`);
    expect(
      getPropertyHistoryInputSchema.safeParse({
        objectType: 'deals',
        recordId: '9001',
        propertyNames: tooMany,
      }).success
    ).toBe(false);
  });
});
