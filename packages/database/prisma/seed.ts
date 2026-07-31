import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@imds.local';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe123!';
  const companySlug = process.env.SEED_COMPANY_SLUG ?? 'imds-demo';

  const passwordHash = await argon2.hash(password);
  const company = await prisma.company.upsert({
    where: { slug: companySlug },
    update: {},
    create: {
      name: process.env.SEED_COMPANY_NAME ?? 'IMDS Demo',
      slug: companySlug,
      timezone: 'Asia/Almaty',
      locale: 'ru',
      currency: 'KZT',
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, status: UserStatus.ACTIVE },
    create: {
      email,
      passwordHash,
      firstName: 'Demo',
      lastName: 'Owner',
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    update: { role: UserRole.OWNER },
    create: { companyId: company.id, userId: user.id, role: UserRole.OWNER },
  });

  console.log(`Seed complete: ${email} / ${password}`);
}

main()
  .finally(async () => prisma.$disconnect());
