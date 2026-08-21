import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";

export async function migrate(
  databaseUrl: string,
  directory = new URL("../../../migrations/control-plane/", import.meta.url)
    .pathname,
): Promise<void> {
  const db = new SQL(databaseUrl);
  try {
    await db`
      CREATE TABLE IF NOT EXISTS control_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(directory))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const applied = await db`
        SELECT 1 FROM control_schema_migrations WHERE name = ${name}
      `;
      if (applied.length > 0) continue;

      const sql = await Bun.file(join(directory, name)).text();
      await db.begin(async (transaction) => {
        await transaction.unsafe(sql);
        await transaction`
          INSERT INTO control_schema_migrations (name) VALUES (${name})
        `;
      });
      console.log(`Applied ${name}`);
    }
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  await migrate(databaseUrl);
}
