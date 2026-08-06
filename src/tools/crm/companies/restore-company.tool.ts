import { z } from 'zod';
import type { CompaniesService } from '../../../services/companies.service.js';
import {
  restoreCompanyInputSchema,
  type RestoreCompanyInput,
} from '../../../schemas/company.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const restoreOutputSchema = z.object({
  success: z.boolean(),
  restoredAsNewRecord: z.boolean(),
  originalCompanyId: z.string(),
  newCompanyId: z.string(),
  propertiesCopied: z.number(),
  notRestored: z.array(z.string()),
  message: z.string(),
});

interface RestoreResult {
  readonly success: boolean;
  readonly restoredAsNewRecord: boolean;
  readonly originalCompanyId: string;
  readonly newCompanyId: string;
  readonly propertiesCopied: number;
  readonly notRestored: string[];
  readonly message: string;
}

/**
 * `hubspot_restore_company` — recreates an archived company as a new record.
 *
 * Same platform constraint as `hubspot_restore_contact`: HubSpot has no
 * un-archive API for any object type. See that tool's documentation for the
 * full explanation; this is the identical recovery path applied to companies.
 *
 * @example
 * ```json
 * { "companyId": "7801234567", "confirmRecreate": true }
 * ```
 */
export class RestoreCompanyTool implements ToolDefinition<
  typeof restoreCompanyInputSchema,
  RestoreResult
> {
  readonly name = 'hubspot_restore_company';
  readonly title = 'Restore Archived HubSpot Company';
  readonly description =
    'Recover an archived (deleted) HubSpot company. IMPORTANT: HubSpot provides no API to ' +
    'un-archive a record in place, so this reads the archived company and recreates it as a ' +
    'NEW company with a NEW record ID. Property values are copied; associations, notes, tasks, ' +
    'calls, meetings, emails, and timeline history are NOT recovered, and the original ID is ' +
    'not reused. Only works within 90 days of archiving. For a true in-place restore that keeps ' +
    'the original ID and all history, the user must use the HubSpot UI recycle bin. Requires ' +
    'confirmRecreate to be exactly true.';

  readonly inputSchema = restoreCompanyInputSchema;
  readonly outputSchema = restoreOutputSchema;

  readonly annotations = {
    title: 'Restore Archived HubSpot Company',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: RestoreCompanyInput, context: ToolExecutionContext): Promise<RestoreResult> {
    context.logger.warn(
      { archivedCompanyId: input.companyId },
      'Recreating archived company as a new record.'
    );

    const { created, sourceProperties } = await this.companies.recreateFromArchive({
      companyId: input.companyId,
      properties: input.properties,
    });

    return {
      success: true,
      restoredAsNewRecord: true,
      originalCompanyId: input.companyId,
      newCompanyId: created.id,
      propertiesCopied: Object.keys(created.properties).filter(
        (key) => created.properties[key] !== null
      ).length,
      notRestored: [
        'The original record ID (the new company has a different ID)',
        'Associations to contacts, deals, and tickets',
        'Notes, tasks, calls, meetings, and logged emails',
        'Timeline and activity history',
      ],
      message:
        `Archived company ${input.companyId} was recreated as NEW company ${created.id} with ` +
        `${Object.keys(sourceProperties).length} source properties read. HubSpot has no ` +
        'un-archive API, so this is a new record: associations and all activity history were ' +
        'not recovered.',
    };
  }
}
