import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";

export async function migrateDataSource(databaseUrl: string): Promise<void> {
  const db = new SQL(databaseUrl, { max: 1 });
  try {
    await db`
      CREATE TABLE IF NOT EXISTS data_source_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const directory = join(process.cwd(), "migrations", "data-source");
    const names = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    for (const name of names) {
      const applied = await db`
        SELECT 1 FROM data_source_schema_migrations WHERE name = ${name}
      `;
      if (applied.length) continue;
      const sql = await Bun.file(join(directory, name)).text();
      await db.begin(async (transaction) => {
        await transaction.unsafe(sql);
        await transaction`
          INSERT INTO data_source_schema_migrations (name) VALUES (${name})
        `;
      });
    }
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  const databaseUrl = Bun.env.DATA_SOURCE_DATABASE_URL ?? Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATA_SOURCE_DATABASE_URL is required");
  await migrateDataSource(databaseUrl);
}
