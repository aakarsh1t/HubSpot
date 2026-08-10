import { BatchRecordsTool } from './batch-records.tool.js';
import { CreateEngagementTool } from './create-engagement.tool.js';
import { CreateRecordTool } from './create-record.tool.js';
import { DeleteRecordTool } from './delete-record.tool.js';
import { GetRecordTool } from './get-record.tool.js';
import { GetTimelineTool } from './get-timeline.tool.js';
import { ListPipelinesTool } from './list-pipelines.tool.js';
import { ManageAssociationsTool } from './manage-associations.tool.js';
import { ManagePropertiesTool } from './manage-properties.tool.js';
import { MergeRecordsTool } from './merge-records.tool.js';
import { RestoreRecordTool } from './restore-record.tool.js';
import { SearchRecordsTool } from './search-records.tool.js';
import { UpdateRecordTool } from './update-record.tool.js';
import type { AssociationsService } from '../../services/associations.service.js';
import type { CrmService } from '../../services/crm.service.js';
import type { EngagementsService } from '../../services/engagements.service.js';
import type { PropertiesService } from '../../services/properties.service.js';
import type { AnyToolDefinition } from '../../types/tool.types.js';

export interface CrmToolDependencies {
  readonly crm: CrmService;
  readonly associations: AssociationsService;
  readonly engagements: EngagementsService;
  readonly properties: PropertiesService;
}

/**
 * The CRM tool catalogue: thirteen tools covering contacts, companies, and
 * deals in full.
 *
 * Ordering is intentional and is the cheapest lever available on tool
 * selection — orchestrators weight earlier entries slightly, so reads come
 * first, then writes, then the operations that destroy data.
 *
 * Object type is a parameter of every tool here rather than part of its name.
 * That is what took this module from 77 entries to 13 without removing a single
 * capability: HubSpot's own APIs are one surface parameterized by object type,
 * so `hubspot_get_contact` / `_company` / `_deal` were three names for one
 * endpoint. Supporting Tickets later adds a union member, not 26 more tools.
 */
export function createCrmTools(deps: CrmToolDependencies): AnyToolDefinition[] {
  const { crm, associations, engagements, properties } = deps;

  return [
    // ---------------------------------------------------------------- reads
    new GetRecordTool(crm),
    new SearchRecordsTool(crm),
    new GetTimelineTool(engagements),
    new ListPipelinesTool(crm),

    // --------------------------------------------------------------- writes
    new CreateRecordTool(crm),
    new UpdateRecordTool(crm),
    new CreateEngagementTool(engagements),
    new ManageAssociationsTool(associations),
    new BatchRecordsTool(crm),

    // ----------------------------------------------------------- admin/schema
    new ManagePropertiesTool(properties),

    // ---------------------------------------------------------- destructive
    new DeleteRecordTool(crm),
    new RestoreRecordTool(crm),
    new MergeRecordsTool(crm),
  ];
}

export { GetRecordTool } from './get-record.tool.js';
export { SearchRecordsTool } from './search-records.tool.js';
export { CreateRecordTool } from './create-record.tool.js';
export { UpdateRecordTool } from './update-record.tool.js';
export { DeleteRecordTool } from './delete-record.tool.js';
export { RestoreRecordTool } from './restore-record.tool.js';
export { MergeRecordsTool } from './merge-records.tool.js';
export { BatchRecordsTool } from './batch-records.tool.js';
export { ManageAssociationsTool } from './manage-associations.tool.js';
export { CreateEngagementTool } from './create-engagement.tool.js';
export { GetTimelineTool } from './get-timeline.tool.js';
export { ManagePropertiesTool } from './manage-properties.tool.js';
export { ListPipelinesTool } from './list-pipelines.tool.js';
export * from './record-view.js';
