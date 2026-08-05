import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createMeetingInputSchema,
  engagementOutputSchema,
  type CreateMeetingInput,
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
 * `hubspot_create_contact_meeting` — records a meeting on a contact.
 *
 * The schema enforces `endTime > startTime`, which HubSpot itself accepts
 * silently — an inverted range would otherwise produce a meeting with a
 * negative duration that looks fine until someone reads a report.
 *
 * `hs_timestamp` is set to the meeting start, matching HubSpot's guidance so
 * the entry lands in the right place on the timeline.
 *
 * @example
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "title": "Q3 planning call",
 *   "startTime": "2026-08-12T14:00:00Z",
 *   "endTime": "2026-08-12T15:00:00Z",
 *   "location": "Google Meet",
 *   "outcome": "SCHEDULED"
 * }
 * ```
 */
export class CreateMeetingTool
  implements ToolDefinition<typeof createMeetingInputSchema, EngagementResult>
{
  readonly name = 'hubspot_create_contact_meeting';
  readonly title = 'Create HubSpot Meeting for Contact';
  readonly description =
    'Record a meeting on a HubSpot contact record. Requires ISO 8601 startTime and endTime, ' +
    'where endTime must be after startTime. Set outcome to SCHEDULED for an upcoming meeting, ' +
    'or COMPLETED, RESCHEDULED, NO_SHOW, or CANCELED to reflect what happened. Note this logs ' +
    'the meeting in the CRM only — it does not send a calendar invitation to anyone.';

  readonly inputSchema = createMeetingInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Meeting for Contact',
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
    input: CreateMeetingInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info(
      { contactId: input.contactId, outcome: input.outcome },
      'Creating meeting on HubSpot contact.'
    );

    const result = await this.engagements.createMeeting(input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      contactId: result.contactId,
      timestamp: result.timestamp,
      message:
        `Meeting ${result.engagementId} ("${input.title}") recorded on contact ` +
        `${result.contactId}. No calendar invitation was sent.`,
    };
  }
}
