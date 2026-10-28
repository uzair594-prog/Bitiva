import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.PAPER_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("Integration tests require SESSION_SECRET with at least 32 characters.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("Integration tests require DATABASE_URL pointing to a disposable test database.");
}

const server = spawn("npm", ["run", "start", "--", "-p", "3100"], {
  stdio: "inherit",
  env: { ...process.env, PORT: "3100" },
});
const testUsers = [];

function sessionCookie(userId = randomUUID()) {
  testUsers.push(userId);
  const signature = createHmac("sha256", secret).update(userId).digest("hex");
  return `bitvia_sandbox_session=${userId}.${signature}`;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error("Next server did not become ready within 30 seconds.");
}

async function submit(cookie, order) {
  const response = await fetch(`${baseUrl}/api/paper/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(order),
  });
  const body = await response.json();
  assert.equal(response.status, 201, `order submission failed: ${JSON.stringify(body)}`);
  assert.equal(body.mode, "sandbox-only");
  assert.equal(body.realOrdersEnabled, false);
  return body.order;
}

async function getOrders(cookie) {
  const response = await fetch(`${baseUrl}/api/paper/orders`, { headers: { cookie } });
  const body = await response.json();
  assert.equal(response.status, 200, `order history failed: ${JSON.stringify(body)}`);
  return body.orders;
}

async function cancel(cookie, id) {
  const response = await fetch(`${baseUrl}/api/paper/orders/${id}`, { method: "DELETE", headers: { cookie } });
  return { response, body: await response.json() };
}

async function run() {
  await waitForServer();

  // Partial fill: a 4-unit taker fills 4 of a 10-unit resting ask.
  const sellerCookie = sessionCookie();
  const buyerCookie = sessionCookie();
  const ask = await submit(sellerCookie, { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", quantity: "10", limitPrice: "100" });
  const bid = await submit(buyerCookie, { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "4", limitPrice: "100" });
  assert.equal(bid.status, "FILLED");
  assert.equal(bid.filledQty, "4");
  const sellerOrders = await getOrders(sellerCookie);
  const updatedAsk = sellerOrders.find((order) => order.id === ask.id);
  assert.ok(updatedAsk, "resting ask should remain in seller history");
  assert.equal(updatedAsk.status, "PARTIALLY_FILLED");
  assert.equal(updatedAsk.filledQty, "4");

  // Price-time priority: oldest equal-price ask must be consumed first.
  const prioritySeller1 = sessionCookie();
  const prioritySeller2 = sessionCookie();
  const priorityBuyer = sessionCookie();
  const firstAsk = await submit(prioritySeller1, { symbol: "ETHUSDT", side: "SELL", type: "LIMIT", quantity: "2", limitPrice: "200" });
  await delay(20);
  const secondAsk = await submit(prioritySeller2, { symbol: "ETHUSDT", side: "SELL", type: "LIMIT", quantity: "2", limitPrice: "200" });
  await submit(priorityBuyer, { symbol: "ETHUSDT", side: "BUY", type: "LIMIT", quantity: "3", limitPrice: "200" });
  const firstAfter = (await getOrders(prioritySeller1)).find((order) => order.id === firstAsk.id);
  const secondAfter = (await getOrders(prioritySeller2)).find((order) => order.id === secondAsk.id);
  assert.equal(firstAfter.status, "FILLED", "oldest equal-price ask should fill first");
  assert.equal(secondAfter.status, "PARTIALLY_FILLED", "next ask should only receive the remainder");
  assert.equal(secondAfter.filledQty, "1");

  // Cancellation: only an active limit order belonging to the same session is cancellable.
  const cancelCookie = sessionCookie();
  const cancelOrder = await submit(cancelCookie, { symbol: "SOLUSDT", side: "BUY", type: "LIMIT", quantity: "1", limitPrice: "10" });
  const cancelResult = await cancel(cancelCookie, cancelOrder.id);
  assert.equal(cancelResult.response.status, 200, `cancellation failed: ${JSON.stringify(cancelResult.body)}`);
  assert.equal(cancelResult.body.order.status, "CANCELLED");
  const secondCancel = await cancel(cancelCookie, cancelOrder.id);
  assert.equal(secondCancel.response.status, 404, "already-cancelled order should not be cancellable again");
  const otherSession = await cancel(sessionCookie(), cancelOrder.id);
  assert.equal(otherSession.response.status, 404, "another session must not cancel this order");

  // Concurrent takers: the resting quantity must never be overfilled.
  const concurrentSeller = sessionCookie();
  const concurrentBuyerA = sessionCookie();
  const concurrentBuyerB = sessionCookie();
  const resting = await submit(concurrentSeller, { symbol: "BNBUSDT", side: "SELL", type: "LIMIT", quantity: "1", limitPrice: "300" });
  const concurrentResults = await Promise.all([
    fetch(`${baseUrl}/api/paper/orders`, { method: "POST", headers: { "content-type": "application/json", cookie: concurrentBuyerA }, body: JSON.stringify({ symbol: "BNBUSDT", side: "BUY", type: "LIMIT", quantity: "1", limitPrice: "300" }) }),
    fetch(`${baseUrl}/api/paper/orders`, { method: "POST", headers: { "content-type": "application/json", cookie: concurrentBuyerB }, body: JSON.stringify({ symbol: "BNBUSDT", side: "BUY", type: "LIMIT", quantity: "1", limitPrice: "300" }) }),
  ]);
  const concurrentBodies = await Promise.all(concurrentResults.map((response) => response.json()));
  assert.ok(concurrentResults.every((response) => [201, 409].includes(response.status)), `unexpected concurrent response: ${JSON.stringify(concurrentBodies)}`);
  const finalSellerOrders = await getOrders(concurrentSeller);
  const finalResting = finalSellerOrders.find((order) => order.id === resting.id);
  assert.ok(finalResting);
  assert.ok(Number(finalResting.filledQty) <= Number(finalResting.quantity), "concurrent requests must not overfill a resting order");
  const successfulBuyers = concurrentBodies.filter((body, index) => concurrentResults[index].status === 201);
  const buyerFillTotal = successfulBuyers.reduce((sum, body) => sum + Number(body.order.filledQty), 0);
  assert.ok(buyerFillTotal <= 1, "concurrent buyers must not collectively consume more than the resting quantity");

  console.log("Paper-order integration tests passed: partial fills, price-time priority, cancellation ownership, concurrent fill safety.");
}

try {
  await run();
} finally {
  server.kill("SIGTERM");
}
