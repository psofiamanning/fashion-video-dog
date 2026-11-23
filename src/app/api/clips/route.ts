import { NextResponse } from "next/server";
import { createClip, InputError } from "@/lib/pipeline";
import { ClaudeRefusalError } from "@/lib/claude";
import { toPublicClip } from "./view";

export const runtime = "nodejs";
export const maxDuration = 60; // two Claude calls + MiniMax submit

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const photo = form.get("photo");
    const text = form.get("text");
    if (!(photo instanceof File) || typeof text !== "string") {
      return NextResponse.json({ error: "Send a photo and some text." }, { status: 400 });
    }
    const clip = await createClip({ photo, text });
    return NextResponse.json(await toPublicClip(clip), { status: 201 });
  } catch (err) {
    if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ClaudeRefusalError) return NextResponse.json({ error: "We couldn't check that photo. Try another." }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
