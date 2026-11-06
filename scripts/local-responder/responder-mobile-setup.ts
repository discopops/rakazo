import { createDb } from "../packages/db/src/client.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL");
const { prisma, pool } = createDb(url, { poolMax: 1 });
try {
  const matches = await prisma.bot.findMany({ where: { name: "Responder", archivedAt: null } });
  if (matches.length !== 1) throw new Error("Expected exactly one Responder");
  const bot = matches[0];
  const updated = await prisma.bot.update({
    where: { id: bot.id },
    data: {
      pinned: true,
      title: "Chief Mail",
      description: "Gmail replies • discuss by voice • save approved drafts only",
      notifyOnFinish: true,
    },
  });
  console.log(
    JSON.stringify(
      {
        id: updated.id,
        name: updated.name,
        pinned: updated.pinned,
        title: updated.title,
        description: updated.description,
        notifyOnFinish: updated.notifyOnFinish,
        voiceId: updated.voiceId,
        autoSpeak: updated.autoSpeak,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
  await pool.end();
}
