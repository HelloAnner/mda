import { expect, test } from "bun:test";
import { ConnectorRegistry } from "./connector.ts";
import { createHttpConnector } from "./http.ts";

const config = {
  baseUrl: "https://example.com",
  timeoutMs: 2_000,
  maxResponseBytes: 100_000,
};
const query = {
  operation: {
    method: "GET" as const,
    path: "/rows",
    rowsPointer: "/rows",
    readOnly: true as const,
  },
  parameters: [],
  columns: [],
};

test("registry is the only connector selection boundary", async () => {
  let released: string | undefined;
  const connector = {
    ...createHttpConnector("/run/secrets"),
    release(sourceId: string) {
      released = sourceId;
      return Promise.resolve();
    },
  };
  const registry = new ConnectorRegistry([connector]);

  expect(registry.validateConfig("http", config)).toEqual(config);
  expect(registry.capabilities("http").snapshotRead).toBe("native");
  await registry.release("http", "source_http");
  expect(released).toBe("source_http");
  await expect(
    registry.readChanges("http", {
      sourceId: "source_http",
      config,
      query,
      parameters: {},
    }),
  ).rejects.toThrow(
    "CONNECTOR_CAPABILITY_UNSUPPORTED: http does not support incremental reads",
  );
});

test("registry rejects ambiguous and dishonest registrations", () => {
  const connector = createHttpConnector("/run/secrets");
  expect(() => new ConnectorRegistry([connector, connector])).toThrow(
    "Duplicate Data Source connector: http",
  );
  expect(
    () =>
      new ConnectorRegistry([
        {
          ...connector,
          capabilities: {
            ...connector.capabilities,
            incrementalRead: "native",
          },
        },
      ]),
  ).toThrow(
    "Connector http advertises incremental reads without implementing them",
  );
});
