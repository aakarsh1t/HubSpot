import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createDealMeetingInputSchema,
  engagementOutputSchema,
  type CreateDealMeetingInput,
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
 * `hubspot_create_deal_meeting` — records a meeting on a deal.
 *
 * @example
 * ```json
 * {
 *   "dealId": "9001234567",
 *   "title": "Contract review call",
 *   "startTime": "2026-09-05T14:00:00Z",
 *   "endTime": "2026-09-05T15:00:00Z",
 *   "outcome": "SCHEDULED"
 * }
 * ```
 */
export class CreateDealMeetingTool implements ToolDefinition<
  typeof createDealMeetingInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_deal_meeting';
  readonly title = 'Create HubSpot Meeting for Deal';
  readonly description =
    'Record a meeting on a HubSpot deal record. Requires ISO 8601 startTime and endTime, where ' +
    'endTime must be after startTime. This logs the meeting in the CRM only — it does not send ' +
    'a calendar invitation to anyone.';

  readonly inputSchema = createDealMeetingInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Meeting for Deal',
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
    input: CreateDealMeetingInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info({ dealId: input.dealId }, 'Creating meeting on HubSpot deal.');

    const result = await this.engagements.createMeeting('deals', input.dealId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Meeting ${result.engagementId} ("${input.title}") recorded on deal ${result.objectId}.`,
    };
  }
}
