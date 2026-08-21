import type { RedisClient } from "bun";

const stream = "mda:agent-jobs";
const group = "mda-agents";

export interface AgentQueueEntry {
  id: string;
  jobId: string;
}

export async function ensureAgentGroup(redis: RedisClient): Promise<void> {
  try {
    await redis.send("XGROUP", ["CREATE", stream, group, "0", "MKSTREAM"]);
  } catch (error) {
    if (!String(error).includes("BUSYGROUP")) throw error;
  }
}

export async function readAgentJob(
  redis: RedisClient,
  consumerId: string,
): Promise<AgentQueueEntry | undefined> {
  const response = (await redis.send("XREADGROUP", [
    "GROUP",
    group,
    consumerId,
    "COUNT",
    "1",
    "BLOCK",
    "5000",
    "STREAMS",
    stream,
    ">",
  ])) as unknown;
  return parseAgentJobResponse(response);
}

export function parseAgentJobResponse(
  response: unknown,
): AgentQueueEntry | undefined {
  if (response === null || response === undefined) return undefined;
  const messages = Array.isArray(response)
    ? Array.isArray(response[0])
      ? response[0][1]
      : undefined
    : typeof response === "object"
      ? (response as Record<string, unknown>)[stream]
      : undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Unexpected Redis Stream response");
  }
  const message = messages[0];
  if (!Array.isArray(message) || !Array.isArray(message[1])) {
    throw new Error("Unexpected Redis Stream entry");
  }
  const fields = message[1] as string[];
  const jobIndex = fields.indexOf("jobId");
  if (jobIndex < 0 || !fields[jobIndex + 1]) {
    throw new Error("Redis Stream entry has no jobId");
  }
  return { id: String(message[0]), jobId: String(fields[jobIndex + 1]) };
}

export async function acknowledgeAgentJob(
  redis: RedisClient,
  entryId: string,
): Promise<void> {
  await redis.send("XACK", [stream, group, entryId]);
}
