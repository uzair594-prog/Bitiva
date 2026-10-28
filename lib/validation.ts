import { z } from "zod";

export const paperOrderSchema = z.object({
  ownerId: z.string().trim().min(1).max(128),
  symbol: z.enum(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"]),
  side: z.enum(["BUY", "SELL"]),
  kind: z.enum(["LIMIT", "MARKET"]),
  priceTicks: z.number().int().positive().safe().optional(),
  quantityLots: z.number().int().positive().safe(),
}).superRefine((order, ctx) => {
  if (order.kind === "LIMIT" && order.priceTicks === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceTicks"], message: "Limit orders require priceTicks" });
  if (order.kind === "MARKET" && order.priceTicks !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceTicks"], message: "Market orders must not include priceTicks" });
});
