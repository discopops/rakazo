import { loadRootEnv } from "../packages/core/src/node/load-root-env.ts";
import { createDb } from "../packages/db/src/client.ts";
loadRootEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not configured");
const { prisma, pool } = createDb(url,{ poolMax: 1, applicationName:"chief-tool-audit" });
try {
  const botId = "cmvd39u5h000329hs1rag5n3c";
  const runId = "cmvdbvvq000063uhsscgrcz0m";
  const bot = await prisma.bot.findUniqueOrThrow({where:{id:botId},select:{name:true,instructions:true}});
  const run=await prisma.run.findUniqueOrThrow({where:{id:runId},select:{status:true,startedAt:true,completedAt:true,createdAt:true,modelProvider:true,modelId:true,error:true}});
  console.log("BOT",bot.name,"INSTRUCTIONS_LENGTH",bot.instructions.length);
  console.log("INSTRUCTIONS_GMAIL_RELEVANT",bot.instructions.split("\n").filter(s=>/gmail|email|composio|tool|inbox|thread|search|efficien|parallel|batch/i.test(s)).slice(0,45).join("\n").slice(0,5500));
  console.log("RUN",JSON.stringify(run));
  const ev=await prisma.event.findMany({where:{runId},orderBy:{seq:"asc"},select:{type:true,seq:true,createdAt:true,payload:true}});
  for(const e of ev) {
    if (e.type.startsWith("agent.tool.")) {
      const p=e.payload as Record<string, unknown> ?? {};
      console.log("TOOL",e.seq,e.createdAt.toISOString(),e.type,JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>/^(name|executionId|durationMs|outcome|error|code|status|success|resultType|resultSummary)$/.test(k)))));
    } else if (/run\.|agent\.error/.test(e.type)) {
      console.log("RUN_EVENT",e.seq,e.createdAt.toISOString(),e.type);
    }
  }
} finally { await prisma.$disconnect(); await pool.end(); }
