import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  getTimelineInputSchema,
  timelineOutputSchema,
  type GetTimelineInput,
} from '../../../schemas/engagement.schema.js';
import type { TimelineEntry } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface TimelineResult {
  readonly contactId: string;
  readonly entries: readonly TimelineEntry[];
  readonly count: number;
  readonly countsByType: Record<string, number>;
  readonly truncated: boolean;
}

/**
 * `hubspot_get_contact_timeline` — the activity history for a contact.
 *
 * A naming clarification worth stating plainly, because it trips people up:
 * HubSpot's "Timeline Events API" is a *different* feature for creating
 * custom event types, and it requires a developer app with a registered event
 * template — a private app token cannot use it at all. What people mean by
 * "the contact's timeline" is the activity feed on the record, which is what
 * this reconstructs from the contact's associated engagements.
 *
 * Implementation: for each requested type, list associated IDs and batch-read
 * their properties, then merge and sort newest-first. Types are fetched
 * concurrently, so latency is that of the slowest type rather than the sum of
 * all five.
 *
 * `truncated` reports whether any type hit the requested ceiling, so a caller
 * knows the history is incomplete instead of assuming it saw everything.
 *
 * @example Full timeline
 * ```json
 * { "contactId": "51234567890" }
 * ```
 *
 * @example Only calls and meetings, deeper history
 * ```json
 * { "contactId": "51234567890", "types": ["calls", "meetings"], "limitPerType": 50 }
 * ```
 */
export class GetTimelineTool implements ToolDefinition<
  typeof getTimelineInputSchema,
  TimelineResult
> {
  readonly name = 'hubspot_get_contact_timeline';
  readonly title = 'Get HubSpot Contact Activity Timeline';
  readonly description =
    'Retrieve the activity timeline for a HubSpot contact: notes, tasks, calls, meetings, and ' +
    'logged emails, merged into a single list sorted newest first. Use this to answer questions ' +
    'like "what has happened with this contact recently?", "when did we last speak to them?", ' +
    'or "summarise our relationship with this person". Restrict the types array to fetch fewer ' +
    'activity kinds. Check the truncated flag: when true, more history exists than was returned ' +
    'and you should raise limitPerType.';

  readonly inputSchema = getTimelineInputSchema;
  readonly outputSchema = timelineOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Contact Activity Timeline',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(input: GetTimelineInput, context: ToolExecutionContext): Promise<TimelineResult> {
    context.logger.debug(
      { contactId: input.contactId, types: input.types, limitPerType: input.limitPerType },
      'Building HubSpot contact activity timeline.'
    );

    const timeline = await this.engagements.getTimeline(input);

    return {
      contactId: input.contactId,
      entries: timeline.entries,
      count: timeline.entries.length,
      countsByType: timeline.countsByType,
      truncated: timeline.truncated,
    };
  }
}
