import { NextResponse } from "next/server";
import { mockTeeSignerAddress } from "@/lib/sign";

export const runtime = "nodejs";
// Reads MOCK_TEE_PRIVATE_KEY at request time — must not be statically
// prerendered at build time, where that secret isn't available.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ address: mockTeeSignerAddress() });
}
