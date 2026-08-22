import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const ConfigSchema = Type.Object(
  {
    hostname: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    databaseUrl: Type.String({ pattern: "^postgres(ql)?://" }),
    internalToken: Type.String({ minLength: 32 }),
  },
  { additionalProperties: false },
);

export type DataSourceConfig = Static<typeof ConfigSchema>;

export function loadDataSourceConfig(
  env: Record<string, string | undefined> = Bun.env,
): DataSourceConfig {
  const value = {
    hostname: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 8081),
    databaseUrl: env.DATA_SOURCE_DATABASE_URL ?? env.DATABASE_URL ?? "",
    internalToken: env.DATA_SOURCE_INTERNAL_TOKEN ?? "",
  };
  if (!Value.Check(ConfigSchema, value)) {
    const errors = [...Value.Errors(ConfigSchema, value)]
      .map(({ path, message }) => `${path || "/"} ${message}`)
      .join("; ");
    throw new Error(`Invalid Data Source configuration: ${errors}`);
  }
  return value;
}
