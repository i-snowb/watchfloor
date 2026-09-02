export function shouldClearOperationError(
  errorRevision: number | null,
  currentRevision: number,
): boolean {
  return errorRevision !== null && currentRevision > errorRevision;
}
