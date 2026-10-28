# Bitvia

Bitvia is a Next.js digital-asset market terminal with public spot-market telemetry and a sandbox-only order interface.

## Current capabilities

- Public MEXC spot ticker proxy for BTC, ETH, SOL, BNB, XRP and ADA.
- Validated public candle endpoint with interval mapping (`1h` -> `60m`, `1w` -> `1W`).
- Responsive dark market dashboard, watchlist, chart visualization, order-book visual and paper-order history.
- Paper-order controls are simulation-only. They do not send orders to MEXC or any other venue.
- Public API routes do not require API keys and never accept custody credentials.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Deploy

Import this repository into Vercel and use the default Next.js build settings. No secrets are required for the public market data endpoints.

## Important implementation notes

- The chart currently uses a lightweight SVG visualization of fetched candle closes. The `lightweight-charts` package is included for a future chart component integration.
- The order-book depth rows are illustrative visualization values derived around the current ticker, not a venue-sourced Level 2 order book. Do not represent them as real market depth.
- Paper orders are held in browser component state and are not persisted across reloads.
- No real-money trading, leveraged futures execution, customer-fund custody, deposits, withdrawals, or financial recommendations are implemented.
- Before any production financial product, obtain qualified legal/compliance review and independent security review. Do not store exchange secrets in client code.
