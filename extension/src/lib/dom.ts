// Small DOM helpers shared by the extension pages.

export const ARM_MS = 4000;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button that needs two clicks within a few seconds (no confirm() dialog). */
export function twoClick(btn: HTMLButtonElement, idle: string, armedText: string, run: () => Promise<void>): void {
  let timer: number | undefined;
  const reset = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    btn.classList.remove("armed");
    btn.textContent = idle;
  };
  btn.addEventListener("click", () => {
    if (timer === undefined) {
      btn.classList.add("armed");
      btn.textContent = armedText;
      timer = window.setTimeout(reset, ARM_MS);
      return;
    }
    reset();
    void run();
  });
}

/**
 * Saves a blob to the Downloads folder (extension pages may download their own blob: URLs).
 * The URL is released a minute later, long after Chrome has read it.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
