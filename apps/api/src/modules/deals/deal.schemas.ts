import { z } from 'zod';

export const createDealSchema = z.object({
  pipelineId: z.string().cuid(),
  stageId: z.string().cuid(),
  contactId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  title: z.string().trim().min(1).max(180),
  phone: z.string().trim().max(40).optional(),
  email: z.string().email().optional(),
  source: z.string().trim().max(120).optional(),
  oneTimeAmount: z.coerce.number().min(0).default(0),
  recurringAmount: z.coerce.number().min(0).default(0),
});

export const moveDealSchema = z.object({
  targetStageId: z.string().cuid(),
  beforeDealId: z.string().cuid().optional(),
  afterDealId: z.string().cuid().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});
