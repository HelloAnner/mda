function splitTarPath(path: string): { name: string; prefix: string } {
  const encoded = Buffer.from(path);
  if (encoded.byteLength <= 100) return { name: path, prefix: "" };
  const segments = path.split("/");
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join("/");
    const name = segments.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error("Artifact path is too long for tar export");
}

export function assertTarPath(path: string): void {
  splitTarPath(path);
}

function writeBytes(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) throw new Error("Tar header field overflow");
  target.set(bytes, offset);
}

function writeOctal(
  target: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  writeBytes(
    target,
    offset,
    length,
    `${value.toString(8).padStart(length - 1, "0")}\0`,
  );
}

function tarHeader(file: {
  path: string;
  bytes: Uint8Array;
  executable: boolean;
}): Uint8Array {
  const header = new Uint8Array(512);
  const path = splitTarPath(file.path);
  writeBytes(header, 0, 100, path.name);
  writeOctal(header, 100, 8, file.executable ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, file.bytes.byteLength);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeBytes(header, 257, 6, "ustar\0");
  writeBytes(header, 263, 2, "00");
  writeBytes(header, 345, 155, path.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeBytes(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function createTarGzip(
  files: Array<{ path: string; bytes: Uint8Array; executable: boolean }>,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 1_024;
  for (const file of files) {
    chunks.push(tarHeader(file), file.bytes);
    const padding = (512 - (file.bytes.byteLength % 512)) % 512;
    if (padding) chunks.push(new Uint8Array(padding));
    size += 512 + file.bytes.byteLength + padding;
  }
  chunks.push(new Uint8Array(1_024));
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Bun.gzipSync(tar, { level: 6 });
}
