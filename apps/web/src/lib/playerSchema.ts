import { z } from 'zod';

export const HANDICAP_SOURCES = ['GHIN', 'TheGrint', '18Birdies', 'Other'] as const;

export const playerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name required'),
  email: z.string().trim().toLowerCase().email('Valid email required'),
  handicapIndex: z.number().min(-10, 'Index must be -10.0 to 54.0').max(54, 'Index must be -10.0 to 54.0'),
  handicapSource: z.enum(HANDICAP_SOURCES),
  isCommissioner: z.boolean(),
});
export type PlayerInput = z.infer<typeof playerSchema>;

export const handicapUpdatesSchema = z.array(
  z.object({
    playerId: z.string().uuid(),
    index: z.number().min(-10).max(54),
  }),
);
