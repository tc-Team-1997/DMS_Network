export function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function cardUid(): string {
  return Math.random().toString(36).slice(2, 10);
}
