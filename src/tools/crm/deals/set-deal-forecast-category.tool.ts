import type { DealsService } from '../../../services/deals.service.js';
import {
  dealOutputSchema,
  setForecastCategoryInputSchema,
  type SetForecastCategoryInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_set_deal_forecast_category` — sets a deal's forecast category.
 *
 * A dedicated tool rather than a generic property update purely for
 * discoverability: `hs_forecast_category` is not an obvious property name,
 * and this is a common enough operation (updating sales forecasts) to
 * deserve a named entry point. HubSpot's option set for this field is
 * portal-configurable rather than a universal fixed enum, so the schema
 * accepts any non-empty string — see `deal.schema.ts` for the full rationale
 * and the commonly-seen values.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "forecastCategory": "commit" }
 * ```
 */
export class SetDealForecastCategoryTool implements ToolDefinition<
  typeof setForecastCategoryInputSchema,
  CrmObject
> {
  readonly name = 'hubspot_set_deal_forecast_category';
  readonly title = 'Set HubSpot Deal Forecast Category';
  readonly description =
    'Set the forecast category on a HubSpot deal (e.g. pipeline, best case, commit, omitted, ' +
    'closed). The exact set of allowed values is configurable per HubSpot portal; if a value is ' +
    "rejected, check the user's HubSpot deal property settings for the authoritative list for " +
    'this portal.';

  readonly inputSchema = setForecastCategoryInputSchema;
  readonly outputSchema = dealOutputSchema;

  readonly annotations = {
    title: 'Set HubSpot Deal Forecast Category',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(
    input: SetForecastCategoryInput,
    context: ToolExecutionContext
  ): Promise<CrmObject> {
    context.logger.info(
      { dealId: input.dealId, forecastCategory: input.forecastCategory },
      'Setting HubSpot deal forecast category.'
    );

    return this.deals.setForecastCategory(input.dealId, input.forecastCategory);
  }
}
