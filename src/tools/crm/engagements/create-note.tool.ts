import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createNoteInputSchema,
  engagementOutputSchema,
  type CreateNoteInput,
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
 * `hubspot_create_contact_note` — adds a note to a contact's timeline.
 *
 * Creates the note and its association to the contact in a single request; a
 * two-call implementation would strand an orphaned note whenever the second
 * call failed.
 *
 * Not idempotent — the underlying request is non-retryable so a timeout cannot
 * duplicate a note on a customer record.
 *
 * @example
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "body": "Discussed enterprise pricing. Wants a follow-up in Q3."
 * }
 * ```
 *
 * @example Backdated, attributed to an owner
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "body": "Left voicemail.",
 *   "timestamp": "2026-08-01T09:30:00Z",
 *   "ownerId": "12345678"
 * }
 * ```
 */
export class CreateNoteTool implements ToolDefinition<
  typeof createNoteInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_contact_note';
  readonly title = 'Add Note to HubSpot Contact';
  readonly description =
    'Add a note to a HubSpot contact record. The note appears on the contact timeline and is ' +
    'visible to everyone with access to that contact. Use this to record context that is not ' +
    'itself a call, meeting, task, or email — for example a summary of a conversation or a ' +
    'research finding. Defaults to the current time; pass a timestamp to backdate the entry.';

  readonly inputSchema = createNoteInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Add Note to HubSpot Contact',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(input: CreateNoteInput, context: ToolExecutionContext): Promise<EngagementResult> {
    context.logger.info({ contactId: input.contactId }, 'Creating note on HubSpot contact.');

    const result = await this.engagements.createNote('contacts', input.contactId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      contactId: result.objectId,
      timestamp: result.timestamp,
      message: `Note ${result.engagementId} added to contact ${result.objectId}.`,
    };
  }
}
