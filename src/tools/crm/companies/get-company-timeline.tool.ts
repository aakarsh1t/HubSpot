import type { EngagementsService } from '../../../services/engagements.service.js';
import {
  getCompanyTimelineInputSchema,
  timelineOutputSchema,
  type GetCompanyTimelineInput,
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
 * `hubspot_get_company_timeline` — the activity history for a company.
 *
 * See `hubspot_get_contact_timeline` for the naming clarification about
 * HubSpot's separate "Timeline Events" feature; this is the identical
 * activity-feed reconstruction applied to companies.
 *
 * @example
 * ```json
 * { "companyId": "7801234567", "types": ["calls", "meetings"], "limitPerType": 50 }
 * ```
 */
export class GetCompanyTimelineTool implements ToolDefinition<
  typeof getCompanyTimelineInputSchema,
  TimelineResult
> {
  readonly name = 'hubspot_get_company_timeline';
  readonly title = 'Get HubSpot Company Activity Timeline';
  readonly description =
    'Retrieve the activity timeline for a HubSpot company: notes, tasks, calls, meetings, and ' +
    'logged emails, merged into a single list sorted newest first. Restrict the types array to ' +
    'fetch fewer activity kinds. Check the truncated flag: when true, more history exists than ' +
    'was returned and you should raise limitPerType.';

  readonly inputSchema = getCompanyTimelineInputSchema;
  readonly outputSchema = timelineOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Company Activity Timeline',
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
    input: GetCompanyTimelineInput,
    context: ToolExecutionContext
  ): Promise<TimelineResult> {
    context.logger.debug(
      { companyId: input.companyId, types: input.types },
      'Building HubSpot company activity timeline.'
    );

    const timeline = await this.engagements.getTimeline('companies', input.companyId, input);

    return {
      objectId: input.companyId,
      entries: timeline.entries,
      count: timeline.entries.length,
      countsByType: timeline.countsByType,
      truncated: timeline.truncated,
    };
  }
}
