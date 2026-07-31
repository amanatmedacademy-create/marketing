import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  companyName: z.string().min(2).max(150),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const switchCompanySchema = z.object({
  companyId: z.string().cuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
