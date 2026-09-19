import type { Product } from "../models/product.js";
import { escapeHtml } from "./html.js";

/**
 * Presentation: product detail page.
 */
export function renderProductPage(product: Product): string {
  return `<!doctype html><html><body><h1>${escapeHtml(product.name)}</h1>
<p>ID: ${escapeHtml(product.id)}</p><p>Price: ${product.priceCents} cents</p>
<p>Stock: ${product.stock}</p><p><a href="/">Back</a></p></body></html>`;
}
