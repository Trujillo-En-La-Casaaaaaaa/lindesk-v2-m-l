import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Order } from "../models/order.js";
import type { Product } from "../models/product.js";
import { renderCatalogPage } from "./catalog.view.js";
import { escapeHtml } from "./html.js";
import { renderOrderDetailPage } from "./order-detail.view.js";
import { renderOrderFormPage } from "./order-form.view.js";
import { renderProductPage } from "./product.view.js";

const productA: Product = {
  id: "prod-a",
  name: "Product A",
  priceCents: 1999,
  stock: 20,
};

const productB: Product = {
  id: "prod-b",
  name: "Product B",
  priceCents: 999,
  stock: 10,
};

const confirmedOrder: Order = {
  id: "order-1",
  customerEmail: "buyer@example.com",
  status: "CONFIRMED",
  productId: "prod-a",
  quantity: 2,
  totalCents: 3998,
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("escapeHtml", () => {
  it("replaces the documented characters in order", () => {
    assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes ampersands before the other replacements", () => {
    assert.equal(escapeHtml("<a & b>"), "&lt;a &amp; b&gt;");
  });

  it("stringifies non-string values", () => {
    assert.equal(escapeHtml(1999), "1999");
  });
});

describe("catalog view", () => {
  it("renders the preserved catalog markup for both products", () => {
    assert.equal(
      renderCatalogPage([productA, productB]),
      `<!doctype html><html><head><title>ShopFlow Legacy</title></head>
<body><h1>ShopFlow Legacy Catalog</h1><table border="1">
<tr><th>ID</th><th>Name</th><th>Price (cents)</th><th>Stock</th><th></th></tr><tr><td>prod-a</td><td>Product A</td><td>1999</td><td>20</td><td><a href="/products/prod-a">View</a></td></tr><tr><td>prod-b</td><td>Product B</td><td>999</td><td>10</td><td><a href="/products/prod-b">View</a></td></tr>
</table><p><a href="/orders/new">Create order</a></p></body></html>`
    );
  });

  it("escapes product names and encodes view links", () => {
    const html = renderCatalogPage([
      { id: "prod/<a>", name: `<script>alert("x")</script>`, priceCents: 1, stock: 2 },
    ]);
    assert.ok(html.includes("<td>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</td>"));
    assert.ok(html.includes('href="/products/prod%2F%3Ca%3E"'));
  });
});

describe("product detail view", () => {
  it("renders the preserved product markup", () => {
    assert.equal(
      renderProductPage(productA),
      `<!doctype html><html><body><h1>Product A</h1>
<p>ID: prod-a</p><p>Price: 1999 cents</p>
<p>Stock: 20</p><p><a href="/">Back</a></p></body></html>`
    );
  });

  it("escapes the product name", () => {
    assert.ok(
      renderProductPage({ ...productA, name: "<b>x</b>" }).includes(
        "<h1>&lt;b&gt;x&lt;/b&gt;</h1>"
      )
    );
  });
});

describe("order form view", () => {
  it("renders the preserved form markup", () => {
    assert.equal(
      renderOrderFormPage([productA, productB]),
      `<!doctype html><html><body><h1>Create order</h1>
<form method="POST" action="/orders"><label>Product <select name="productId"><option value="prod-a">Product A (stock 20)</option><option value="prod-b">Product B (stock 10)</option></select></label><br>
<label>Quantity <input name="quantity" type="number" value="1" min="1"></label><br>
<label>Email <input name="customerEmail" type="email" required></label><br>
<button type="submit">Place order</button></form></body></html>`
    );
  });
});

describe("order detail view", () => {
  it("renders the preserved detail markup with the ship form for confirmed orders", () => {
    assert.equal(
      renderOrderDetailPage(confirmedOrder),
      `<!doctype html><html><body><h1>Order order-1</h1>
<dl><dt>Status</dt><dd>CONFIRMED</dd><dt>Product</dt><dd>prod-a</dd>
<dt>Quantity</dt><dd>2</dd><dt>Total</dt><dd>3998 cents</dd>
<dt>Customer</dt><dd>buyer@example.com</dd></dl><form method="POST" action="/orders/order-1/ship"><button type="submit">Mark SHIPPED</button></form>
<p><a href="/">Home</a></p></body></html>`
    );
  });

  it("omits the ship form for shipped orders", () => {
    const html = renderOrderDetailPage({ ...confirmedOrder, status: "SHIPPED" });
    assert.ok(!html.includes("Mark SHIPPED"));
    assert.ok(html.includes("<dd>SHIPPED</dd>"));
  });

  it("escapes order and customer values and never escapes numbers", () => {
    const html = renderOrderDetailPage({
      ...confirmedOrder,
      id: "order-1",
      productId: "<prod>",
      customerEmail: `a&b<c>"d"'e'`,
    });
    assert.ok(html.includes("<dd>&lt;prod&gt;</dd>"));
    assert.ok(html.includes("<dd>a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;</dd>"));
    assert.ok(html.includes("<dd>3998 cents</dd>"));
  });
});
