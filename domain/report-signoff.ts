export const analystClosureNoteMinLength = 24;
export const analystClosureNoteMaxLength = 600;

export function normalizeAnalystClosureNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length < analystClosureNoteMinLength ||
    normalized.length > analystClosureNoteMaxLength
  ) {
    return null;
  }
  return normalized;
}
