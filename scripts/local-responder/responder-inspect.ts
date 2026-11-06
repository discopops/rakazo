import { createDb } from "../packages/db/src/client.ts";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL not configured");
const { prisma, pool } = createDb(dbUrl, { poolMax: 1 });
try {
  const spaces = await prisma.space.findMany({
    select: { id: true, name: true, memberships: { select: { userId: true } } },
  });
  const bots = await prisma.bot.findMany({
    select: { id: true, name: true, spaceId: true, userId: true, archivedAt: true },
  });
  console.log(
    JSON.stringify(
      {
        spaces: spaces.map((s) => ({ id: s.id, name: s.name, userCount: s.memberships.length })),
        bots: bots.map((b) => ({
          id: b.id,
          name: b.name,
          spaceId: b.spaceId,
          userId: b.userId,
          active: !b.archivedAt,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
  await pool.end();
}
