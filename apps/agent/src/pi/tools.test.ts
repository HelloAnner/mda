import { expect, test } from "bun:test";
import type { QueryResult } from "@mda/contracts";
import { querySampleResult } from "./tools.ts";

test("bounds Query samples while preserving complete result metadata", () => {
  const value: QueryResult = {
    rows: Array.from({ length: 100 }, (_, index) => ({
      index,
      label: `row-${index}`,
    })),
    meta: {
      columns: [
        { name: "index", type: "integer", nullable: false },
        { name: "label", type: "string", nullable: false },
      ],
      rowCount: 100,
      truncated: false,
      durationMs: 4,
      fetchedAt: "2026-08-23T00:00:00.000Z",
      cache: { hit: false },
    },
  };

  const result = querySampleResult(value);
  expect(result).toContain('"includedRows": 25');
  expect(result).toContain('"omittedRows": 75');
  expect(result).toContain('"rowCount": 100');
  expect(result).not.toContain('"label": "row-25"');
});
