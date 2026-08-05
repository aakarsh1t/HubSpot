import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  engagementOutputSchema,
  logEmailInputSchema,
  type LogEmailInput,
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
 * `hubspot_log_contact_email` — records an email on a contact's timeline.
 *
 * This **logs** an email that already exists; it does not send one. That
 * distinction is stated in the tool name, the description, and the success
 * message, because an agent asked to "email this contact" could otherwise
 * report success having sent nothing.
 *
 * @example
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "subject": "Enterprise pricing follow-up",
 *   "body": "Hi Jane, as discussed, here is the pricing breakdown...",
 *   "direction": "EMAIL",
 *   "status": "SENT"
 * }
 * ```
 *
 * @example Logging a reply received
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "subject": "Re: Enterprise pricing follow-up",
 *   "body": "Thanks — reviewing with my team this week.",
 *   "direction": "INCOMING_EMAIL"
 * }
 * ```
 */
export class LogEmailTool implements ToolDefinition<typeof logEmailInputSchema, EngagementResult> {
  readonly name = 'hubspot_log_contact_email';
  readonly title = 'Log Email on HubSpot Contact';
  readonly description =
    'Log an email on a HubSpot contact record. IMPORTANT: this records an email that has ' +
    'already been sent or received — it does NOT send an email to anyone. Set direction to ' +
    'EMAIL for a message sent from the CRM or logged via BCC, INCOMING_EMAIL for a reply ' +
    'received, or FORWARDED_EMAIL for one forwarded into the CRM. If the user actually wants an ' +
    'email sent, tell them this tool cannot do that.';

  readonly inputSchema = logEmailInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log Email on HubSpot Contact',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(input: LogEmailInput, context: ToolExecutionContext): Promise<EngagementResult> {
    context.logger.info(
      { contactId: input.contactId, direction: input.direction },
      'Logging email on HubSpot contact.'
    );

    const result = await this.engagements.logEmail(input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      contactId: result.contactId,
      timestamp: result.timestamp,
      message:
        `Email ${result.engagementId} ("${input.subject}") was logged on contact ` +
        `${result.contactId}. No email was actually sent.`,
    };
  }
}
