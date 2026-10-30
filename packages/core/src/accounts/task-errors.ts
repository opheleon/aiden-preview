/**
 * A task failure every machine would hit the same way, for example a verify task whose
 * instructions name no pull request. The server fails the task for good instead of retrying it on
 * another machine. Missing tools, code access, or a newer project version are never permanent:
 * another machine may succeed.
 */
export class PermanentTaskError extends Error {
  /** Explain why no machine can run the task. */
  constructor(message: string) {
    super(message);
    this.name = 'PermanentTaskError';
  }
}
