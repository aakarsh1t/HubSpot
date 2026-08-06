import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createCompanyTaskInputSchema,
  engagementOutputSchema,
  type CreateCompanyTaskInput,
} from '../../../schemas/engagement.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface EngagementResult {
  readonly success: boolean;
  readonly engagementId: string;
  readonly engagementType: string;
  readonly objectId: string;
  readonly timestamp: string | null;
  readonly message: string;
}

/**
 * `hubspot_create_company_task` — creates a task against a company.
 *
 * @example
 * ```json
 * {
 *   "companyId": "7801234567",
 *   "subject": "Schedule quarterly business review",
 *   "dueDate": "2026-09-01T17:00:00Z",
 *   "priority": "HIGH"
 * }
 * ```
 */
export class CreateCompanyTaskTool implements ToolDefinition<
  typeof createCompanyTaskInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_company_task';
  readonly title = 'Create HubSpot Task for Company';
  readonly description =
    'Create a task associated with a HubSpot company. Set dueDate as an ISO 8601 timestamp, ' +
    'status to NOT_STARTED or COMPLETED, priority to LOW, MEDIUM, or HIGH, and taskType to ' +
    'EMAIL, CALL, or TODO. Assign the task by passing the HubSpot owner ID.';

  readonly inputSchema = createCompanyTaskInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Task for Company',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(
    input: CreateCompanyTaskInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info(
      { companyId: input.companyId, priority: input.priority },
      'Creating task on HubSpot company.'
    );

    const result = await this.engagements.createTask('companies', input.companyId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Task ${result.engagementId} ("${input.subject}") created for company ${result.objectId}.`,
    };
  }
}
