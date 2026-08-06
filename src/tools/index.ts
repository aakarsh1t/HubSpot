import { PingHubSpotTool } from './connection/ping.tool.js';
import { createCompanyTools } from './crm/companies/index.js';
import { createContactTools } from './crm/index.js';
import { createDealTools } from './crm/deals/index.js';
import { createPropertyTools } from './crm/properties/index.js';
import { TestConnectionTool } from './connection/test-connection.tool.js';
import { ServerInfoTool } from './system/server-info.tool.js';
import { type ToolRegistry } from './tool.registry.js';
import type { AssociationsService } from '../services/associations.service.js';
import type { CompaniesService } from '../services/companies.service.js';
import type { ContactsService } from '../services/contacts.service.js';
import type { DealsService } from '../services/deals.service.js';
import type { EngagementsService } from '../services/engagements.service.js';
import type { HubSpotHealthService } from '../services/hubspot-health.service.js';
import type { PropertiesService } from '../services/properties.service.js';
import type { AppConfig } from '../types/config.types.js';
import type { AnyToolDefinition } from '../types/tool.types.js';

export { ToolRegistry } from './tool.registry.js';
export { TestConnectionTool } from './connection/test-connection.tool.js';
export { PingHubSpotTool } from './connection/ping.tool.js';
export { ServerInfoTool } from './system/server-info.tool.js';

export { createContactTools, type CrmToolDependencies } from './crm/index.js';
export { createCompanyTools, type CompanyToolDependencies } from './crm/companies/index.js';
export { createDealTools, type DealToolDependencies } from './crm/deals/index.js';
export { createPropertyTools, type PropertyToolDependencies } from './crm/properties/index.js';

export interface ToolFactoryDependencies {
  readonly config: AppConfig;
  readonly healthService: HubSpotHealthService;
  readonly contactsService: ContactsService;
  readonly companiesService: CompaniesService;
  readonly dealsService: DealsService;
  readonly associationsService: AssociationsService;
  readonly engagementsService: EngagementsService;
  readonly propertiesService: PropertiesService;
  readonly registry: ToolRegistry;
}

/**
 * The single place where the tool catalogue is declared.
 *
 * Diagnostics come first so an agent troubleshooting a failure reaches
 * `hubspot_test_connection` before anything else, followed by the three CRM
 * object modules (Contacts, Companies, Deals) and the cross-object property
 * tools. A future object type — Tickets — becomes one more `create*Tools`
 * factory here and one more directory under `src/tools/crm/`, with no other
 * file changing.
 */
export function createTools(deps: ToolFactoryDependencies): AnyToolDefinition[] {
  return [
    new TestConnectionTool(deps.healthService),
    new PingHubSpotTool(deps.healthService),
    // Reads the registry lazily: this tool is inside the very list being built.
    new ServerInfoTool(deps.config, () => deps.registry.list()),

    ...createContactTools({
      contacts: deps.contactsService,
      associations: deps.associationsService,
      engagements: deps.engagementsService,
    }),

    ...createCompanyTools({
      companies: deps.companiesService,
      associations: deps.associationsService,
      engagements: deps.engagementsService,
    }),

    ...createDealTools({
      deals: deps.dealsService,
      associations: deps.associationsService,
      engagements: deps.engagementsService,
    }),

    ...createPropertyTools({
      properties: deps.propertiesService,
    }),
  ];
}
