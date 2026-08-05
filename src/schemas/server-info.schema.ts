import { z } from 'zod';

export const serverInfoInputSchema = z.object({});

export const serverInfoOutputSchema = z.object({
  name: z.string().describe('MCP server name as advertised during initialization.'),
  version: z.string().describe('Semantic version of this MCP server.'),
  environment: z.string().describe('Deployment environment: development, test, or production.'),
  protocolTransport: z.string().describe('MCP transport in use. Always streamable-http here.'),
  sessionMode: z.string().describe('stateless or stateful session handling.'),
  authMode: z.string().describe('HubSpot credential strategy in use: private_app or oauth.'),
  hubspotBaseUrl: z.string().describe('HubSpot API base URL this server calls.'),
  toolCount: z.number().describe('Number of tools currently registered.'),
  tools: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        description: z.string(),
      })
    )
    .describe('Catalogue of tools this server exposes.'),
  uptimeSeconds: z.number().describe('How long this server instance has been running.'),
});

export type ServerInfoInput = z.output<typeof serverInfoInputSchema>;
