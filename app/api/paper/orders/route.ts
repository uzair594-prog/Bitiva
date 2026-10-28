import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GUEST_COOKIE, readGuestSession } from "@/lib/guest-session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const schema = z.object({
  symbol: z.enum(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"]),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  quantity: z.string().trim().regex(/^\\d+(?:\\.\\d{1,18})?$/).refine(v => Number(v) > 0 && Number.isFinite(Number(v)), "Quantity must be positive"),
  limitPrice: z.string().trim().regex(/^\\d+(?:\\.\\d{1,18})?$/).optional(),
}).superRefine((v, ctx) => {
  if (v.type === "LIMIT" && (!v.limitPrice || !Number.isFinite(Number(v.limitPrice)) || Number(v.limitPrice) <= 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: "A positive limit price is required" });
  if (v.type === "MARKET" && v.limitPrice !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: "Market orders cannot include a limit price" });
});

function attachCookie(response: NextResponse, token?: string) {
  if (token) response.cookies.set(GUEST_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

async function ensureGuest(userId: string) {
  await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: "Sandbox guest" } });
}

export async function GET(request: NextRequest) {
  const session = readGuestSession(request);
  if (!session) return NextResponse.json({ error: "Sandbox persistence is not configured. Set SESSION_SECRET (at least 32 characters) and DATABASE_URL." }, { status: 503 });
  try {
    await ensureGuest(session.userId);
    const orders = await prisma.paperOrder.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, symbol: true, side: true, type: true, status: true, limitPrice: true, quantity: true, filledQty: true, averagePrice: true, createdAt: true, updatedAt: true } });
    const response = NextResponse.json({ orders: orders.map(o => ({ ...o, limitPrice: o.limitPrice?.toString() ?? null, quantity: o.quantity.toString(), filledQty: o.filledQty.toString(), averagePrice: o.averagePrice?.toString() ?? null })), mode: "sandbox-only", realOrdersEnabled: false });
    return attachCookie(response, session.isNew ? session.token : undefined);
  } catch {
    return NextResponse.json({ error: "Could not load paper orders. Check the database schema is applied." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = readGuestSession(request);
  if (!session) return NextResponse.json({ error: "Sandbox persistence is not configured. Set SESSION_SECRET (at least 32 characters) and DATABASE_URL." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid paper order", details: parsed.error.flatten() }, { status: 400 });
  try {
    await ensureGuest(session.userId);
    const input = parsed.data;
    const order = await prisma.paperOrder.create({ data: { userId: session.userId, symbol: input.symbol, side: input.side, type: input.type, status: input.type === "MARKET" ? "SIMULATED" : "OPEN", quantity: input.quantity, limitPrice: input.type === "LIMIT" ? input.limitPrice : undefined }, select: { id: true, symbol: true, side: true, type: true, status: true, limitPrice: true, quantity: true, createdAt: true } });
    const response = NextResponse.json({ order: { ...order, limitPrice: order.limitPrice?.toString() ?? null, quantity: order.quantity.toString() }, mode: "sandbox-only", realOrdersEnabled: false }, { status: 201 });
    return attachCookie(response, session.isNew ? session.token : undefined);
  } catch {
    return NextResponse.json({ error: "Could not save paper order. Check the database schema is applied." }, { status: 503 });
  }
}
