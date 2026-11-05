// One-time microphone permission: an offscreen document can't show the prompt, a visible page can.
const statusEl = document.getElementById("status") as HTMLElement;

async function closeSelf(): Promise<void> {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // fall through
  }
  window.close();
}

async function run(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent = "Microphone access granted. Go back to the Meet tab and press Start again.";
    setTimeout(() => void closeSelf(), 1500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    statusEl.textContent =
      `Microphone access was not granted (${msg}). Allow it via the site-settings icon in the address bar, then reload this page.`;
  }
}

void run();
