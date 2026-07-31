import { z } from 'zod';

export const createPipelineSchema = z.object({
  name: z.string().trim().min(2).max(120),
  isDefault: z.boolean().default(false),
});

export const createStageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  probability: z.number().int().min(0).max(100).default(0),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  countAsIncome: z.boolean().default(false),
});
