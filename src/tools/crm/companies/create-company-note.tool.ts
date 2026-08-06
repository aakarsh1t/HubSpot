import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  createCompanyNoteInputSchema,
  engagementOutputSchema,
  type CreateCompanyNoteInput,
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
 * `hubspot_create_company_note` — adds a note to a company's timeline.
 *
 * @example
 * ```json
 * { "companyId": "7801234567", "body": "Renewed enterprise contract for another year." }
 * ```
 */
export class CreateCompanyNoteTool implements ToolDefinition<
  typeof createCompanyNoteInputSchema,
  EngagementResult
> {
  readonly name = 'hubspot_create_company_note';
  readonly title = 'Add Note to HubSpot Company';
  readonly description =
    'Add a note to a HubSpot company record. The note appears on the company timeline. Use this ' +
    'to record context that is not itself a call, meeting, task, or email. Defaults to the ' +
    'current time; pass a timestamp to backdate the entry.';

  readonly inputSchema = createCompanyNoteInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Add Note to HubSpot Company',
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
    input: CreateCompanyNoteInput,
    context: ToolExecutionContext
  ): Promise<EngagementResult> {
    context.logger.info({ companyId: input.companyId }, 'Creating note on HubSpot company.');

    const result = await this.engagements.createNote('companies', input.companyId, input);

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: result.engagementType,
      objectId: result.objectId,
      timestamp: result.timestamp,
      message: `Note ${result.engagementId} added to company ${result.objectId}.`,
    };
  }
}
