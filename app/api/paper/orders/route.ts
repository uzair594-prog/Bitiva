import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { GUEST_COOKIE, readGuestSession } from "@/lib/guest-session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCALE = 10n ** 18n;
const MAX_DECIMAL = 10n ** 36n - 1n;
const schema = z.object({
  symbol: z.enum(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"]),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  quantity: z.string().trim().regex(/^\d+(?:\.\d{1,18})?$/).refine(v => isPositiveDecimal(v), "Quantity must be positive and fit Decimal(36,18)"),
  limitPrice: z.string().trim().regex(/^\d+(?:\.\d{1,18})?$/).optional().refine(v => v === undefined || isPositiveDecimal(v), "Price must be positive and fit Decimal(36,18)"),
}).superRefine((v, ctx) => {
  if (v.type === "LIMIT" && !v.limitPrice) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: "A positive limit price is required" });
  if (v.type === "MARKET" && v.limitPrice !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: "Market orders cannot include a limit price" });
});

function toScaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}

function isPositiveDecimal(value: string): boolean {
  try {
    const scaled = toScaled(value);
    return scaled > 0n && scaled <= MAX_DECIMAL;
  } catch {
    return false;
  }
}

function fromScaled(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function weightedAverage(oldQty: bigint, oldAverage: bigint, fillQty: bigint, price: bigint): bigint {
  const totalQty = oldQty + fillQty;
  return totalQty === 0n ? 0n : (oldQty * oldAverage + fillQty * price) / totalQty;
}

function attachCookie(response: NextResponse, token?: string) {
  if (token) response.cookies.set(GUEST_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

async function ensureGuest(userId: string) {
  await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: "Sandbox guest" } });
}

const orderSelect = {
  id: true, symbol: true, side: true, type: true, status: true,
  limitPrice: true, quantity: true, filledQty: true, averagePrice: true,
  createdAt: true, updatedAt: true, cancelledAt: true,
} as const;

function serializeOrder<T extends { limitPrice: Prisma.Decimal | null; quantity: Prisma.Decimal; filledQty: Prisma.Decimal; averagePrice: Prisma.Decimal | null }>(order: T) {
  return { ...order, limitPrice: order.limitPrice?.toString() ?? null, quantity: order.quantity.toString(), filledQty: order.filledQty.toString(), averagePrice: order.averagePrice?.toString() ?? null };
}

async function submitPersistentOrder(userId: string, input: z.infer<typeof schema>) {
  // Serializable isolation prevents two concurrent submissions from consuming the same resting quantity.
  return prisma.$transaction(async tx => {
    const incoming = await tx.paperOrder.create({
      data: {
        userId, symbol: input.symbol, side: input.side, type: input.type,
        status: "OPEN", quantity: input.quantity,
        limitPrice: input.type === "LIMIT" ? input.limitPrice : undefined,
      },
      select: orderSelect,
    });

    const incomingQty = toScaled(input.quantity);
    const incomingPrice = input.limitPrice ? toScaled(input.limitPrice) : null;
    let filledQty = 0n;
    let notional = 0n;

    const makers = await tx.paperOrder.findMany({
      where: {
        symbol: input.symbol,
        side: input.side === "BUY" ? "SELL" : "BUY",
        type: "LIMIT",
        status: { in: ["OPEN", "PARTIALLY_FILLED"] },
        userId: { not: userId },
        filledQty: { lt: tx.paperOrder.fields.quantity },
      },
      select: orderSelect,
    });
    // Price-time priority: best available price first, then oldest resting order.
    makers.sort((a, b) => {
      const aPrice = a.limitPrice ? toScaled(a.limitPrice.toString()) : 0n;
      const bPrice = b.limitPrice ? toScaled(b.limitPrice.toString()) : 0n;
      if (aPrice !== bPrice) return input.side === "BUY" ? (aPrice < bPrice ? -1 : 1) : (aPrice > bPrice ? -1 : 1);
      const time = a.createdAt.getTime() - b.createdAt.getTime();
      return time || a.id.localeCompare(b.id);
    });

    for (const maker of makers) {
      if (filledQty >= incomingQty) break;
      if (maker.limitPrice === null) continue;
      const makerPrice = toScaled(maker.limitPrice.toString());
      const crosses = input.type === "MARKET" ||
        (input.side === "BUY" ? incomingPrice !== null && incomingPrice >= makerPrice : incomingPrice !== null && incomingPrice <= makerPrice);
      if (!crosses) continue;

      const makerTotal = toScaled(maker.quantity.toString());
      const makerFilled = toScaled(maker.filledQty.toString());
      const available = makerTotal - makerFilled;
      if (available <= 0n) continue;
      const fillQty = incomingQty - filledQty < available ? incomingQty - filledQty : available;
      const priorMakerAverage = maker.averagePrice ? toScaled(maker.averagePrice.toString()) : 0n;
      const nextMakerFilled = makerFilled + fillQty;
      const nextMakerAverage = weightedAverage(makerFilled, priorMakerAverage, fillQty, makerPrice);
      const makerStatus = nextMakerFilled >= makerTotal ? "FILLED" : "PARTIALLY_FILLED";

      await tx.paperOrder.update({
        where: { id: maker.id },
        data: { filledQty: fromScaled(nextMakerFilled), averagePrice: fromScaled(nextMakerAverage), status: makerStatus },
      });
      await tx.paperTrade.create({
        data: {
          symbol: input.symbol,
          price: fromScaled(makerPrice),
          quantity: fromScaled(fillQty),
          buyerOrderId: input.side === "BUY" ? incoming.id : maker.id,
          sellerOrderId: input.side === "SELL" ? incoming.id : maker.id,
        },
      });
      filledQty += fillQty;
      notional += fillQty * makerPrice;
    }

    const averagePrice = filledQty > 0n ? notional / filledQty : null;
    const finalStatus = filledQty >= incomingQty
      ? "FILLED"
      : input.type === "MARKET"
        ? "CANCELLED"
        : filledQty > 0n ? "PARTIALLY_FILLED" : "OPEN";

    const order = await tx.paperOrder.update({
      where: { id: incoming.id },
      data: {
        filledQty: fromScaled(filledQty),
        averagePrice: averagePrice === null ? null : fromScaled(averagePrice),
        status: finalStatus,
        cancelledAt: input.type === "MARKET" && filledQty < incomingQty ? new Date() : null,
      },
      select: orderSelect,
    });
    return order;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
}

export async function GET(request: NextRequest) {
  const session = readGuestSession(request);
  if (!session) return NextResponse.json({ error: "Sandbox persistence is not configured. Set SESSION_SECRET (at least 32 characters) and DATABASE_URL." }, { status: 503 });
  try {
    await ensureGuest(session.userId);
    const orders = await prisma.paperOrder.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" }, take: 50, select: orderSelect });
    return attachCookie(NextResponse.json({ orders: orders.map(serializeOrder), mode: "sandbox-only", realOrdersEnabled: false }), session.isNew ? session.token : undefined);
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
    const order = await submitPersistentOrder(session.userId, parsed.data);
    return attachCookie(NextResponse.json({ order: serializeOrder(order), mode: "sandbox-only", realOrdersEnabled: false }, { status: 201 }), session.isNew ? session.token : undefined);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Concurrent sandbox order conflict. Please retry the paper order." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not process paper order. Check the database schema is applied." }, { status: 503 });
  }
}
