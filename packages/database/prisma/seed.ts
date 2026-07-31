import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const supabaseUserId = process.env.DEMO_SUPABASE_USER_ID;
  const email = process.env.DEMO_USER_EMAIL ?? 'owner@demo.kz';

  if (!supabaseUserId) {
    console.warn('Seed skipped: set DEMO_SUPABASE_USER_ID to an existing Supabase Auth user UUID.');
    return;
  }

  const user = await prisma.user.upsert({
    where: { supabaseUserId },
    update: { email },
    create: {
      supabaseUserId,
      email,
      firstName: 'Demo',
      lastName: 'Owner',
      locale: 'RU',
    },
  });

  const company = await prisma.company.upsert({
    where: { slug: 'demo-company-kz' },
    update: {},
    create: {
      name: 'Demo Company KZ',
      slug: 'demo-company-kz',
      timezone: 'Asia/Almaty',
      locale: 'RU',
    },
  });

  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: {
      companyId: company.id,
      userId: user.id,
      role: 'OWNER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  console.log(`Seed complete for ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
