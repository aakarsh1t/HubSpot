import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createDealTaskInputSchema,
  engagementOutputSchema,
  type CreateDealTaskInput,
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
 * `hubspot_create_deal_task` — creates a task against a deal.
 *
 * @example
 * ```json
 * {
 *   "dealId": "9001234567",
 *   "subject": "Send updated proposal",
 *   "dueDate": "2026-09-05T17:00:00Z",
 *   "priority": "HIGH"
 * }
 * ```
 */
export class CreateDealTaskTool implements ToolDefinition<
  typeof createDealTaskInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_deal_task';
  readonly title = 'Create HubSpot Task for Deal';
  readonly description =
    'Create a task associated with a HubSpot deal. Set dueDate as an ISO 8601 timestamp, status ' +
    'to NOT_STARTED or COMPLETED, priority to LOW, MEDIUM, or HIGH, and taskType to EMAIL, CALL, ' +
    'or TODO.';

  readonly inputSchema = createDealTaskInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Task for Deal',
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
    input: CreateDealTaskInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info(
      { dealId: input.dealId, priority: input.priority },
      'Creating task on HubSpot deal.'
    );

    const result = await this.engagements.createTask('deals', input.dealId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Task ${result.engagementId} ("${input.subject}") created for deal ${result.objectId}.`,
    };
  }
}
