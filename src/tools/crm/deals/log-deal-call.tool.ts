import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  logDealCallInputSchema,
  engagementOutputSchema,
  type LogDealCallInput,
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
 * `hubspot_log_deal_call` — records a call on a deal's timeline.
 *
 * `durationMs` is in **milliseconds**, per HubSpot.
 *
 * @example
 * ```json
 * {
 *   "dealId": "9001234567",
 *   "title": "Pricing negotiation",
 *   "durationMs": 1200000,
 *   "direction": "OUTBOUND",
 *   "status": "COMPLETED"
 * }
 * ```
 */
export class LogDealCallTool implements ToolDefinition<
  typeof logDealCallInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_log_deal_call';
  readonly title = 'Log Call on HubSpot Deal';
  readonly description =
    'Log a phone call on a HubSpot deal record. IMPORTANT: durationMs is in MILLISECONDS — a ' +
    '20-minute call is 1200000, not 20 or 1200. Defaults to the current time.';

  readonly inputSchema = logDealCallInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log Call on HubSpot Deal',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(input: LogDealCallInput, context: ToolExecutionContext): Promise<EngagementResult> {
    context.logger.info(
      { dealId: input.dealId, direction: input.direction },
      'Logging call on HubSpot deal.'
    );

    const result = await this.engagements.logCall('deals', input.dealId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Call ${result.engagementId} ("${input.title}") logged on deal ${result.objectId}.`,
    };
  }
}
