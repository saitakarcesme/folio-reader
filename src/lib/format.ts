export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getFullYear() === new Date().getFullYear()
      ? undefined
      : "numeric",
  }).format(timestamp);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function nameFromFile(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").trim() || "Untitled document";
}
