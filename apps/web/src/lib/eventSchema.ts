import { z } from 'zod';
import { EVENT_TYPES } from '@/lib/eventStatus';

export const roundSchema = z.object({
  roundNumber: z.number().int().min(1, 'Round number must be at least 1'),
  teeId: z.string().uuid('Choose a tee for every round'),
  playDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Play date must be YYYY-MM-DD').nullable(),
  kind: z.enum(['stroke', 'match']),
});

export const eventSchema = z
  .object({
    id: z.string().uuid().optional(),
    seasonId: z.string().uuid('Choose a season'),
    name: z.string().trim().min(1, 'Event name required'),
    eventType: z.enum(EVENT_TYPES),
    format: z.enum(['stroke', 'match_play']),
    handicapMode: z.enum(['gross', 'net']),
    allowancePct: z.number().int().min(0, 'Allowance must be 0-100').max(100, 'Allowance must be 0-100'),
    handicapBasis: z.enum(['index', 'course']).default('index'),
    matchStrokes: z.enum(['full', 'offLow']),
    registrationDeadline: z.string().min(1, 'Registration deadline required'),
    rounds: z.array(roundSchema).min(1, 'An event needs at least one round'),
  })
  .superRefine((e, ctx) => {
    const nums = e.rounds.map((r) => r.roundNumber);
    if (new Set(nums).size !== nums.length) {
      ctx.addIssue({ code: 'custom', path: ['rounds'], message: 'Round numbers must be unique' });
    }
    if (Number.isNaN(Date.parse(e.registrationDeadline))) {
      ctx.addIssue({ code: 'custom', path: ['registrationDeadline'], message: 'Invalid registration deadline' });
    }
  });

export type EventInput = z.input<typeof eventSchema>;
export type EventParsed = z.output<typeof eventSchema>;
