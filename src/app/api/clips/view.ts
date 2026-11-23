import "server-only";
import { CLIP_BUCKET, signedUrl, type ClipRow } from "@/lib/db";

/** What the browser is allowed to see about a clip. */
export async function toPublicClip(clip: ClipRow) {
  return {
    id: clip.id,
    status: clip.status,
    error: clip.error,
    attempts: clip.attempts,
    videoPrompt: clip.video_prompt,
    dogProfile: clip.dog_profile,
    timings: clip.timings,
    videoUrl: clip.video_path ? await signedUrl(CLIP_BUCKET, clip.video_path) : null,
  };
}
export type PublicClip = Awaited<ReturnType<typeof toPublicClip>>;
