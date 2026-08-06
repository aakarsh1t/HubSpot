import type { PropertiesService } from '../../../services/properties.service.js';
import type { AnyToolDefinition } from '../../../types/tool.types.js';
import { CreatePropertyTool } from './create-property.tool.js';
import { DeletePropertyTool } from './delete-property.tool.js';
import { GetPropertyTool } from './get-property.tool.js';
import { GetPropertyHistoryTool } from './get-property-history.tool.js';
import { ListPropertiesTool } from './list-properties.tool.js';
import { UpdatePropertyTool } from './update-property.tool.js';

export interface PropertyToolDependencies {
  readonly properties: PropertiesService;
}

/**
 * Custom property (schema) and property-history tools. One set, shared
 * across contacts, companies, and deals via an explicit `objectType`
 * parameter — see `property.schema.ts` for why this module, unlike
 * engagements and associations, does not triple its tool count per object
 * type.
 */
export function createPropertyTools(deps: PropertyToolDependencies): AnyToolDefinition[] {
  const { properties } = deps;

  return [
    new ListPropertiesTool(properties),
    new GetPropertyTool(properties),
    new GetPropertyHistoryTool(properties),
    new CreatePropertyTool(properties),
    new UpdatePropertyTool(properties),
    new DeletePropertyTool(properties),
  ];
}

export { ListPropertiesTool } from './list-properties.tool.js';
export { GetPropertyTool } from './get-property.tool.js';
export { GetPropertyHistoryTool } from './get-property-history.tool.js';
export { CreatePropertyTool } from './create-property.tool.js';
export { UpdatePropertyTool } from './update-property.tool.js';
export { DeletePropertyTool } from './delete-property.tool.js';
