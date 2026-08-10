import type { EngagementsService } from '../../services/engagements.service.js';
import {
  getTimelineInputSchema,
  timelineOutputSchema,
  type GetTimelineInput,
} from '../../schemas/crm.schema.js';
import type { TimelineEntry } from '../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

interface TimelineToolResult {
  readonly objectType: string;
  readonly recordId: string;
  readonly entries: readonly TimelineEntry[];
  readonly count: number;
  readonly countsByType: Record<string, number>;
  readonly truncated: boolean;
}

/**
 * `hubspot_get_timeline` — the activity feed for one record.
 *
 * A note on naming: HubSpot's "Timeline Events API" is a different feature —
 * it creates *custom* event types and needs a developer app with an event
 * template, which a private app cannot do. What people mean by "the record's
 * timeline" is the activity feed shown on the record, which is what this
 * reconstructs from the record's associated engagements.
 *
 * Each requested type is one round trip, fetched concurrently, so narrowing
 * `types` is the direct lever on this tool's latency — hence the hint in the
 * schema description.
 */
export class GetTimelineTool implements ToolDefinition<
  typeof getTimelineInputSchema,
  TimelineToolResult
> {
  readonly name = 'hubspot_get_timeline';
  readonly title = 'Get HubSpot Activity Timeline';
  readonly description =
    'Read the activity timeline of a HubSpot contact, company, or deal: notes, tasks, calls, ' +
    'meetings, and emails merged and sorted newest first. Narrow types to only what you need — ' +
    'each type is a separate HubSpot round trip. Returns truncated: true when more activities ' +
    'exist than were fetched.';

  readonly inputSchema = getTimelineInputSchema;
  readonly outputSchema = timelineOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Activity Timeline',
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
    input: GetTimelineInput,
    context: ToolExecutionContext
  ): Promise<TimelineToolResult> {
    const timeline = await this.engagements.getTimeline(input.objectType, input.recordId, {
      types: input.types,
      limitPerType: input.limitPerType,
    });

    context.logger.debug(
      { objectType: input.objectType, recordId: input.recordId, count: timeline.entries.length },
      'Read HubSpot activity timeline.'
    );

    return {
      objectType: input.objectType,
      recordId: input.recordId,
      entries: timeline.entries,
      count: timeline.entries.length,
      countsByType: timeline.countsByType,
      truncated: timeline.truncated,
    };
  }
}
