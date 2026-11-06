import { readFileSync } from "node:fs";
import { createDb } from "../packages/db/src/client.ts";
import { createRepos } from "../packages/db/src/repos.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing database configuration");
const { prisma, pool } = createDb(url, { poolMax: 1 });
try {
  const chiefs = await prisma.bot.findMany({ where: { name: "Chief", archivedAt: null } });
  if (chiefs.length !== 1) throw new Error("Expected exactly one existing Chief bot");
  const chief = chiefs[0];
  const actor = { spaceId: chief.spaceId, userId: chief.userId };
  const repos = createRepos(prisma);
  const existing = await prisma.bot.findMany({
    where: { spaceId: actor.spaceId, userId: actor.userId, name: "Responder", archivedAt: null },
  });
  if (existing.length > 1) throw new Error("Duplicate Responder agents: refusing");
  if (existing.length === 1) {
    console.log("Existing Responder bot:", existing[0].id);
  } else {
    const instructions = readFileSync(
      "/Users/imac/Documents/Rakazo-Agents/Responder/AGENT.md",
      "utf8",
    );
    const bot = await repos.createBot(actor, {
      name: "Responder",
      title: "Chief Mail — Gmail response assistant",
      description: "Draft-only email triage and voice discussions; monitoring not yet active",
      instructions,
      notifyOnFinish: true,
      computerMode: "team",
      spawnKey: "responder-draft-only-v1",
      modelProvider: chief.modelProvider,
      modelId: chief.modelId,
      thinkingLevel: chief.thinkingLevel,
      disabledBuiltinTools: chief.disabledBuiltinTools,
    });
    console.log("Created Responder bot:", bot.id);
  }
} finally {
  await prisma.$disconnect();
  await pool.end();
}
