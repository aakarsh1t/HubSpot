import { z } from 'zod';

/**
 * Zod contracts for engagements logged against a CRM record: notes, tasks,
 * calls, meetings, and emails.
 *
 * The schema *body* (subject, status, priority, timestamp, …) is identical
 * whether the engagement is logged against a contact, a company, or a deal —
 * only the ID field's name and description differ, because an agent is far
 * more likely to correctly populate a field literally named `contactId` on a
 * tool called `hubspot_create_contact_note` than a generic `objectId` it has
 * to infer applies.
 *
 * Each engagement type is therefore defined once as a `*BodySchema` (no ID
 * field — this is also exactly the shape `EngagementsService` accepts, since
 * the service takes the target object type and ID as separate arguments).
 * Each module's full input schema then spreads that body alongside its own
 * `idField(...)`, and — for meetings — `withEndAfterStart` reapplies the
 * cross-field check, which cannot itself be spread since a refinement is not
 * part of an object's shape.
 *
 * `hs_timestamp` is required by HubSpot on every engagement — it determines
 * where the record lands on the CRM timeline. Rather than force an agent to
 * produce a Unix millisecond value, each schema accepts an optional ISO 8601
 * string and defaults to "now", which is what "log a call I just had" means.
 */

const timestampSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO 8601 date-time, e.g. "2026-08-05T14:30:00Z".',
  })
  .optional()
  .describe('ISO 8601 date-time for the timeline entry. Defaults to now.');

const ownerIdSchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, 'HubSpot owner IDs are numeric.')
  .optional()
  .describe('HubSpot owner (user) ID to attribute this activity to.');

const RECORD_ID_PATTERN = /^\d+$/u;

/** Builds a validated numeric-ID field named and described for one object noun. */
function idField(noun: string) {
  return z
    .string()
    .trim()
    .min(1, 'Record ID must not be empty.')
    .regex(RECORD_ID_PATTERN, `A HubSpot ${noun} ID is numeric, e.g. "512".`)
    .describe(`The numeric HubSpot ${noun} record ID this activity is logged against.`);
}

// ------------------------------------------------------------------- bodies

