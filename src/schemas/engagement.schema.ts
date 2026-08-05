import { z } from 'zod';
import { contactIdSchema } from './contact.schema.js';

/**
 * Zod contracts for engagements logged against a contact: notes, tasks, calls,
 * meetings, and emails.
 *
 * `hs_timestamp` is required by HubSpot on every engagement — it determines
 * where the record lands on the CRM timeline. Rather than force an agent to
 * produce a Unix millisecond value, each schema accepts an optional ISO 8601
 * string and defaults to "now", which is what "log a call I just had" means.
 */

/** ISO 8601 timestamp, validated so a malformed date fails locally rather than at HubSpot. */
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

export const createNoteInputSchema = z.object({
  contactId: contactIdSchema,
  body: z
    .string()
    .trim()
    .min(1, 'Note body must not be empty.')
    .max(65_536, 'HubSpot limits note bodies to 65,536 characters.')
    .describe('The note text. Supports basic HTML. Maximum 65,536 characters.'),
  timestamp: timestampSchema,
  ownerId: ownerIdSchema,
});

export const createTaskInputSchema = z.object({
  contactId: contactIdSchema,
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

export const logCallInputSchema = z.object({
  contactId: contactIdSchema,
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

export const createMeetingInputSchema = z
  .object({
    contactId: contactIdSchema,
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
  })
  .refine((input) => Date.parse(input.endTime) > Date.parse(input.startTime), {
    message: 'endTime must be after startTime.',
    path: ['endTime'],
  });

export const logEmailInputSchema = z.object({
  contactId: contactIdSchema,
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

export const getTimelineInputSchema = z.object({
  contactId: contactIdSchema,
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

export const engagementOutputSchema = z.object({
  success: z.boolean(),
  engagementId: z.string().describe('The ID of the created engagement record.'),
  engagementType: z.string(),
  contactId: z.string(),
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
  contactId: z.string(),
  entries: z.array(timelineEntryOutputSchema),
  count: z.number(),
  countsByType: z.record(z.string(), z.number()),
  truncated: z
    .boolean()
    .describe(
      'True when at least one activity type returned the maximum requested, meaning more exist.'
    ),
});

export type CreateNoteInput = z.output<typeof createNoteInputSchema>;
export type CreateTaskInput = z.output<typeof createTaskInputSchema>;
export type LogCallInput = z.output<typeof logCallInputSchema>;
export type CreateMeetingInput = z.output<typeof createMeetingInputSchema>;
export type LogEmailInput = z.output<typeof logEmailInputSchema>;
export type GetTimelineInput = z.output<typeof getTimelineInputSchema>;
