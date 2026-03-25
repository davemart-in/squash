export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} already exists: ${id}`);
    this.name = "ConflictError";
  }
}
