import type { Order } from "../models/order.js";
import { escapeHtml } from "./html.js";

/**
 * Presentation: order detail page, including the administrative ship form that
 * is rendered only while the order is `CONFIRMED`.
 */
export function renderOrderDetailPage(order: Order): string {
  const shipForm =
    order.status === "CONFIRMED"
      ? `<form method="POST" action="/orders/${encodeURIComponent(order.id)}/ship">` +
        `<button type="submit">Mark SHIPPED</button></form>`
      : "";
  return `<!doctype html><html><body><h1>Order ${escapeHtml(order.id)}</h1>
<dl><dt>Status</dt><dd>${order.status}</dd><dt>Product</dt><dd>${escapeHtml(order.productId)}</dd>
<dt>Quantity</dt><dd>${order.quantity}</dd><dt>Total</dt><dd>${order.totalCents} cents</dd>
<dt>Customer</dt><dd>${escapeHtml(order.customerEmail)}</dd></dl>${shipForm}
<p><a href="/">Home</a></p></body></html>`;
}
