import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  logDealEmailInputSchema,
  engagementOutputSchema,
  type LogDealEmailInput,
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
 * `hubspot_log_deal_email` — records an email on a deal's timeline.
 *
 * This **logs** an email that already exists; it does not send one.
 *
 * @example
 * ```json
 * {
 *   "dealId": "9001234567",
 *   "subject": "Revised proposal attached",
 *   "body": "Please find the updated pricing attached.",
 *   "direction": "EMAIL"
 * }
 * ```
 */
export class LogDealEmailTool implements ToolDefinition<
  typeof logDealEmailInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_log_deal_email';
  readonly title = 'Log Email on HubSpot Deal';
  readonly description =
    'Log an email on a HubSpot deal record. IMPORTANT: this records an email that has already ' +
    'been sent or received — it does NOT send an email to anyone.';

  readonly inputSchema = logDealEmailInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log Email on HubSpot Deal',
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
    input: LogDealEmailInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info({ dealId: input.dealId }, 'Logging email on HubSpot deal.');

    const result = await this.engagements.logEmail('deals', input.dealId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Email ${result.engagementId} ("${input.subject}") was logged on deal ${result.objectId}. No email was actually sent.`,
    };
  }
}
