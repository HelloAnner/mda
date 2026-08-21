import { SQL } from "bun";

export function createDatabase(databaseUrl: string): SQL {
  return new SQL(databaseUrl, { max: 10 });
}
