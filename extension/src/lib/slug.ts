import type { MeetingType } from "../types";

const ILLEGAL_OR_SPACE = /[<>:"/\\|?*\u0000-\u001f\s]+/g;
const SLUG_MAX = 80;

function rawSlug(title: string): string {
  let s = (title || "").replace(ILLEGAL_OR_SPACE, "-");
  s = s.replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return s.slice(0, SLUG_MAX).replace(/[-.]+$/, "");
}

/** Port of helper/meetnotes/store.py slugify. */
export function slugify(title: string): string {
  return rawSlug(title) || "meeting";
}

/** `YYYY-MM-DD_<type>[_<slug>]`, with `-2`, `-3`... while `exists`. */
export function meetingId(
  startedAtIso: string,
  type: MeetingType,
  title: string,
  exists: (id: string) => boolean,
): string {
  const head = startedAtIso.slice(0, 10);
  const slug = rawSlug(title);
  const base = slug ? `${head}_${type}_${slug}` : `${head}_${type}`;
  let id = base;
  for (let n = 2; exists(id); n++) id = `${base}-${n}`;
  return id;
}
