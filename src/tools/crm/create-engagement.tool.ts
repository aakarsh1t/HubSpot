import type { EngagementResult, EngagementsService } from '../../services/engagements.service.js';
import { ValidationError } from '../../utils/errors.js';
import {
  createEngagementInputSchema,
  engagementOutputSchema,
  type CreateEngagementInput,
} from '../../schemas/crm.schema.js';
import type { CrmObjectType } from '../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

interface EngagementToolResult {
  readonly success: boolean;
  readonly engagementId: string;
  readonly engagementType: string;
  readonly objectType: string;
  readonly recordId: string;
  readonly timestamp: string | null;
  readonly message: string;
}

/**
 * `hubspot_create_engagement` — logs a note, task, call, meeting, or email.
 *
 * The biggest single consolidation in the catalogue: fifteen tools (five
 * activity types × three object types) become one. The activity payload was
 * always identical regardless of which record it was logged against —
 * `EngagementsService` has taken `(objectType, objectId, body)` from the start
 * — so the only thing the fifteen tools varied was their name.
 *
 * Each engagement is created and associated with its target record in a single
 * HubSpot request, so a failure cannot leave an orphaned note behind.
 *
 * @example
 * ```json
 * {
 *   "objectType": "deals", "recordId": "9001",
 *   "engagementType": "call",
 *   "call": { "title": "Pricing follow-up", "durationMs": 900000, "direction": "OUTBOUND" }
 * }
 * ```
 */
export class CreateEngagementTool implements ToolDefinition<
  typeof createEngagementInputSchema,
  EngagementToolResult
> {
  readonly name = 'hubspot_create_engagement';
  readonly title = 'Log HubSpot Activity';
  readonly description =
    'Log an activity on a HubSpot contact, company, or deal timeline: a note, task, call, ' +
    'meeting, or email. Set engagementType and supply the matching payload object (note / task / ' +
    'call / meeting / email). Timestamps are ISO 8601 and default to now; call durations are in ' +
    'milliseconds. Not idempotent — calling twice logs the activity twice.';

  readonly inputSchema = createEngagementInputSchema;
  readonly outputSchema = engagementOutputSchema;

  readonly annotations = {
    title: 'Log HubSpot Activity',
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
    input: CreateEngagementInput,
    context: ToolExecutionContext
  ): Promise<EngagementToolResult> {
    const result = await this.dispatch(input, input.objectType, input.recordId);

    context.logger.info(
      {
        objectType: input.objectType,
        recordId: input.recordId,
        engagementType: input.engagementType,
        engagementId: result.engagementId,
      },
      'Logged HubSpot activity.'
    );

    return {
      success: true,
      engagementId: result.engagementId,
      engagementType: input.engagementType,
      objectType: input.objectType,
      recordId: input.recordId,
      timestamp: result.timestamp,
      message: `Logged ${input.engagementType} ${result.engagementId} on ${input.objectType} record ${input.recordId}.`,
    };
  }

  private dispatch(
    input: CreateEngagementInput,
    objectType: CrmObjectType,
    recordId: string
  ): Promise<EngagementResult> {
    switch (input.engagementType) {
      case 'note':
        return this.engagements.createNote(
          objectType,
          recordId,
          requirePayload(input.note, 'note')
        );
      case 'task':
        return this.engagements.createTask(
          objectType,
          recordId,
          requirePayload(input.task, 'task')
        );
      case 'call':
        return this.engagements.logCall(objectType, recordId, requirePayload(input.call, 'call'));
      case 'meeting':
        return this.engagements.createMeeting(
          objectType,
          recordId,
          requirePayload(input.meeting, 'meeting')
        );
      case 'email':
        return this.engagements.logEmail(
          objectType,
          recordId,
          requirePayload(input.email, 'email')
        );
    }
  }
}

/**
 * The schema refinement already guarantees the payload matching
 * `engagementType` is present; this narrows the optional away for TypeScript
 * and keeps a schema regression surfacing as a typed validation error.
 */
function requirePayload<T>(payload: T | undefined, engagementType: string): T {
  if (payload === undefined) {
    throw new ValidationError(
      `engagementType "${engagementType}" requires the "${engagementType}" payload object.`
    );
  }
  return payload;
}
