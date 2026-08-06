import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createTaskInputSchema,
  engagementOutputSchema,
  type CreateTaskInput,
} from '../../../schemas/engagement.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface EngagementResult {
  readonly success: boolean;
  readonly engagementId: string;
  readonly engagementType: string;
  readonly contactId: string;
  readonly timestamp: string | null;
  readonly message: string;
}

/**
 * `hubspot_create_contact_task` — creates a task against a contact.
 *
 * HubSpot models a task's due date as `hs_timestamp`, which is unintuitive
 * enough that the schema exposes it as `dueDate` and performs the mapping.
 * Status, priority, and type are constrained to HubSpot's exact enum values,
 * so an agent inventing `"IN_PROGRESS"` fails validation locally with the
 * allowed values rather than getting a 400 from HubSpot.
 *
 * @example
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "subject": "Send enterprise pricing deck",
 *   "dueDate": "2026-08-12T17:00:00Z",
 *   "priority": "HIGH",
 *   "taskType": "EMAIL"
 * }
 * ```
 */
export class CreateTaskTool implements ToolDefinition<
  typeof createTaskInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_contact_task';
  readonly title = 'Create HubSpot Task for Contact';
  readonly description =
    'Create a task associated with a HubSpot contact. Tasks are actionable to-dos that appear ' +
    "in the assigned user's HubSpot task queue and on the contact timeline. Set dueDate as an " +
    'ISO 8601 timestamp, status to NOT_STARTED or COMPLETED, priority to LOW, MEDIUM, or HIGH, ' +
    'and taskType to EMAIL, CALL, or TODO. Assign the task by passing the HubSpot owner ID. ' +
    'Use this for future work; use hubspot_create_contact_note to record something that already ' +
    'happened.';

  readonly inputSchema = createTaskInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Task for Contact',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(input: CreateTaskInput, context: ToolExecutionContext): Promise<EngagementResult> {
    context.logger.info(
      { contactId: input.contactId, priority: input.priority, taskType: input.taskType },
      'Creating task on HubSpot contact.'
    );

    const result = await this.engagements.createTask('contacts', input.contactId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      contactId: result.objectId,
      timestamp: result.timestamp,
      message:
        `Task ${result.engagementId} ("${input.subject}") created for contact ` +
        `${result.objectId}, due ${result.timestamp ?? 'now'}.`,
    };
  }
}
