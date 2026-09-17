export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (err && typeof err === 'object' && 'errors' in err) {
    const subErrors = (err as { errors: unknown[] }).errors;
    if (Array.isArray(subErrors) && subErrors.length > 0) {
      const first = subErrors[0];
      if (first instanceof Error && first.message) return first.message;
    }
  }
  return 'An unexpected error occurred';
}
