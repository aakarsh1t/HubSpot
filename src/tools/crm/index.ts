import { CreateAssociationTool } from './associations/create-association.tool.js';
import { DeleteAssociationTool } from './associations/delete-association.tool.js';
import { ListAssociationsTool } from './associations/list-associations.tool.js';
import { ArchiveContactTool } from './contacts/archive-contact.tool.js';
import { BatchArchiveContactsTool } from './contacts/batch-archive-contacts.tool.js';
import { BatchCreateContactsTool } from './contacts/batch-create-contacts.tool.js';
import { BatchReadContactsTool } from './contacts/batch-read-contacts.tool.js';
import { BatchUpdateContactsTool } from './contacts/batch-update-contacts.tool.js';
import { CreateContactTool } from './contacts/create-contact.tool.js';
import { DeleteContactTool } from './contacts/delete-contact.tool.js';
import { GetContactByEmailTool } from './contacts/get-contact-by-email.tool.js';
import { GetContactTool } from './contacts/get-contact.tool.js';
import { ListContactsTool } from './contacts/list-contacts.tool.js';
import { MergeContactsTool } from './contacts/merge-contacts.tool.js';
import { RestoreContactTool } from './contacts/restore-contact.tool.js';
import { SearchContactsTool } from './contacts/search-contacts.tool.js';
import { UpdateContactTool } from './contacts/update-contact.tool.js';
import { CreateMeetingTool } from './engagements/create-meeting.tool.js';
import { CreateNoteTool } from './engagements/create-note.tool.js';
import { CreateTaskTool } from './engagements/create-task.tool.js';
import { GetTimelineTool } from './engagements/get-timeline.tool.js';
import { LogCallTool } from './engagements/log-call.tool.js';
import { LogEmailTool } from './engagements/log-email.tool.js';
import type { AssociationsService } from '../../services/associations.service.js';
import type { ContactsService } from '../../services/contacts.service.js';
import type { EngagementsService } from '../../services/engagements.service.js';
import type { AnyToolDefinition } from '../../types/tool.types.js';

export interface CrmToolDependencies {
  readonly contacts: ContactsService;
  readonly associations: AssociationsService;
  readonly engagements: EngagementsService;
}

/**
 * The Contacts module tool catalogue.
 *
 * Ordering is intentional and is the cheapest lever available on tool
 * selection: read tools come first, writes next, destructive operations last.
 * Orchestrators weight earlier entries slightly, and the safest tools should
 * be the ones reached first.
 *
 * Every destructive operation here — permanent delete, merge, batch archive,
 * disassociate — additionally requires an explicit literal-`true` confirmation
 * field in its input schema, so none of them can be triggered by paraphrase
 * alone.
 */
export function createContactTools(deps: CrmToolDependencies): AnyToolDefinition[] {
  const { contacts, associations, engagements } = deps;

  return [
    // ---------------------------------------------------------------- reads
    new GetContactTool(contacts),
    new GetContactByEmailTool(contacts),
    new SearchContactsTool(contacts),
    new ListContactsTool(contacts),
    new BatchReadContactsTool(contacts),
    new ListAssociationsTool(associations),
    new GetTimelineTool(engagements),

    // --------------------------------------------------------------- writes
    new CreateContactTool(contacts),
    new UpdateContactTool(contacts),
    new BatchCreateContactsTool(contacts),
    new BatchUpdateContactsTool(contacts),
    new CreateAssociationTool(associations),

    // ---------------------------------------------------------- engagements
    new CreateNoteTool(engagements),
    new CreateTaskTool(engagements),
    new LogCallTool(engagements),
    new CreateMeetingTool(engagements),
    new LogEmailTool(engagements),

    // ---------------------------------------------------------- destructive
    new ArchiveContactTool(contacts),
    new BatchArchiveContactsTool(contacts),
    new RestoreContactTool(contacts),
    new MergeContactsTool(contacts),
    new DeleteAssociationTool(associations),
    new DeleteContactTool(contacts),
  ];
}

export { CreateContactTool } from './contacts/create-contact.tool.js';
export { UpdateContactTool } from './contacts/update-contact.tool.js';
export { ArchiveContactTool } from './contacts/archive-contact.tool.js';
export { DeleteContactTool } from './contacts/delete-contact.tool.js';
export { RestoreContactTool } from './contacts/restore-contact.tool.js';
export { GetContactTool } from './contacts/get-contact.tool.js';
export { GetContactByEmailTool } from './contacts/get-contact-by-email.tool.js';
export { ListContactsTool } from './contacts/list-contacts.tool.js';
export { SearchContactsTool } from './contacts/search-contacts.tool.js';
export { MergeContactsTool } from './contacts/merge-contacts.tool.js';
export { BatchCreateContactsTool } from './contacts/batch-create-contacts.tool.js';
export { BatchUpdateContactsTool } from './contacts/batch-update-contacts.tool.js';
export { BatchArchiveContactsTool } from './contacts/batch-archive-contacts.tool.js';
export { BatchReadContactsTool } from './contacts/batch-read-contacts.tool.js';
export { ListAssociationsTool } from './associations/list-associations.tool.js';
export { CreateAssociationTool } from './associations/create-association.tool.js';
export { DeleteAssociationTool } from './associations/delete-association.tool.js';
export { CreateNoteTool } from './engagements/create-note.tool.js';
export { CreateTaskTool } from './engagements/create-task.tool.js';
export { LogCallTool } from './engagements/log-call.tool.js';
export { CreateMeetingTool } from './engagements/create-meeting.tool.js';
export { LogEmailTool } from './engagements/log-email.tool.js';
export { GetTimelineTool } from './engagements/get-timeline.tool.js';
