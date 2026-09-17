import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns a normal Error message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to the first sub-error message when the top-level message is empty (AggregateError)', () => {
    const err = new AggregateError([new Error('connection refused')], '');
    expect(getErrorMessage(err)).toBe('connection refused');
  });

  it('returns a generic fallback for a non-Error value with nothing useful', () => {
    expect(getErrorMessage('just a string')).toBe('An unexpected error occurred');
  });

  it('returns a generic fallback for an empty AggregateError with no sub-errors', () => {
    const err = new AggregateError([], '');
    expect(getErrorMessage(err)).toBe('An unexpected error occurred');
  });
});
