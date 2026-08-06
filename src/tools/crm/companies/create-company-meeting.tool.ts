import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createCompanyMeetingInputSchema,
  engagementOutputSchema,
  type CreateCompanyMeetingInput,
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
 * `hubspot_create_company_meeting` — records a meeting on a company.
 *
 * @example
 * ```json
 * {
 *   "companyId": "7801234567",
 *   "title": "Quarterly business review",
 *   "startTime": "2026-09-01T14:00:00Z",
 *   "endTime": "2026-09-01T15:00:00Z",
 *   "outcome": "SCHEDULED"
 * }
 * ```
 */
export class CreateCompanyMeetingTool implements ToolDefinition<
  typeof createCompanyMeetingInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_company_meeting';
  readonly title = 'Create HubSpot Meeting for Company';
  readonly description =
    'Record a meeting on a HubSpot company record. Requires ISO 8601 startTime and endTime, ' +
    'where endTime must be after startTime. This logs the meeting in the CRM only — it does ' +
    'not send a calendar invitation to anyone.';

  readonly inputSchema = createCompanyMeetingInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Meeting for Company',
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
    input: CreateCompanyMeetingInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info({ companyId: input.companyId }, 'Creating meeting on HubSpot company.');

    const result = await this.engagements.createMeeting('companies', input.companyId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Meeting ${result.engagementId} ("${input.title}") recorded on company ${result.objectId}.`,
    };
  }
}
