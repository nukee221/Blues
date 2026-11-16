import { z } from 'zod';

export const holeSchema = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3, 'Hole par must be 3-6').max(6, 'Hole par must be 3-6'),
  strokeIndex: z.number().int().min(1).max(18),
});

export const teeSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, 'Tee name required'),
    rating: z.number().positive('Rating must be greater than 0'),
    slope: z.number().int().min(55, 'Slope must be 55-155').max(155, 'Slope must be 55-155'),
    par: z.number().int().positive(),
    holes: z.array(holeSchema).length(18, 'A tee needs exactly 18 holes'),
  })
  .superRefine((tee, ctx) => {
    const numbers = [...tee.holes.map((h) => h.number)].sort((a, b) => a - b);
    if (!numbers.every((n, i) => n === i + 1)) {
      ctx.addIssue({ code: 'custom', path: ['holes'], message: 'Holes must be numbered 1-18 once each' });
    }
    const sis = [...tee.holes.map((h) => h.strokeIndex)].sort((a, b) => a - b);
    if (!sis.every((n, i) => n === i + 1)) {
      ctx.addIssue({ code: 'custom', path: ['holes'], message: 'Stroke indexes must be 1-18 once each' });
    }
    const sum = tee.holes.reduce((s, h) => s + h.par, 0);
    if (sum !== tee.par) {
      ctx.addIssue({ code: 'custom', path: ['par'], message: `Hole pars sum to ${sum}, but tee par is ${tee.par}` });
    }
  });

export const courseSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Course name required'),
  tees: z.array(teeSchema),
});

export type CourseInput = z.infer<typeof courseSchema>;
