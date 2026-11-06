import type { Settings } from "./settings";

export const SERVICES_NOTICE = "Made without your services folder — Allow & Retry";

/** queryPermission is not in TS's DOM lib. */
export interface PermissionQueryable {
  queryPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export interface ServicesSnapshot {
  servicesContext: string | null;
  servicesNotice?: string;
}

/**
 * The services-folder context frozen into a meeting at Stop. Only technical users with a saved
 * folder get one; if the folder can't be read without a prompt, the meeting carries a notice instead.
 */
export async function snapshotServices(
  settings: Pick<Settings, "role">,
  getHandle: (key: string) => Promise<FileSystemDirectoryHandle | undefined>,
  read: (dir: FileSystemDirectoryHandle) => Promise<string>,
): Promise<ServicesSnapshot> {
  if (settings.role !== "technical") return { servicesContext: null };
  const h = await getHandle("services");
  if (!h) return { servicesContext: null };
  try {
    const perm = await (h as unknown as PermissionQueryable).queryPermission({ mode: "read" });
    if (perm === "granted") return { servicesContext: await read(h) };
  } catch {
    // folder moved/deleted or unreadable: same outcome as a missing permission
  }
  return { servicesContext: null, servicesNotice: SERVICES_NOTICE };
}

/**
 * An interrupted meeting processed later (Process saved recording): the background can't read the
 * folder without a user gesture, so a technical user with a saved folder gets the notice, which
 * offers Allow & Retry on the meeting page.
 */
export async function savedMeetingServices(
  settings: Pick<Settings, "role">,
  getHandle: (key: string) => Promise<FileSystemDirectoryHandle | undefined>,
): Promise<ServicesSnapshot> {
  if (settings.role !== "technical") return { servicesContext: null };
  let h: FileSystemDirectoryHandle | undefined;
  try {
    h = await getHandle("services");
  } catch {
    // can't tell whether a folder is saved: say the notes were made without it
    return { servicesContext: null, servicesNotice: SERVICES_NOTICE };
  }
  return h ? { servicesContext: null, servicesNotice: SERVICES_NOTICE } : { servicesContext: null };
}
