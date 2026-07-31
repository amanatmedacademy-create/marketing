import { z } from 'zod';

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().email().optional(),
  companyName: z.string().trim().max(150).optional(),
  source: z.string().trim().max(120).optional(),
});
