import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createDealNoteInputSchema,
  engagementOutputSchema,
  type CreateDealNoteInput,
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
 * `hubspot_create_deal_note` — adds a note to a deal's timeline.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "body": "Champion confirmed budget approval for Q4." }
 * ```
 */
export class CreateDealNoteTool implements ToolDefinition<
  typeof createDealNoteInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_deal_note';
  readonly title = 'Add Note to HubSpot Deal';
  readonly description =
    'Add a note to a HubSpot deal record. The note appears on the deal timeline. Defaults to ' +
    'the current time; pass a timestamp to backdate the entry.';

  readonly inputSchema = createDealNoteInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Add Note to HubSpot Deal',
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
    input: CreateDealNoteInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info({ dealId: input.dealId }, 'Creating note on HubSpot deal.');

    const result = await this.engagements.createNote('deals', input.dealId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Note ${result.engagementId} added to deal ${result.objectId}.`,
    };
  }
}
