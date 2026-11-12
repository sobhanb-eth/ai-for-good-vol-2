import { NextResponse } from "next/server";
import { providerStatus } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(providerStatus());
}
