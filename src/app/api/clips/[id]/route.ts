import { NextResponse } from "next/server";
import { advanceClip } from "@/lib/pipeline";
import { toPublicClip } from "../view";

export const runtime = "nodejs";
export const maxDuration = 60; // may download + store the finished video

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const clip = await advanceClip(id);
    if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(await toPublicClip(clip));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't check on the video." }, { status: 502 });
  }
}
