import { NextRequest, NextResponse } from "next/server";
import { CFG, callLLM } from "@/lib/providers";

export const dynamic = "force-dynamic";

interface LLMBody {
  prompt?: string;
  images?: Array<{ media_type?: string; data?: string }>;
}

export async function POST(req: NextRequest) {
  if (!CFG.llmKey) {
    return NextResponse.json({ code: "not_configured", message: "Set OPENAI_API_KEY in .env.local" }, { status: 503 });
  }
  try {
    const body = (await req.json()) as LLMBody;
    const images = (body.images || []).slice(0, 4).filter((im) => typeof im.data === "string") as Array<{
      media_type?: string;
      data: string;
    }>;
    const json = await callLLM(String(body.prompt || "").slice(0, 20000), images);
    return NextResponse.json({ json });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: (e as Error).message || "LLM call failed" }, { status: 502 });
  }
}
