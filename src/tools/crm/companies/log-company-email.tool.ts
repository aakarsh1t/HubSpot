import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  logCompanyEmailInputSchema,
  engagementOutputSchema,
  type LogCompanyEmailInput,
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
 * `hubspot_log_company_email` — records an email on a company's timeline.
 *
 * This **logs** an email that already exists; it does not send one — see
 * `hubspot_log_contact_email` for the same caveat.
 *
 * @example
 * ```json
 * {
 *   "companyId": "7801234567",
 *   "subject": "Contract renewal terms",
 *   "body": "Attached is the renewal agreement for review.",
 *   "direction": "EMAIL"
 * }
 * ```
 */
export class LogCompanyEmailTool implements ToolDefinition<
  typeof logCompanyEmailInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_log_company_email';
  readonly title = 'Log Email on HubSpot Company';
  readonly description =
    'Log an email on a HubSpot company record. IMPORTANT: this records an email that has ' +
    'already been sent or received — it does NOT send an email to anyone.';

  readonly inputSchema = logCompanyEmailInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log Email on HubSpot Company',
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
    input: LogCompanyEmailInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info({ companyId: input.companyId }, 'Logging email on HubSpot company.');

    const result = await this.engagements.logEmail('companies', input.companyId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Email ${result.engagementId} ("${input.subject}") was logged on company ${result.objectId}. No email was actually sent.`,
    };
  }
}
