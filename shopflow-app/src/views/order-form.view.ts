import type { Product } from "../models/product.js";
import { escapeHtml } from "./html.js";

/**
 * Presentation: order creation form page.
 */
export function renderOrderFormPage(products: Product[]): string {
  const options = products
    .map(
      (product) =>
        `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} ` +
        `(stock ${product.stock})</option>`
    )
    .join("");
  return `<!doctype html><html><body><h1>Create order</h1>
<form method="POST" action="/orders"><label>Product <select name="productId">${options}</select></label><br>
<label>Quantity <input name="quantity" type="number" value="1" min="1"></label><br>
<label>Email <input name="customerEmail" type="email" required></label><br>
<button type="submit">Place order</button></form></body></html>`;
}
