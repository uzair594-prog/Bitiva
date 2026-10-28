import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"];

export async function GET() {
  try {
    const response = await fetch("https://api.mexc.com/api/v3/ticker/24hr", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Upstream market API returned ${response.status}`);
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("Unexpected market payload");
    const tickers = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && SYMBOLS.includes(String((item as Record<string, unknown>).symbol)))
      .map((item) => ({ symbol: String(item.symbol), lastPrice: String(item.lastPrice ?? "0"), priceChangePercent: String(item.priceChangePercent ?? "0"), quoteVolume: String(item.quoteVolume ?? "0"), highPrice: String(item.highPrice ?? "0"), lowPrice: String(item.lowPrice ?? "0") }));
    return NextResponse.json({ tickers, source: "MEXC public spot market data", fetchedAt: new Date().toISOString(), mode: "public-data-only", ordersEnabled: false }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Market data temporarily unavailable", tickers: [], source: "MEXC public spot market data", ordersEnabled: false }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
