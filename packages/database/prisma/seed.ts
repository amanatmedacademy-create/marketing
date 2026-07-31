import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('Demo12345!', { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: 'owner@demo.kz' },
    update: {},
    create: { email: 'owner@demo.kz', passwordHash, firstName: 'Demo', lastName: 'Owner', locale: 'RU' },
  });
  const company = await prisma.company.upsert({
    where: { slug: 'demo-company-kz' },
    update: {},
    create: { name: 'Demo Company KZ', slug: 'demo-company-kz', timezone: 'Asia/Almaty', locale: 'RU' },
  });
  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: { companyId: company.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
  });
  console.log('Seed complete: owner@demo.kz / Demo12345!');
}

main().finally(() => prisma.$disconnect());
