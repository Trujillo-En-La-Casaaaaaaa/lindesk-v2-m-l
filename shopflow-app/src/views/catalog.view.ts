import type { Product } from "../models/product.js";
import { escapeHtml } from "./html.js";

/**
 * Presentation: catalog page.
 */
export function renderCatalogPage(products: Product[]): string {
  const rows = products
    .map(
      (product) =>
        `<tr><td>${escapeHtml(product.id)}</td><td>${escapeHtml(product.name)}</td>` +
        `<td>${product.priceCents}</td><td>${product.stock}</td>` +
        `<td><a href="/products/${encodeURIComponent(product.id)}">View</a></td></tr>`
    )
    .join("");
  return `<!doctype html><html><head><title>ShopFlow Legacy</title></head>
<body><h1>ShopFlow Legacy Catalog</h1><table border="1">
<tr><th>ID</th><th>Name</th><th>Price (cents)</th><th>Stock</th><th></th></tr>${rows}
</table><p><a href="/orders/new">Create order</a></p></body></html>`;
}
