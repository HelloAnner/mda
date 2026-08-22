import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function resolveSecret(
  root: string,
  reference: string,
): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(reference)) {
    throw new Error("SECRET_ACCESS_DENIED: Invalid secret reference");
  }
  try {
    const value = (await readFile(join(root, reference), "utf8")).trimEnd();
    if (!value || value.length > 10_000 || /[\r\n]/.test(value)) {
      throw new Error("invalid");
    }
    return value;
  } catch {
    throw new Error("SECRET_NOT_FOUND: Data Source secret is unavailable");
  }
}
