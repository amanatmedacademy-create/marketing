import { describe, expect, it } from 'vitest';
import { registerSchema } from '../src/modules/auth/auth.schemas.js';

describe('auth schemas', () => {
  it('accepts a valid Kazakhstan company registration payload', () => {
    const parsed = registerSchema.parse({
      email: 'owner@example.kz',
      password: 'StrongPass123!',
      firstName: 'Aman',
      companyName: 'Amanat CRM',
    });
    expect(parsed.email).toBe('owner@example.kz');
  });

  it('rejects weak passwords', () => {
    expect(() => registerSchema.parse({ email: 'a@b.kz', password: '123', firstName: 'A', companyName: 'CRM' })).toThrow();
  });
}