export const noteBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Note body must not be empty.')
    .max(65_536, 'HubSpot limits note bodies to 65,536 characters.')
    .describe('The note text. Supports basic HTML. Maximum 65,536 characters.'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

export const taskBodySchema = z.object({
  subject: z.string().trim().min(1).max(500).describe('Task title, e.g. "Follow up on pricing".'),
  body: z.string().trim().max(65_536).optional().describe('Task notes / detail.'),
  status: z
    .enum(['NOT_STARTED', 'COMPLETED'])
    .default('NOT_STARTED')
    .describe('Task status. HubSpot accepts NOT_STARTED or COMPLETED.'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM').describe('Task priority.'),
  taskType: z
    .enum(['EMAIL', 'CALL', 'TODO'])
    .default('TODO')
    .describe('The kind of task, which controls its icon and filtering in HubSpot.'),
  dueDate: timestampSchema.describe(
    'ISO 8601 due date for the task (maps to hs_timestamp). Defaults to now.'
  ),
  ownerId: ownerIdSchema,
});

export const callBodySchema = z.object({
  title: z.string().trim().min(1).max(500).describe('Call title, e.g. "Discovery call".'),
  body: z.string().trim().max(65_536).optional().describe('Call notes.'),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(86_400_000)
    .optional()
    .describe('Call duration in milliseconds. HubSpot stores durations in ms, not seconds.'),
  direction: z
    .enum(['INBOUND', 'OUTBOUND'])
    .default('OUTBOUND')
    .describe('Call direction from the CRM user perspective.'),
  status: z
    .enum([
      'BUSY',
      'CALLING_CRM_USER',
      'CANCELED',
      'COMPLETED',
      'CONNECTING',
      'FAILED',
      'IN_PROGRESS',
      'NO_ANSWER',
      'QUEUED',
      'RINGING',
    ])
    .default('COMPLETED')
    .describe('Call outcome status.'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

/**
 * Deliberately a plain object with no cross-field refinement: `.shape` must
 * stay available so each per-module schema below can spread it alongside
 * its own ID field. The `endTime > startTime` invariant is applied once per
 * module instead, after the ID field is added — see `withEndAfterStart`.
 */
export const meetingBodySchema = z.object({
  title: z.string().trim().min(1).max(500).describe('Meeting title.'),
  body: z.string().trim().max(65_536).optional().describe('Meeting description or agenda.'),
  startTime: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'Must be a valid ISO 8601 date-time.',
    })
    .describe('ISO 8601 meeting start time.'),
  endTime: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'Must be a valid ISO 8601 date-time.',
    })
    .describe('ISO 8601 meeting end time.'),
  location: z.string().trim().max(500).optional().describe('Physical or virtual location.'),
  outcome: z
    .enum(['SCHEDULED', 'COMPLETED', 'RESCHEDULED', 'NO_SHOW', 'CANCELED'])
    .default('SCHEDULED')
    .describe('Meeting outcome.'),
  ownerId: ownerIdSchema,
});

function withEndAfterStart<T extends z.ZodType<{ startTime: string; endTime: string }>>(schema: T) {
  return schema.refine((input) => Date.parse(input.endTime) > Date.parse(input.startTime), {
    message: 'endTime must be after startTime.',
    path: ['endTime'],
  });
}

export const emailBodySchema = z.object({
  subject: z.string().trim().min(1).max(998).describe('Email subject line.'),
  body: z.string().trim().max(65_536).describe('Plain-text email body.'),
  direction: z
    .enum(['EMAIL', 'INCOMING_EMAIL', 'FORWARDED_EMAIL'])
    .default('EMAIL')
    .describe(
      'EMAIL = sent from the CRM or logged via BCC; INCOMING_EMAIL = a reply received; ' +
        'FORWARDED_EMAIL = forwarded into the CRM.'
    ),
  status: z
    .enum(['BOUNCED', 'FAILED', 'SCHEDULED', 'SENDING', 'SENT'])
    .default('SENT')
    .describe('Send status of the logged email.'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

export const timelineOptionsSchema = z.object({
  types: z
    .array(z.enum(['notes', 'tasks', 'calls', 'meetings', 'emails']))
    .min(1)
    .max(5)
    .default(['notes', 'tasks', 'calls', 'meetings', 'emails'])
    .describe('Activity types to include. Defaults to all five.'),
  limitPerType: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum activities to fetch per type before merging (1-100). Defaults to 20.'),
});

// -------------------------------------------------------------- contacts (default export set)

export const createNoteInputSchema = z.object({
  contactId: idField('contact'),
  ...noteBodySchema.shape,
});
export const createTaskInputSchema = z.object({
  contactId: idField('contact'),
  ...taskBodySchema.shape,
});
export const logCallInputSchema = z.object({
  contactId: idField('contact'),
  ...callBodySchema.shape,
});
export const createMeetingInputSchema = withEndAfterStart(
  z.object({ contactId: idField('contact'), ...meetingBodySchema.shape })
);
export const logEmailInputSchema = z.object({
  contactId: idField('contact'),
  ...emailBodySchema.shape,
});
export const getTimelineInputSchema = z.object({
  contactId: idField('contact'),
  ...timelineOptionsSchema.shape,
});

// -------------------------------------------------------------------- companies

export const createCompanyNoteInputSchema = z.object({
  companyId: idField('company'),
  ...noteBodySchema.shape,
});
export const createCompanyTaskInputSchema = z.object({
  companyId: idField('company'),
  ...taskBodySchema.shape,
});
export const logCompanyCallInputSchema = z.object({
  companyId: idField('company'),
  ...callBodySchema.shape,
});
export const createCompanyMeetingInputSchema = withEndAfterStart(
  z.object({ companyId: idField('company'), ...meetingBodySchema.shape })
);
export const logCompanyEmailInputSchema = z.object({
  companyId: idField('company'),
  ...emailBodySchema.shape,
});
export const getCompanyTimelineInputSchema = z.object({
  companyId: idField('company'),
  ...timelineOptionsSchema.shape,
});

// ------------------------------------------------------------------------ deals

export const createDealNoteInputSchema = z.object({
  dealId: idField('deal'),
  ...noteBodySchema.shape,
});
export const createDealTaskInputSchema = z.object({
  dealId: idField('deal'),
  ...taskBodySchema.shape,
});
export const logDealCallInputSchema = z.object({
  dealId: idField('deal'),
  ...callBodySchema.shape,
});
export const createDealMeetingInputSchema = withEndAfterStart(
  z.object({ dealId: idField('deal'), ...meetingBodySchema.shape })
);
export const logDealEmailInputSchema = z.object({
  dealId: idField('deal'),
  ...emailBodySchema.shape,
});
export const getDealTimelineInputSchema = z.object({
  dealId: idField('deal'),
  ...timelineOptionsSchema.shape,
});

// -------------------------------------------------------------------- output

export const engagementOutputSchema = z.object({
  success: z.boolean(),
  engagementId: z.string().describe('The ID of the created engagement record.'),
  engagementType: z.string(),
  objectType: z.string().describe('The CRM object type this activity was logged against.'),
  objectId: z.string(),
  timestamp: z.string().nullable(),
  message: z.string(),
});

export const timelineEntryOutputSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  ownerId: z.string().nullable(),
  details: z.record(z.string(), z.string().nullable()),
});

export const timelineOutputSchema = z.object({
  objectId: z.string(),
  entries: z.array(timelineEntryOutputSchema),
  count: z.number(),
  countsByType: z.record(z.string(), z.number()),
  truncated: z
    .boolean()
    .describe(
      'True when at least one activity type returned the maximum requested, meaning more exist.'
    ),
});

// ---------------------------------------------------------------------- types

/** Body-only types, exactly what `EngagementsService` methods accept alongside `(objectType, objectId)`. */
export type NoteBody = z.output<typeof noteBodySchema>;
export type TaskBody = z.output<typeof taskBodySchema>;
export type CallBody = z.output<typeof callBodySchema>;
export type MeetingBody = z.output<typeof meetingBodySchema>;
export type EmailBody = z.output<typeof emailBodySchema>;
export type TimelineOptions = z.output<typeof timelineOptionsSchema>;

export type CreateNoteInput = z.output<typeof createNoteInputSchema>;
export type CreateTaskInput = z.output<typeof createTaskInputSchema>;
export type LogCallInput = z.output<typeof logCallInputSchema>;
export type CreateMeetingInput = z.output<typeof createMeetingInputSchema>;
export type LogEmailInput = z.output<typeof logEmailInputSchema>;
export type GetTimelineInput = z.output<typeof getTimelineInputSchema>;

export type CreateCompanyNoteInput = z.output<typeof createCompanyNoteInputSchema>;
export type CreateCompanyTaskInput = z.output<typeof createCompanyTaskInputSchema>;
export type LogCompanyCallInput = z.output<typeof logCompanyCallInputSchema>;
export type CreateCompanyMeetingInput = z.output<typeof createCompanyMeetingInputSchema>;
export type LogCompanyEmailInput = z.output<typeof logCompanyEmailInputSchema>;
export type GetCompanyTimelineInput = z.output<typeof getCompanyTimelineInputSchema>;

export type CreateDealNoteInput = z.output<typeof createDealNoteInputSchema>;
export type CreateDealTaskInput = z.output<typeof createDealTaskInputSchema>;
export type LogDealCallInput = z.output<typeof logDealCallInputSchema>;
export type CreateDealMeetingInput = z.output<typeof createDealMeetingInputSchema>;
export type LogDealEmailInput = z.output<typeof logDealEmailInputSchema>;
export type GetDealTimelineInput = z.output<typeof getDealTimelineInputSchema>;
