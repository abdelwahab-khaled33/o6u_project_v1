import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_PERMISSIONS, PERMISSION_KEYS, ROLES } from '@exam/shared';

const prisma = new PrismaClient();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123';

async function main() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {},
    create: {
      username: ADMIN_USERNAME,
      password_hash: hash,
      full_name: 'Platform Administrator',
      role: Role.admin,
      can_change_password: true,
    },
  });
  console.log(`Seeded admin user: ${admin.username}`);

  for (const role of ROLES) {
    for (const key of PERMISSION_KEYS) {
      await prisma.permission.upsert({
        where: { role_permission_key: { role, permission_key: key } },
        update: { allowed: DEFAULT_PERMISSIONS[key].includes(role) },
        create: { role, permission_key: key, allowed: DEFAULT_PERMISSIONS[key].includes(role) },
      });
    }
  }
  console.log('Seeded default permission matrix.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
