import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  logCompanyCallInputSchema,
  engagementOutputSchema,
  type LogCompanyCallInput,
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
 * `hubspot_log_company_call` — records a call on a company's timeline.
 *
 * `durationMs` is in **milliseconds**, per HubSpot — see
 * `hubspot_log_contact_call` for the same caveat.
 *
 * @example
 * ```json
 * {
 *   "companyId": "7801234567",
 *   "title": "Renewal discussion",
 *   "durationMs": 900000,
 *   "direction": "OUTBOUND",
 *   "status": "COMPLETED"
 * }
 * ```
 */
export class LogCompanyCallTool implements ToolDefinition<
  typeof logCompanyCallInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_log_company_call';
  readonly title = 'Log Call on HubSpot Company';
  readonly description =
    'Log a phone call on a HubSpot company record. IMPORTANT: durationMs is in MILLISECONDS — ' +
    'a 15-minute call is 900000, not 15 or 900. Defaults to the current time.';

  readonly inputSchema = logCompanyCallInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log Call on HubSpot Company',
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
    input: LogCompanyCallInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info(
      { companyId: input.companyId, direction: input.direction },
      'Logging call on HubSpot company.'
    );

    const result = await this.engagements.logCall('companies', input.companyId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Call ${result.engagementId} ("${input.title}") logged on company ${result.objectId}.`,
    };
  }
}
