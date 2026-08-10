import { createCrmTools } from './crm/index.js';
import { DiagnosticsTool } from './system/diagnostics.tool.js';
import { type ToolRegistry } from './tool.registry.js';
import type { AssociationsService } from '../services/associations.service.js';
import type { CrmService } from '../services/crm.service.js';
import type { EngagementsService } from '../services/engagements.service.js';
import type { HubSpotHealthService } from '../services/hubspot-health.service.js';
import type { PropertiesService } from '../services/properties.service.js';
import type { AppConfig } from '../types/config.types.js';
import type { AnyToolDefinition } from '../types/tool.types.js';

export { ToolRegistry } from './tool.registry.js';
export { DiagnosticsTool } from './system/diagnostics.tool.js';
export { createCrmTools, type CrmToolDependencies } from './crm/index.js';

export interface ToolFactoryDependencies {
  readonly config: AppConfig;
  readonly healthService: HubSpotHealthService;
  readonly crmService: CrmService;
  readonly associationsService: AssociationsService;
  readonly engagementsService: EngagementsService;
  readonly propertiesService: PropertiesService;
  readonly registry: ToolRegistry;
}

/**
 * The single place where the tool catalogue is declared.
 *
 * **Fourteen tools, deliberately.** Every one of them is full-privilege: this
 * server is wired to an administrative Copilot Studio agent, so nothing is held
 * back — permanent deletion, merges, bulk archives, and portal schema changes
 * are all reachable. What was removed is duplication, not capability.
 *
 * The catalogue used to hold 80 tools, which is the dominant cost in an agent's
 * per-turn latency: every tool's name, description, and full JSON Schema is
 * re-sent to the orchestrator on *every* request, and the model must rank all
 * of them before it can act. Eighty near-identical entries also degrade
 * selection accuracy — `hubspot_get_contact`, `hubspot_get_company`, and
 * `hubspot_get_deal` compete with each other for the same intent, and a wrong
 * pick costs a whole round trip to discover.
 *
 * The fix was to make object type a *parameter* rather than part of the tool
 * name, which is what HubSpot's own API does. That collapsed 77 CRM tools into
 * 13 and 3 diagnostics tools into 1, with no operation lost.
 *
 * Diagnostics comes first so an agent troubleshooting a failure reaches
 * `hubspot_diagnostics` before anything else.
 */
export function createTools(deps: ToolFactoryDependencies): AnyToolDefinition[] {
  return [
    // Reads the registry lazily: this tool is inside the very list being built.
    new DiagnosticsTool(deps.config, deps.healthService, () => deps.registry.list()),

    ...createCrmTools({
      crm: deps.crmService,
      associations: deps.associationsService,
      engagements: deps.engagementsService,
      properties: deps.propertiesService,
    }),
  ];
}
