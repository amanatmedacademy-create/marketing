import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(150),
  timezone: z.string().trim().min(1).max(100).default('Asia/Almaty'),
  locale: z.enum(['KK', 'RU', 'EN']).default('RU'),
});

export const switchCompanySchema = z.object({
  companyId: z.string().cuid(),
});
