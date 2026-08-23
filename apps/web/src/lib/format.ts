export function relativeTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576)
    return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function jobDuration(job: {
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}): number {
  return Math.max(
    0,
    new Date(job.finishedAt ?? new Date()).getTime() -
      new Date(job.startedAt ?? job.createdAt).getTime(),
  );
}

export function shortId(value: string): string {
  const parts = value.split("_");
  const tail = parts.at(-1) ?? value;
  return tail.length > 9 ? `${tail.slice(0, 8)}…` : tail;
}

export function safeFilename(value: string): string {
  const printable = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? "-" : character,
  ).join("");
  const cleaned = printable.replace(/[\\/:*?"<>|]/g, "-").trim();
  return cleaned || "download";
}

export async function downloadResponse(
  response: Response,
  fallbackName: string,
): Promise<void> {
  const disposition = response.headers.get("content-disposition") ?? "";
  const headerName = disposition.match(/filename="([^"]+)"/)?.[1];
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(headerName ?? fallbackName);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
