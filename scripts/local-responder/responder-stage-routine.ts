import { createDb } from "../packages/db/src/client.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing database configuration");
const { prisma, pool } = createDb(url, { poolMax: 1 });
try {
  const bot = await prisma.bot.findFirstOrThrow({ where: { name: "Responder", archivedAt: null } });
  const name = "Chief Mail — hourly inbox review";
  const existing = await prisma.routine.findMany({ where: { botId: bot.id, name } });
  if (existing.length > 1) throw new Error("Duplicate routines; refusing");
  if (existing.length === 0) {
    const row = await prisma.routine.create({
      data: {
        spaceId: bot.spaceId,
        userId: bot.userId,
        botId: bot.id,
        name,
        crons: ["0 * * * *"],
        timezone: "Australia/Brisbane",
        active: false,
        notify: true,
        prompt:
          "Run the Chief Mail Gmail index incremental review. Only actionable human emails needing replies qualify. Exclude marketing/newsletters and spam. Do not send, modify, archive or mark messages read. Deduplicate by incoming Gmail message ID. Queue outside 08:00–20:00 Brisbane time. During contact hours offer a Rakazo mobile voice discussion. Only after explicit approval of exact recipients and text may you save a Gmail draft, never send. Do not claim the mobile call or monitoring is working unless independently verified.",
        modelProvider: bot.modelProvider,
        modelId: bot.modelId,
        thinkingLevel: bot.thinkingLevel,
      },
    });
    console.log("Staged inactive routine:", row.id);
  } else console.log("Existing routine:", existing[0].id, "active:", existing[0].active);
} finally {
  await prisma.$disconnect();
  await pool.end();
}
