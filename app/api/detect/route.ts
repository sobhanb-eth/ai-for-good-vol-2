import { NextRequest, NextResponse } from "next/server";
import { CFG, callHive, callOpenAITextDetect } from "@/lib/providers";

export const dynamic = "force-dynamic";

interface DetectBody {
  type?: "image" | "audio" | "text";
  text?: string;
  data?: string;
  media_type?: string;
  filename?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DetectBody;
    if (body.type === "text") {
      if (!CFG.llmKey) return NextResponse.json({ message: "Set OPENAI_API_KEY in .env.local" }, { status: 503 });
      const r = await callOpenAITextDetect(String(body.text || "").slice(0, 50000));
      return NextResponse.json({ kind: "text", provider: "FineTuned LFM3 Omni", model: CFG.textModel, src: "lfm3_live", ...r });
    }
    if (body.type === "image" || body.type === "audio") {
      const key = body.type === "audio" ? CFG.hiveAudioKey || CFG.hiveKey : CFG.hiveKey;
      const endpoint = body.type === "audio" ? CFG.hiveAudioUrl : CFG.hiveUrl;
      if (!key) {
        return NextResponse.json(
          { message: `Set ${body.type === "audio" ? "HIVE_AUDIO_API_KEY" : "HIVE_API_KEY"} in .env.local` },
          { status: 503 }
        );
      }
      if (!body.data) return NextResponse.json({ message: "No file was sent." }, { status: 400 });
      const buf = Buffer.from(body.data, "base64");
      const r = await callHive(
        buf,
        body.media_type || "application/octet-stream",
        body.filename || (body.type === "audio" ? "audio" : "image.jpg"),
        key,
        endpoint
      );
      return NextResponse.json({ kind: body.type, provider: "Hive", src: "hive_live", ...r });
    }
    return NextResponse.json({ message: "Unknown type" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: (e as Error).message || "Server error" }, { status: 502 });
  }
}
