import "server-only";

export type RepositoryMutationResult<T> =
  | { status: "updated"; row: T }
  | { status: "conflict"; expectedRevision: number };

export class RepositoryOperationError extends Error {
  constructor(public readonly category: string) {
    super("A server-side repository operation failed.");
    this.name = "RepositoryOperationError";
  }
}

export function repositoryFailure(category: string): never {
  throw new RepositoryOperationError(category);
}
