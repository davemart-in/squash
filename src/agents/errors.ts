export class FetchError extends Error {
  constructor(source: string, message: string) {
    super(`[${source}] ${message}`);
    this.name = "FetchError";
  }
}
