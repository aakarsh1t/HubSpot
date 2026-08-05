import { describe, expect, it } from 'vitest';
import {
  createMeetingInputSchema,
  createNoteInputSchema,
  createTaskInputSchema,
  logCallInputSchema,
  logEmailInputSchema,
} from '../schemas/engagement.schema.js';

describe('createNoteInputSchema', () => {
  it('accepts a minimal note', () => {
    expect(createNoteInputSchema.safeParse({ contactId: '512', body: 'hi' }).success).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(createNoteInputSchema.safeParse({ contactId: '512', body: '' }).success).toBe(false);
  });

  it('enforces the 65,536 character HubSpot limit', () => {
    const result = createNoteInputSchema.safeParse({
      contactId: '512',
      body: 'x'.repeat(65_537),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed timestamp', () => {
    const result = createNoteInputSchema.safeParse({
      contactId: '512',
      body: 'hi',
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric owner id', () => {
    const result = createNoteInputSchema.safeParse({
      contactId: '512',
      body: 'hi',
      ownerId: 'not-numeric',
    });
    expect(result.success).toBe(false);
  });
});

describe('createTaskInputSchema', () => {
  it('defaults status, priority, and type', () => {
    const result = createTaskInputSchema.safeParse({ contactId: '512', subject: 'Follow up' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        status: 'NOT_STARTED',
        priority: 'MEDIUM',
        taskType: 'TODO',
      });
    }
  });

  it('rejects a status HubSpot does not accept', () => {
    const result = createTaskInputSchema.safeParse({
      contactId: '512',
      subject: 'x',
      status: 'IN_PROGRESS',
    });
    expect(result.success).toBe(false);
  });
});

describe('logCallInputSchema', () => {
  it('accepts a call with a millisecond duration', () => {
    const result = logCallInputSchema.safeParse({
      contactId: '512',
      title: 'Discovery',
      durationMs: 1_800_000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative duration', () => {
    const result = logCallInputSchema.safeParse({
      contactId: '512',
      title: 'x',
      durationMs: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a status outside HubSpot's enum", () => {
    const result = logCallInputSchema.safeParse({
      contactId: '512',
      title: 'x',
      status: 'ANSWERED',
    });
    expect(result.success).toBe(false);
  });
});

describe('createMeetingInputSchema', () => {
  const base = {
    contactId: '512',
    title: 'Planning',
    startTime: '2026-08-12T14:00:00Z',
    endTime: '2026-08-12T15:00:00Z',
  };

  it('accepts a valid time range', () => {
    expect(createMeetingInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects endTime before startTime', () => {
    const result = createMeetingInputSchema.safeParse({
      ...base,
      startTime: '2026-08-12T15:00:00Z',
      endTime: '2026-08-12T14:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects endTime equal to startTime', () => {
    const result = createMeetingInputSchema.safeParse({ ...base, endTime: base.startTime });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date string', () => {
    const result = createMeetingInputSchema.safeParse({ ...base, startTime: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

describe('logEmailInputSchema', () => {
  it('defaults direction to EMAIL and status to SENT', () => {
    const result = logEmailInputSchema.safeParse({
      contactId: '512',
      subject: 'Hi',
      body: 'Body text',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.direction).toBe('EMAIL');
      expect(result.data.status).toBe('SENT');
    }
  });

  it('rejects a direction HubSpot does not define', () => {
    const result = logEmailInputSchema.safeParse({
      contactId: '512',
      subject: 'Hi',
      body: 'x',
      direction: 'OUTGOING',
    });
    expect(result.success).toBe(false);
  });
});
