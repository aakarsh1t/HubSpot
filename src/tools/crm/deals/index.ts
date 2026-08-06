import type { AssociationsService } from '../../../services/associations.service.js';
import type { DealsService } from '../../../services/deals.service.js';
import type { EngagementsService } from '../../../services/engagements.service.js';
import type { AnyToolDefinition } from '../../../types/tool.types.js';
import { AssociateDealTool } from './associate-deal.tool.js';
import { ArchiveDealTool } from './archive-deal.tool.js';
import { BatchArchiveDealsTool } from './batch-archive-deals.tool.js';
import { BatchCreateDealsTool } from './batch-create-deals.tool.js';
import { BatchReadDealsTool } from './batch-read-deals.tool.js';
import { BatchUpdateDealsTool } from './batch-update-deals.tool.js';
import { ChangeDealPipelineTool } from './change-deal-pipeline.tool.js';
import { CreateDealTool } from './create-deal.tool.js';
import { CreateDealMeetingTool } from './create-deal-meeting.tool.js';
import { CreateDealNoteTool } from './create-deal-note.tool.js';
import { CreateDealTaskTool } from './create-deal-task.tool.js';
import { DeleteDealTool } from './delete-deal.tool.js';
import { DisassociateDealTool } from './disassociate-deal.tool.js';
import { GetDealTool } from './get-deal.tool.js';
import { GetDealTimelineTool } from './get-deal-timeline.tool.js';
import { ListDealsTool } from './list-deals.tool.js';
import { ListDealAssociationsTool } from './list-deal-associations.tool.js';
import { ListDealPipelinesTool } from './list-deal-pipelines.tool.js';
import { LogDealCallTool } from './log-deal-call.tool.js';
import { LogDealEmailTool } from './log-deal-email.tool.js';
import { MergeDealsTool } from './merge-deals.tool.js';
import { MoveDealStageTool } from './move-deal-stage.tool.js';
import { RestoreDealTool } from './restore-deal.tool.js';
import { SearchDealsTool } from './search-deals.tool.js';
import { SetDealForecastCategoryTool } from './set-deal-forecast-category.tool.js';
import { UpdateDealTool } from './update-deal.tool.js';

export interface DealToolDependencies {
  readonly deals: DealsService;
  readonly associations: AssociationsService;
  readonly engagements: EngagementsService;
}

/**
 * The Deals module tool catalogue. Same reads-first, destructive-last
 * ordering as Contacts and Companies. `hubspot_list_deal_pipelines` is
 * placed first among reads deliberately: it is the prerequisite for using
 * the stage/pipeline tools correctly, so an orchestrator scanning the
 * catalogue top-down encounters it before the tools that depend on it.
 */
export function createDealTools(deps: DealToolDependencies): AnyToolDefinition[] {
  const { deals, associations, engagements } = deps;

  return [
    // ---------------------------------------------------------------- reads
    new ListDealPipelinesTool(deals),
    new GetDealTool(deals),
    new SearchDealsTool(deals),
    new ListDealsTool(deals),
    new BatchReadDealsTool(deals),
    new ListDealAssociationsTool(associations),
    new GetDealTimelineTool(engagements),

    // --------------------------------------------------------------- writes
    new CreateDealTool(deals),
    new UpdateDealTool(deals),
    new MoveDealStageTool(deals),
    new ChangeDealPipelineTool(deals),
    new SetDealForecastCategoryTool(deals),
    new BatchCreateDealsTool(deals),
    new BatchUpdateDealsTool(deals),
    new AssociateDealTool(associations),

    // ---------------------------------------------------------- engagements
    new CreateDealNoteTool(engagements),
    new CreateDealTaskTool(engagements),
    new LogDealCallTool(engagements),
    new CreateDealMeetingTool(engagements),
    new LogDealEmailTool(engagements),

    // ---------------------------------------------------------- destructive
    new ArchiveDealTool(deals),
    new BatchArchiveDealsTool(deals),
    new RestoreDealTool(deals),
    new MergeDealsTool(deals),
    new DisassociateDealTool(associations),
    new DeleteDealTool(deals),
  ];
}

export { CreateDealTool } from './create-deal.tool.js';
export { UpdateDealTool } from './update-deal.tool.js';
export { ArchiveDealTool } from './archive-deal.tool.js';
export { DeleteDealTool } from './delete-deal.tool.js';
export { RestoreDealTool } from './restore-deal.tool.js';
export { GetDealTool } from './get-deal.tool.js';
export { ListDealsTool } from './list-deals.tool.js';
export { SearchDealsTool } from './search-deals.tool.js';
export { MergeDealsTool } from './merge-deals.tool.js';
export { BatchCreateDealsTool } from './batch-create-deals.tool.js';
export { BatchUpdateDealsTool } from './batch-update-deals.tool.js';
export { BatchArchiveDealsTool } from './batch-archive-deals.tool.js';
export { BatchReadDealsTool } from './batch-read-deals.tool.js';
export { ListDealPipelinesTool } from './list-deal-pipelines.tool.js';
export { MoveDealStageTool } from './move-deal-stage.tool.js';
export { ChangeDealPipelineTool } from './change-deal-pipeline.tool.js';
export { SetDealForecastCategoryTool } from './set-deal-forecast-category.tool.js';
export { ListDealAssociationsTool } from './list-deal-associations.tool.js';
export { AssociateDealTool } from './associate-deal.tool.js';
export { DisassociateDealTool } from './disassociate-deal.tool.js';
export { CreateDealNoteTool } from './create-deal-note.tool.js';
export { CreateDealTaskTool } from './create-deal-task.tool.js';
export { LogDealCallTool } from './log-deal-call.tool.js';
export { CreateDealMeetingTool } from './create-deal-meeting.tool.js';
export { LogDealEmailTool } from './log-deal-email.tool.js';
export { GetDealTimelineTool } from './get-deal-timeline.tool.js';
