import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const querySchema = z.object({ symbol: z.enum(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"]).default("BTCUSDT"), interval: z.enum(["15m", "1h", "4h", "1d", "1w"]).default("1h") });
const intervals: Record<string, string> = { "15m": "15m", "1h": "60m", "4h": "4h", "1d": "1d", "1w": "1W" };

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ symbol: request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT", interval: request.nextUrl.searchParams.get("interval") ?? "1h" });
  if (!parsed.success) return NextResponse.json({ error: "Invalid symbol or interval" }, { status: 400 });
  try {
    const { symbol, interval } = parsed.data;
    const upstream = new URL("https://api.mexc.com/api/v3/klines");
    upstream.searchParams.set("symbol", symbol);
    upstream.searchParams.set("interval", intervals[interval]);
    upstream.searchParams.set("limit", "120");
    const response = await fetch(upstream, { cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Upstream candle API returned ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Unexpected candle payload");
    const candles = rows.filter((row): row is unknown[] => Array.isArray(row) && row.length >= 6).map(row => ({ time: Math.floor(Number(row[0]) / 1000), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) })).filter(c => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0);
    return NextResponse.json({ symbol, interval, candles, fetchedAt: new Date().toISOString(), source: "MEXC public spot klines" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Candle data temporarily unavailable", candles: [] }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
