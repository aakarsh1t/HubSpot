import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  getDealTimelineInputSchema,
  timelineOutputSchema,
  type GetDealTimelineInput,
} from '../../../schemas/engagement.schema.js';
import type { TimelineEntry } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface TimelineResult {
  readonly objectId: string;
  readonly entries: readonly TimelineEntry[];
  readonly count: number;
  readonly countsByType: Record<string, number>;
  readonly truncated: boolean;
}

/**
 * `hubspot_get_deal_timeline` — the activity history for a deal.
 *
 * See `hubspot_get_contact_timeline` for the naming clarification about
 * HubSpot's separate "Timeline Events" feature; this is the identical
 * activity-feed reconstruction applied to deals.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "types": ["calls", "meetings", "notes"] }
 * ```
 */
export class GetDealTimelineTool implements ToolDefinition<
  typeof getDealTimelineInputSchema,
  TimelineResult
> {
  readonly name = 'hubspot_get_deal_timeline';
  readonly title = 'Get HubSpot Deal Activity Timeline';
  readonly description =
    'Retrieve the activity timeline for a HubSpot deal: notes, tasks, calls, meetings, and ' +
    'logged emails, merged into a single list sorted newest first. Use this to answer questions ' +
    'like "what has happened on this deal recently?" or "summarise the history of this deal". ' +
    'Check the truncated flag: when true, more history exists than was returned.';

  readonly inputSchema = getDealTimelineInputSchema;
  readonly outputSchema = timelineOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Deal Activity Timeline',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly engagements: EngagementsService;

  constructor(engagements: EngagementsService) {
    this.engagements = engagements;
  }

  async execute(
    input: GetDealTimelineInput,
    context: ToolExecutionContext
  ): Promise<TimelineResult> {
    context.logger.debug(
      { dealId: input.dealId, types: input.types },
      'Building HubSpot deal activity timeline.'
    );

    const timeline = await this.engagements.getTimeline('deals', input.dealId, input);

    return {
      objectId: input.dealId,
      entries: timeline.entries,
      count: timeline.entries.length,
      countsByType: timeline.countsByType,
      truncated: timeline.truncated,
    };
  }
}
