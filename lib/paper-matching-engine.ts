export type Side = "BUY" | "SELL";
export type Kind = "LIMIT" | "MARKET";
export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED";

/** Integer-scaled order data avoids binary floating-point rounding in the matching loop.
 * priceTicks and quantityLots are integers in instrument-defined units; this engine is sandbox-only.
 */
export interface PaperOrder {
  id: string;
  ownerId: string;
  symbol: string;
  side: Side;
  kind: Kind;
  priceTicks: number | null;
  quantityLots: number;
  filledLots: number;
  sequence: number;
  status: OrderStatus;
}

export interface PaperFill {
  id: string;
  symbol: string;
  priceTicks: number;
  quantityLots: number;
  buyOrderId: string;
  sellOrderId: string;
  makerOrderId: string;
  takerOrderId: string;
  sequence: number;
}

export interface SubmitResult {
  order: PaperOrder;
  fills: PaperFill[];
  resting: boolean;
}

/** Single-process deterministic price-time priority book for demonstrations and tests.
 * It is intentionally not connected to an exchange, wallet, network, or real-money account.
 */
export class PaperMatchingEngine {
  private readonly orders = new Map<string, PaperOrder>();
  private readonly fills: PaperFill[] = [];
  private nextSequence = 1;
  private nextId = 1;

  constructor(readonly symbol: string) {
    if (!/^[A-Z0-9]{3,20}$/.test(symbol)) throw new Error("Invalid sandbox symbol");
  }

  getOrder(id: string): PaperOrder | undefined {
    const order = this.orders.get(id);
    return order ? { ...order } : undefined;
  }

  getFills(): PaperFill[] {
    return this.fills.map(fill => ({ ...fill }));
  }

  getDepth(levels = 20): { bids: { priceTicks: number; quantityLots: number }[]; asks: { priceTicks: number; quantityLots: number }[] } {
    const safeLevels = Math.max(1, Math.min(100, Math.floor(levels)));
    const aggregate = (side: Side) => {
      const rows = [...this.orders.values()].filter(o => o.symbol === this.symbol && o.side === side && (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") && o.kind === "LIMIT" && o.priceTicks !== null);
      const byPrice = new Map<number, number>();
      for (const order of rows) byPrice.set(order.priceTicks!, (byPrice.get(order.priceTicks!) ?? 0) + order.quantityLots - order.filledLots);
      return [...byPrice.entries()].sort((a, b) => side === "BUY" ? b[0] - a[0] : a[0] - b[0]).slice(0, safeLevels).map(([priceTicks, quantityLots]) => ({ priceTicks, quantityLots }));
    };
    return { bids: aggregate("BUY"), asks: aggregate("SELL") };
  }

  submit(input: { ownerId: string; side: Side; kind: Kind; priceTicks?: number; quantityLots: number }): SubmitResult {
    if (!input.ownerId || input.ownerId.length > 128) throw new Error("Invalid ownerId");
    if (!Number.isSafeInteger(input.quantityLots) || input.quantityLots <= 0) throw new Error("quantityLots must be a positive safe integer");
    if (input.kind === "LIMIT" && (!Number.isSafeInteger(input.priceTicks) || (input.priceTicks ?? 0) <= 0)) throw new Error("Limit orders require positive integer priceTicks");
    if (input.kind === "MARKET" && input.priceTicks !== undefined) throw new Error("Market orders must not specify priceTicks");

    const incoming: PaperOrder = {
      id: `PAPER-${this.nextId++}`,
      ownerId: input.ownerId,
      symbol: this.symbol,
      side: input.side,
      kind: input.kind,
      priceTicks: input.kind === "LIMIT" ? input.priceTicks! : null,
      quantityLots: input.quantityLots,
      filledLots: 0,
      sequence: this.nextSequence++,
      status: "OPEN",
    };
    this.orders.set(incoming.id, incoming);
    const fills: PaperFill[] = [];
    const opposite: Side = incoming.side === "BUY" ? "SELL" : "BUY";

    while (incoming.quantityLots > incoming.filledLots) {
      const candidates = [...this.orders.values()].filter(o => o.id !== incoming.id && o.symbol === this.symbol && o.side === opposite && o.kind === "LIMIT" && o.priceTicks !== null && (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") && o.quantityLots > o.filledLots && o.ownerId !== incoming.ownerId);
      candidates.sort((a, b) => {
        const priceCompare = incoming.side === "BUY" ? a.priceTicks! - b.priceTicks! : b.priceTicks! - a.priceTicks!;
        return priceCompare || a.sequence - b.sequence;
      });
      const maker = candidates[0];
      if (!maker) break;
      const crosses = incoming.kind === "MARKET" || (incoming.side === "BUY" ? incoming.priceTicks! >= maker.priceTicks! : incoming.priceTicks! <= maker.priceTicks!);
      if (!crosses) break;

      const quantityLots = Math.min(incoming.quantityLots - incoming.filledLots, maker.quantityLots - maker.filledLots);
      const fill: PaperFill = {
        id: `FILL-${this.nextId++}`,
        symbol: this.symbol,
        priceTicks: maker.priceTicks!,
        quantityLots,
        buyOrderId: incoming.side === "BUY" ? incoming.id : maker.id,
        sellOrderId: incoming.side === "SELL" ? incoming.id : maker.id,
        makerOrderId: maker.id,
        takerOrderId: incoming.id,
        sequence: this.nextSequence++,
      };
      fills.push(fill);
      this.fills.push(fill);
      incoming.filledLots += quantityLots;
      maker.filledLots += quantityLots;
      maker.status = maker.filledLots === maker.quantityLots ? "FILLED" : "PARTIALLY_FILLED";
    }

    if (incoming.filledLots === incoming.quantityLots) incoming.status = "FILLED";
    else if (incoming.filledLots > 0) incoming.status = incoming.kind === "MARKET" ? "CANCELLED" : "PARTIALLY_FILLED";
    else incoming.status = incoming.kind === "MARKET" ? "CANCELLED" : "OPEN";
    // Market-order remainder is cancelled; only limit orders may rest in the simulated book.
    if (incoming.kind === "MARKET" && incoming.filledLots < incoming.quantityLots) incoming.status = "CANCELLED";
    return { order: { ...incoming }, fills: fills.map(fill => ({ ...fill })), resting: incoming.kind === "LIMIT" && incoming.status !== "FILLED" };
  }

  cancel(orderId: string, ownerId: string): PaperOrder {
    const order = this.orders.get(orderId);
    if (!order || order.ownerId !== ownerId) throw new Error("Order not found");
    if (order.status !== "OPEN" && order.status !== "PARTIALLY_FILLED") throw new Error("Only active paper orders can be cancelled");
    order.status = "CANCELLED";
    return { ...order };
  }
}
