import type { AssociationsService } from '../../../services/associations.service.js';
import type { CompaniesService } from '../../../services/companies.service.js';
import type { EngagementsService } from '../../../services/engagements.service.js';
import type { AnyToolDefinition } from '../../../types/tool.types.js';
import { AssociateCompanyTool } from './associate-company.tool.js';
import { ArchiveCompanyTool } from './archive-company.tool.js';
import { BatchArchiveCompaniesTool } from './batch-archive-companies.tool.js';
import { BatchCreateCompaniesTool } from './batch-create-companies.tool.js';
import { BatchReadCompaniesTool } from './batch-read-companies.tool.js';
import { BatchUpdateCompaniesTool } from './batch-update-companies.tool.js';
import { CreateCompanyTool } from './create-company.tool.js';
import { CreateCompanyMeetingTool } from './create-company-meeting.tool.js';
import { CreateCompanyNoteTool } from './create-company-note.tool.js';
import { CreateCompanyTaskTool } from './create-company-task.tool.js';
import { DeleteCompanyTool } from './delete-company.tool.js';
import { DisassociateCompanyTool } from './disassociate-company.tool.js';
import { GetCompanyTool } from './get-company.tool.js';
import { GetCompanyTimelineTool } from './get-company-timeline.tool.js';
import { ListCompaniesTool } from './list-companies.tool.js';
import { ListCompanyAssociationsTool } from './list-company-associations.tool.js';
import { LogCompanyCallTool } from './log-company-call.tool.js';
import { LogCompanyEmailTool } from './log-company-email.tool.js';
import { MergeCompaniesTool } from './merge-companies.tool.js';
import { RestoreCompanyTool } from './restore-company.tool.js';
import { SearchCompaniesTool } from './search-companies.tool.js';
import { UpdateCompanyTool } from './update-company.tool.js';

export interface CompanyToolDependencies {
  readonly companies: CompaniesService;
  readonly associations: AssociationsService;
  readonly engagements: EngagementsService;
}

/**
 * The Companies module tool catalogue. Same ordering rationale as
 * `createContactTools`: reads first, writes next, destructive operations
 * last, since orchestrators weight earlier entries and the safest tools
 * should be reached first.
 */
export function createCompanyTools(deps: CompanyToolDependencies): AnyToolDefinition[] {
  const { companies, associations, engagements } = deps;

  return [
    // ---------------------------------------------------------------- reads
    new GetCompanyTool(companies),
    new SearchCompaniesTool(companies),
    new ListCompaniesTool(companies),
    new BatchReadCompaniesTool(companies),
    new ListCompanyAssociationsTool(associations),
    new GetCompanyTimelineTool(engagements),

    // --------------------------------------------------------------- writes
    new CreateCompanyTool(companies),
    new UpdateCompanyTool(companies),
    new BatchCreateCompaniesTool(companies),
    new BatchUpdateCompaniesTool(companies),
    new AssociateCompanyTool(associations),

    // ---------------------------------------------------------- engagements
    new CreateCompanyNoteTool(engagements),
    new CreateCompanyTaskTool(engagements),
    new LogCompanyCallTool(engagements),
    new CreateCompanyMeetingTool(engagements),
    new LogCompanyEmailTool(engagements),

    // ---------------------------------------------------------- destructive
    new ArchiveCompanyTool(companies),
    new BatchArchiveCompaniesTool(companies),
    new RestoreCompanyTool(companies),
    new MergeCompaniesTool(companies),
    new DisassociateCompanyTool(associations),
    new DeleteCompanyTool(companies),
  ];
}

export { CreateCompanyTool } from './create-company.tool.js';
export { UpdateCompanyTool } from './update-company.tool.js';
export { ArchiveCompanyTool } from './archive-company.tool.js';
export { DeleteCompanyTool } from './delete-company.tool.js';
export { RestoreCompanyTool } from './restore-company.tool.js';
export { GetCompanyTool } from './get-company.tool.js';
export { ListCompaniesTool } from './list-companies.tool.js';
export { SearchCompaniesTool } from './search-companies.tool.js';
export { MergeCompaniesTool } from './merge-companies.tool.js';
export { BatchCreateCompaniesTool } from './batch-create-companies.tool.js';
export { BatchUpdateCompaniesTool } from './batch-update-companies.tool.js';
export { BatchArchiveCompaniesTool } from './batch-archive-companies.tool.js';
export { BatchReadCompaniesTool } from './batch-read-companies.tool.js';
export { ListCompanyAssociationsTool } from './list-company-associations.tool.js';
export { AssociateCompanyTool } from './associate-company.tool.js';
export { DisassociateCompanyTool } from './disassociate-company.tool.js';
export { CreateCompanyNoteTool } from './create-company-note.tool.js';
export { CreateCompanyTaskTool } from './create-company-task.tool.js';
export { LogCompanyCallTool } from './log-company-call.tool.js';
export { CreateCompanyMeetingTool } from './create-company-meeting.tool.js';
export { LogCompanyEmailTool } from './log-company-email.tool.js';
export { GetCompanyTimelineTool } from './get-company-timeline.tool.js';
