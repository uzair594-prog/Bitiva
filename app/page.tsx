"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Bell, BookOpen, ChevronDown, CircleHelp, Command, Compass, Eye, Globe2, LayoutDashboard, Menu, Search, Settings2, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";

type Ticker = { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
const WATCH = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"];
const fmt = (n: number, digits = 2) => new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const money = (n: number) => "$" + fmt(n, n >= 1000 ? 2 : 4);

function MiniChart({ candles }: { candles: Candle[] }) {
  const points = useMemo(() => {
    if (!candles.length) return "";
    const values = candles.map(c => c.close), min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
    return values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${94 - ((v - min) / range) * 84}`).join(" ");
  }, [candles]);
  return <div className="chart-wrap"><div className="chart-watermark">BTC<span>/</span>USDT</div><div className="chart-grid" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart-svg" aria-label="BTC price chart"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4ce0b3" stopOpacity=".23"/><stop offset="100%" stopColor="#4ce0b3" stopOpacity="0"/></linearGradient></defs>{points && <><polygon points={`0,100 ${points} 100,100`} fill="url(#chartFill)" /><polyline points={points} fill="none" stroke="#4ce0b3" strokeWidth=".65" vectorEffect="non-scaling-stroke" /></>}</svg><div className="chart-axis"><span>09:00</span><span>12:00</span><span>15:00</span><span>18:00</span><span>21:00</span></div><div className="chart-current"><span className="current-dot" /> Live public market data</div></div>;
}

export default function Home() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [selected, setSelected] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [tab, setTab] = useState("Order book");
  const [orderSide, setOrderSide] = useState<"Buy" | "Sell">("Buy");
  const [orderType, setOrderType] = useState<"Market" | "Limit">("Market");
  const [quantity, setQuantity] = useState("0.01");
  const [limitPrice, setLimitPrice] = useState("");
  const [paperOrders, setPaperOrders] = useState<{ id: string; side: string; symbol: string; type: string; qty: string; status: string }[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const current = tickers.find(t => t.symbol === selected);
  const last = Number(current?.lastPrice || 0);
  const change = Number(current?.priceChangePercent || 0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/market", { cache: "no-store" });
        if (!res.ok) throw new Error("Market feed is temporarily unavailable");
        const data = await res.json();
        if (!alive) return;
        setTickers(data.tickers || []);
        setUpdatedAt(new Date());
        setError("");
      } catch { if (alive) setError("Market feed temporarily unavailable — retrying automatically."); }
    };
    load(); const id = window.setInterval(load, 2500);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadCandles = async () => {
      try {
        const res = await fetch(`/api/market/candles?symbol=${selected}&interval=${interval}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Candle feed unavailable");
        const data = await res.json();
        if (alive) setCandles(data.candles || []);
      } catch { if (alive) setCandles([]); }
    };
    loadCandles(); const id = window.setInterval(loadCandles, 15000);
    return () => { alive = false; window.clearInterval(id); };
  }, [selected, interval]);

  const book = useMemo(() => {
    const mid = last || 67240.18;
    return Array.from({ length: 9 }, (_, i) => ({ ask: mid * (1 + (i + 1) * .00016), bid: mid * (1 - (i + 1) * .00016), askQty: .013 + ((i * 17) % 13) / 1000, bidQty: .011 + ((i * 11) % 15) / 1000 }));
  }, [last]);
  const placePaperOrder = async () => {
    const qty = Number(quantity), price = orderType === "Limit" ? Number(limitPrice) : last;
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) { setError("Enter a valid positive quantity and price."); return; }
    try {
      const response = await fetch("/api/paper/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: selected, side: orderSide.toUpperCase(), type: orderType.toUpperCase(), quantity, ...(orderType === "Limit" ? { limitPrice } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save paper order.");
      const ordersResponse = await fetch("/api/paper/orders", { cache: "no-store" });
      const ordersData = await ordersResponse.json();
      if (ordersResponse.ok) setPaperOrders((ordersData.orders || []).map((o: { id: string; side: string; symbol: string; type: string; quantity: string; status: string }) => ({ id: o.id, side: o.side === "BUY" ? "Buy" : "Sell", symbol: o.symbol, type: o.type === "MARKET" ? "Market" : "Limit", qty: o.quantity, status: o.status === "SIMULATED" ? "Simulated" : o.status })));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Paper order could not be saved."); }
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/paper/orders", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Paper order history unavailable.");
      if (alive) setPaperOrders((data.orders || []).map((o: { id: string; side: string; symbol: string; type: string; quantity: string; status: string }) => ({ id: o.id, side: o.side === "BUY" ? "Buy" : "Sell", symbol: o.symbol, type: o.type === "MARKET" ? "Market" : "Limit", qty: o.quantity, status: o.status === "SIMULATED" ? "Simulated" : o.status })));
    }).catch(() => { /* market overview remains usable if database persistence is not configured */ });
    return () => { alive = false; };
  }, []);

  return <main className="app-shell">
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}><div className="brand"><div className="brand-mark"><span /></div><span>bitvia<span className="brand-dot">.</span></span><button className="mobile-close icon-button" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={18}/></button></div><div className="workspace-label">WORKSPACE</div><nav className="nav-list"><a className="nav-item active" href="#"><LayoutDashboard size={17}/> Markets <span className="nav-active-dot"/></a><a className="nav-item" href="#trade"><Activity size={17}/> Trade terminal</a><a className="nav-item" href="#paper"><Wallet size={17}/> Paper portfolio</a><a className="nav-item" href="#research"><Compass size={17}/> Research</a></nav><div className="sidebar-bottom"><div className="upgrade-card"><div className="upgrade-icon"><Sparkles size={16}/></div><div><strong>Market intelligence</strong><p>Explore the market with clarity.</p></div><button aria-label="Explore research"><ArrowUpRight size={15}/></button></div><a className="nav-item" href="#settings"><Settings2 size={17}/> Settings</a><a className="nav-item" href="#help"><CircleHelp size={17}/> Help center</a><div className="profile"><div className="avatar">BV</div><div className="profile-copy"><strong>Guest workspace</strong><span>Sandbox mode</span></div><button className="icon-button" aria-label="Profile options"><ChevronDown size={15}/></button></div></div></aside>
    {mobileMenu && <button className="mobile-scrim" onClick={() => setMobileMenu(false)} aria-label="Close navigation"/>}
    <section className="main-column"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumbs">Markets <span>/</span> Overview</div><div className="top-actions"><div className="status-pill"><span/> Public data feed</div><button className="icon-button search-btn" aria-label="Search"><Search size={18}/></button><button className="icon-button notification-btn" aria-label="Notifications"><Bell size={18}/><i/></button><div className="top-divider"/><button className="top-avatar">BV</button></div></header>
    <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> DIGITAL ASSET TERMINAL</div><h1>Market overview<span>.</span></h1><p className="subheading">A clearer view of the digital asset markets.</p></div><div className="heading-right"><div className="updated-label"><span className={updatedAt ? "pulse-dot" : "pulse-dot muted"}/>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Connecting to feed"}</div><button className="date-button"><Globe2 size={15}/> Global markets <ChevronDown size={14}/></button></div></div>
    {error && <div className="feed-warning"><Activity size={15}/>{error}</div>}
    <div className="stats-grid"><div className="stat-card"><div className="stat-top"><span>BTC / USDT</span><span className="stat-icon bitcoin">₿</span></div><div className="stat-value">{money(Number(tickers.find(t=>t.symbol==="BTCUSDT")?.lastPrice || 0))}</div><div className={`stat-change ${Number(tickers.find(t=>t.symbol==="BTCUSDT")?.priceChangePercent || 0)>=0?"positive":"negative"}`}>{Number(tickers.find(t=>t.symbol==="BTCUSDT")?.priceChangePercent || 0)>=0?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>} {fmt(Number(tickers.find(t=>t.symbol==="BTCUSDT")?.priceChangePercent || 0))}% <span>24h</span></div><div className="stat-foot">Bitcoin · Spot</div></div><div className="stat-card"><div className="stat-top"><span>ETH / USDT</span><span className="stat-icon ethereum">◆</span></div><div className="stat-value">{money(Number(tickers.find(t=>t.symbol==="ETHUSDT")?.lastPrice || 0))}</div><div className={`stat-change ${Number(tickers.find(t=>t.symbol==="ETHUSDT")?.priceChangePercent || 0)>=0?"positive":"negative"}`}>{Number(tickers.find(t=>t.symbol==="ETHUSDT")?.priceChangePercent || 0)>=0?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>} {fmt(Number(tickers.find(t=>t.symbol==="ETHUSDT")?.priceChangePercent || 0))}% <span>24h</span></div><div className="stat-foot">Ethereum · Spot</div></div><div className="stat-card"><div className="stat-top"><span>SOL / USDT</span><span className="stat-icon solana">≋</span></div><div className="stat-value">{money(Number(tickers.find(t=>t.symbol==="SOLUSDT")?.lastPrice || 0))}</div><div className={`stat-change ${Number(tickers.find(t=>t.symbol==="SOLUSDT")?.priceChangePercent || 0)>=0?"positive":"negative"}`}>{Number(tickers.find(t=>t.symbol==="SOLUSDT")?.priceChangePercent || 0)>=0?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>} {fmt(Number(tickers.find(t=>t.symbol==="SOLUSDT")?.priceChangePercent || 0))}% <span>24h</span></div><div className="stat-foot">Solana · Spot</div></div><div className="stat-card market-summary"><div className="stat-top"><span>Market snapshot</span><span className="stat-icon"><Activity size={16}/></span></div><div className="summary-row"><span>Tracked assets</span><strong>{tickers.length || "—"}</strong></div><div className="summary-row"><span>Data source</span><strong>MEXC public API</strong></div><div className="summary-row"><span>Update cycle</span><strong>2.5 sec</strong></div></div></div>
    <div className="terminal-grid" id="trade"><section className="panel chart-panel"><div className="panel-heading"><div><div className="panel-kicker">MARKET CHART</div><div className="asset-title"><span className="coin-badge">{selected==="BTCUSDT"?"₿":selected==="ETHUSDT"?"◆":selected==="SOLUSDT"?"≋":"◈"}</span><h2>{selected.replace("USDT","")}<span>/ USDT</span></h2><button className="symbol-chevron" aria-label="Change symbol" onClick={()=>setSelected(WATCH[(WATCH.indexOf(selected)+1)%WATCH.length])}><ChevronDown size={15}/></button></div></div><div className="chart-heading-right"><div className="chart-price">{money(last)} <span className={change>=0?"positive":"negative"}>{change>=0?"+":""}{fmt(change)}%</span></div><div className="chart-market-label">SPOT MARKET</div></div></div><div className="chart-controls"><div className="intervals">{["15m","1h","4h","1d","1w"].map(v=><button key={v} className={interval===v?"selected":""} onClick={()=>setInterval(v)}>{v}</button>)}</div><div className="chart-tools"><button><Eye size={14}/></button><button><Settings2 size={14}/></button></div></div><MiniChart candles={candles}/><div className="chart-legend"><span><i className="legend-green"/> Price</span><span><i className="legend-gray"/> Volume</span><span className="chart-note">Candles: {candles.length || "waiting for data"}</span></div></section>
    <section className="panel orderbook-panel"><div className="panel-heading compact"><div><div className="panel-kicker">ILLUSTRATIVE DEPTH</div><h2>Order book</h2></div><button className="icon-button subtle" aria-label="Order book options"><Settings2 size={16}/></button></div><div className="book-tabs"><button className={tab==="Order book"?"selected":""} onClick={()=>setTab("Order book")}>Order book</button><button className={tab==="Recent trades"?"selected":""} onClick={()=>setTab("Recent trades")}>Recent trades</button></div>{tab==="Order book"?<><div className="book-header"><span>Price (USDT)</span><span>Amount</span><span>Total</span></div><div className="book-side asks">{book.slice().reverse().map((r,i)=><div className="book-row" key={`a${i}`}><span>{fmt(r.ask,2)}</span><span>{r.askQty.toFixed(4)}</span><span>{fmt(r.ask*r.askQty,2)}</span><i style={{width:`${22+(i*13)%64}%`}}/></div>)}</div><div className="book-mid"><strong>{money(last)}</strong><span className={change>=0?"positive":"negative"}>{change>=0?"+":""}{fmt(change)}%</span></div><div className="book-side bids">{book.map((r,i)=><div className="book-row" key={`b${i}`}><span>{fmt(r.bid,2)}</span><span>{r.bidQty.toFixed(4)}</span><span>{fmt(r.bid*r.bidQty,2)}</span><i style={{width:`${25+(i*17)%62}%`}}/></div>)}</div><div className="book-footer"><span>Spread</span><strong>{fmt((book[0]?.ask || 0)-(book[0]?.bid || 0),2)} USDT</strong></div></>:<div className="empty-trades"><Activity size={21}/><span>Live trade feed not connected</span><small>Depth rows are illustrative; they are not exchange Level 2 data.</small></div>}</section>
    <section className="panel markets-panel"><div className="panel-heading compact"><div><div className="panel-kicker">YOUR WATCHLIST</div><h2>Top markets</h2></div><button className="view-all">View all <ArrowUpRight size={14}/></button></div><div className="markets-table"><div className="table-head"><span>Asset</span><span>Last price</span><span>24h change</span><span>24h volume</span></div>{(tickers.length?tickers.filter(t=>WATCH.includes(t.symbol)):WATCH.map(symbol=>({symbol,lastPrice:"0",priceChangePercent:"0",quoteVolume:"0",highPrice:"0",lowPrice:"0"}))).map(t=><button className={`market-row ${selected===t.symbol?"market-selected":""}`} key={t.symbol} onClick={()=>setSelected(t.symbol)}><span className="market-name"><i className={`tiny-coin ${t.symbol.slice(0,3).toLowerCase()}`}>{t.symbol==="BTCUSDT"?"₿":t.symbol==="ETHUSDT"?"◆":t.symbol==="SOLUSDT"?"≋":t.symbol.slice(0,1)}</i><strong>{t.symbol.replace("USDT","")}<small>/ USDT</small></strong></span><span>{money(Number(t.lastPrice))}</span><span className={Number(t.priceChangePercent)>=0?"positive":"negative"}>{Number(t.priceChangePercent)>=0?"+":""}{fmt(Number(t.priceChangePercent))}%</span><span className="volume-value">${(Number(t.quoteVolume)/1e6).toFixed(2)}M</span></button>)}</div></section>
    <section className="panel trade-panel" id="paper"><div className="panel-heading compact"><div><div className="panel-kicker">SANDBOX ONLY</div><h2>Paper order</h2></div><span className="sandbox-badge"><ShieldCheck size={13}/> Simulation</span></div><div className="sandbox-notice">No real orders or funds. Orders are recorded locally for interface testing.</div><div className="side-toggle"><button className={orderSide==="Buy"?"buy-active":""} onClick={()=>setOrderSide("Buy")}>Buy</button><button className={orderSide==="Sell"?"sell-active":""} onClick={()=>setOrderSide("Sell")}>Sell</button></div><div className="order-type"><button className={orderType==="Market"?"selected":""} onClick={()=>setOrderType("Market")}>Market</button><button className={orderType==="Limit"?"selected":""} onClick={()=>setOrderType("Limit")}>Limit</button></div>{orderType==="Limit"&&<label className="field-label">Limit price (USDT)<input value={limitPrice} onChange={e=>setLimitPrice(e.target.value)} inputMode="decimal" placeholder={last?String(last):"0.00"}/></label>}<label className="field-label">Amount ({selected.replace("USDT","")})<input value={quantity} onChange={e=>setQuantity(e.target.value)} inputMode="decimal" placeholder="0.01"/></label><div className="quick-amounts">{["0.001","0.01","0.05","0.1"].map(v=><button key={v} onClick={()=>setQuantity(v)}>{v}</button>)}</div><div className="order-estimate"><span>Estimated notional</span><strong>{money(Number(quantity||0)*(orderType==="Limit"?Number(limitPrice||0):last))}</strong></div><button className={`submit-order ${orderSide==="Buy"?"buy-submit":"sell-submit"}`} onClick={placePaperOrder}>{orderSide==="Buy"?"Simulate buy":"Simulate sell"} <ArrowUpRight size={16}/></button><div className="order-footnote"><ShieldCheck size={13}/> Simulation only · no exchange credentials</div></section>
    <section className="panel paper-history" id="research"><div className="panel-heading compact"><div><div className="panel-kicker">SESSION ACTIVITY</div><h2>Paper order history</h2></div><span className="history-count">{paperOrders.length} orders</span></div>{paperOrders.length?<div className="history-list">{paperOrders.map(o=><div className="history-row" key={o.id}><div className={`history-side ${o.side.toLowerCase()}`}>{o.side==="Buy"?<ArrowDownRight size={14}/>:<ArrowUpRight size={14}/>}</div><div className="history-info"><strong>{o.side} {o.symbol.replace("USDT","")}/USDT</strong><span>{o.type} · {o.qty} · {o.id}</span></div><span className="sim-status">{o.status}</span></div>)}</div>:<div className="empty-history"><div className="empty-history-icon"><BookOpen size={20}/></div><strong>No paper orders yet</strong><span>Place a simulated order to see it appear here.</span></div>}</section></div>
    <footer className="footer"><span>© 2026 Bitvia Markets</span><span><i/> Public market data · Sandbox trading only</span><span>Built for market clarity <Sparkles size={12}/></span></footer></div></section>
  </main>;
}
