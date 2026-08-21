import type { RedisClient, SQL } from "bun";

const stream = "mda:agent-jobs";

export async function dispatchAgentJobs(
  db: SQL,
  redis: RedisClient,
  limit = 100,
): Promise<number> {
  const rows = await db`
    SELECT id, tenant_id, payload
    FROM control_outbox
    WHERE delivered_at IS NULL AND event_type = 'agent.job-queued'
    ORDER BY occurred_at
    LIMIT ${limit}
  `;
  let delivered = 0;
  for (const row of rows) {
    const payload =
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    await redis.send("XADD", [
      stream,
      "*",
      "jobId",
      String(payload.data.jobId),
      "tenantId",
      String(row.tenant_id),
      "attempt",
      String(payload.data.attempt),
    ]);
    const updated = await db`
      UPDATE control_outbox
      SET delivered_at = now(), attempts = attempts + 1
      WHERE id = ${String(row.id)} AND delivered_at IS NULL
      RETURNING id
    `;
    delivered += updated.length;
  }
  return delivered;
}

export function startAgentJobDispatcher(
  db: SQL,
  redis: RedisClient,
): () => void {
  const controller = new AbortController();
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const delivered = await dispatchAgentJobs(db, redis);
        if (delivered === 0) await Bun.sleep(250);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "agent.dispatch.failed",
            error: String(error),
          }),
        );
        await Bun.sleep(1_000);
      }
    }
  })();
  return () => controller.abort();
}
