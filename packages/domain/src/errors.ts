export type ErrorCode =
  'INVALID_INPUT' | 'UNSUPPORTED_FEATURE' | 'CONTRACT_PENDING' | 'STALE_STATE' | 'NOT_FOUND' | 'UNAUTHORIZED';
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
