/**
 * After a failed stop/upload/retry: is there still a recording to protect?
 * - offscreen doc alive and not known to be empty -> stay `upload-failed` (Retry stays possible)
 * - offscreen doc gone, or it reported nothing kept -> `idle` (a new meeting can be recorded),
 *   keeping the error so the popup can say what was lost.
 */
export function stateAfterFailure(input: {
  offscreenAlive: boolean;
  dataKept: boolean | undefined;
  error: string;
}): { state: "upload-failed" | "idle"; error: string } {
  if (input.offscreenAlive && input.dataKept !== false) return { state: "upload-failed", error: input.error };
  return { state: "idle", error: `Recording lost: ${input.error}` };
}
