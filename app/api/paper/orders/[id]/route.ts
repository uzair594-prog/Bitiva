import { NextRequest, NextResponse } from "next/server";
import { GUEST_COOKIE, readGuestSession } from "@/lib/guest-session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function attachCookie(response: NextResponse, token?: string) {
  if (token) response.cookies.set(GUEST_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = readGuestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Sandbox session is missing. Load paper trading first." }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id || id.length > 128) return NextResponse.json({ error: "Invalid paper order ID" }, { status: 400 });

  try {
    const result = await prisma.paperOrder.updateMany({
      where: {
        id,
        userId: session.userId,
        status: { in: ["OPEN", "PARTIALLY_FILLED"] },
        type: "LIMIT",
      },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    if (result.count === 0) {
      return attachCookie(NextResponse.json({ error: "Order not found, not owned by this session, or no longer active." }, { status: 404 }), session.isNew ? session.token : undefined);
    }

    const order = await prisma.paperOrder.findFirst({
      where: { id, userId: session.userId },
      select: { id: true, symbol: true, side: true, type: true, status: true, limitPrice: true, quantity: true, filledQty: true, averagePrice: true, createdAt: true, updatedAt: true, cancelledAt: true },
    });

    return attachCookie(NextResponse.json({
      order: order && {
        ...order,
        limitPrice: order.limitPrice?.toString() ?? null,
        quantity: order.quantity.toString(),
        filledQty: order.filledQty.toString(),
        averagePrice: order.averagePrice?.toString() ?? null,
      },
      mode: "sandbox-only",
      realOrdersEnabled: false,
    }), session.isNew ? session.token : undefined);
  } catch {
    return NextResponse.json({ error: "Could not cancel paper order. Check the database schema is applied." }, { status: 503 });
  }
}
