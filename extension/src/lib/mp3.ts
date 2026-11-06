import { Mp3Encoder } from "@breezystack/lamejs";
import { PCM_RATE } from "./audioChunks";

const FRAME = 1152;

export function encodeMp3(pcm: Int16Array, sampleRate = PCM_RATE, kbps = 32): Blob {
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += FRAME) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + FRAME));
    if (buf.length) parts.push(buf);
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}
