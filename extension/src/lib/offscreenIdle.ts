/** What the offscreen document is busy with; it may only be closed when none of it is going on. */
export interface OffscreenActivity {
  recording: boolean;
  /** A stop (built-in or helper) is still flushing/persisting. */
  stopping: boolean;
  processing: boolean;
  queued: number;
  /** Helper mode: a recording is held in memory or being uploaded. */
  helperPending: boolean;
}

export function isOffscreenIdle(a: OffscreenActivity): boolean {
  return !a.recording && !a.stopping && !a.processing && a.queued === 0 && !a.helperPending;
}
