import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const GUEST_COOKIE = "bitvia_sandbox_session";
const sign = (id: string, secret: string) => createHmac("sha256", secret).update(id).digest("hex");

export function readGuestSession(request: NextRequest): { userId: string; isNew: false } | { userId: string; token: string; isNew: true } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const token = request.cookies.get(GUEST_COOKIE)?.value;
  if (token) {
    const [id, signature, extra] = token.split(".");
    if (id && signature && !extra && /^[0-9a-f-]{36}$/i.test(id)) {
      const expected = sign(id, secret);
      const a = Buffer.from(signature, "hex");
      const b = Buffer.from(expected, "hex");
      if (a.length === b.length && timingSafeEqual(a, b)) return { userId: id, isNew: false };
    }
  }
  const userId = randomUUID();
  return { userId, token: userId + "." + sign(userId, secret), isNew: true };
}
