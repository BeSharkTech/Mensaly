import {
  PrismaClient,
  UserRole,
  UserStatus,
  type User,
} from "@prisma/client";

type SeedEnvironment = {
  NODE_ENV?: string;
  SEED_PLATFORM_ADMIN_EMAIL?: string;
};

export async function seedPlatformAdmin(
  prisma: PrismaClient,
  environment: SeedEnvironment,
): Promise<User> {
  if (environment.NODE_ENV === "production") {
    throw new Error("The development seed cannot run in production.");
  }

  const email = environment.SEED_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();

  if (!email) {
    throw new Error("SEED_PLATFORM_ADMIN_EMAIL is required.");
  }

  return prisma.user.upsert({
    where: { email },
    update: {
      name: "Mensaly Platform Admin",
      role: UserRole.PLATFORM_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
    create: {
      name: "Mensaly Platform Admin",
      email,
      role: UserRole.PLATFORM_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });
}
