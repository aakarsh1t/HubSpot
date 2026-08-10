import type { CrmService } from '../../services/crm.service.js';
import {
  listPipelinesInputSchema,
  pipelinesOutputSchema,
  type ListPipelinesInput,
} from '../../schemas/crm.schema.js';
import type { Pipeline } from '../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

interface PipelinesResult {
  readonly objectType: string;
  readonly pipelines: readonly Pipeline[];
  readonly count: number;
}

/**
 * `hubspot_list_pipelines` — the stage vocabulary for a portal.
 *
 * Kept as its own tool rather than folded into the record tools because it
 * answers a question no other tool can: pipeline and stage IDs are opaque and
 * portal-specific (`"appointmentscheduled"` in one portal, `"1042931"` in the
 * next), so there is no way to construct a valid `dealstage` value without
 * reading this first. It is the necessary prerequisite for any deal movement
 * through `hubspot_update_record`.
 */
export class ListPipelinesTool implements ToolDefinition<
  typeof listPipelinesInputSchema,
  PipelinesResult
> {
  readonly name = 'hubspot_list_pipelines';
  readonly title = 'List HubSpot Pipelines';
  readonly description =
    'List the deal (or ticket) pipelines in this HubSpot portal with their ordered stages, stage ' +
    'IDs, win probabilities, and which stages count as closed. Call this before moving a deal: ' +
    'stage and pipeline IDs are portal-specific and cannot be guessed, and hubspot_update_record ' +
    'needs a real stage ID for dealstage.';

  readonly inputSchema = listPipelinesInputSchema;
  readonly outputSchema = pipelinesOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Pipelines',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(
    input: ListPipelinesInput,
    context: ToolExecutionContext
  ): Promise<PipelinesResult> {
    const pipelines = await this.crm.listPipelines(input.objectType);

    context.logger.debug(
      { objectType: input.objectType, count: pipelines.length },
      'Listed HubSpot pipelines.'
    );

    return { objectType: input.objectType, pipelines, count: pipelines.length };
  }
}
