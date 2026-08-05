import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  engagementOutputSchema,
  logCallInputSchema,
  type LogCallInput,
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
 * `hubspot_log_contact_call` — records a call on a contact's timeline.
 *
 * Note `durationMs`: HubSpot stores call duration in **milliseconds**, which
 * is a reliable source of 60×-off errors. The field is named explicitly and
 * described so neither a human nor a model has to guess the unit.
 *
 * @example
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "title": "Discovery call",
 *   "body": "Walked through requirements. Budget approved for Q4.",
 *   "durationMs": 1800000,
 *   "direction": "OUTBOUND",
 *   "status": "COMPLETED"
 * }
 * ```
 */
export class LogCallTool implements ToolDefinition<typeof logCallInputSchema, EngagementResult> {
  readonly name = 'hubspot_log_contact_call';
  readonly title = 'Log Call on HubSpot Contact';
  readonly description =
    'Log a phone call on a HubSpot contact record. Records the call title, notes, direction ' +
    '(INBOUND or OUTBOUND), outcome status, and duration. IMPORTANT: durationMs is in ' +
    'MILLISECONDS — a 30-minute call is 1800000, not 30 or 1800. Defaults to the current time; ' +
    'pass a timestamp to log a call that happened earlier.';

  readonly inputSchema = logCallInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log Call on HubSpot Contact',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(input: LogCallInput, context: ToolExecutionContext): Promise<EngagementResult> {
    context.logger.info(
      { contactId: input.contactId, direction: input.direction, status: input.status },
      'Logging call on HubSpot contact.'
    );

    const result = await this.engagements.logCall(input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      contactId: result.contactId,
      timestamp: result.timestamp,
      message: `Call ${result.engagementId} ("${input.title}") logged on contact ${result.contactId}.`,
    };
  }
}
