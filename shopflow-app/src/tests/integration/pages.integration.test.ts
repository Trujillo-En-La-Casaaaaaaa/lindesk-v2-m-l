import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startIntegrationContext, type IntegrationContext } from "./harness.js";

/**
 * Server-rendered HTML contract over real HTTP against real PostgreSQL.
 */
let context: IntegrationContext;

before(async () => {
  context = await startIntegrationContext();
  await context.resetFixture();
});

after(async () => {
  await context.dispose();
});

describe("server-rendered pages", () => {
  it("AC-1/AC-10 GET / renders the seeded catalog markup", async () => {
    const response = await context.fetchPath("/");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();

    for (const fragment of [
      "<title>ShopFlow Legacy</title>",
      "<h1>ShopFlow Legacy Catalog</h1>",
      '<table border="1">',
      "<th>ID</th>",
      "<th>Name</th>",
      "<th>Price (cents)</th>",
      "<th>Stock</th>",
      '<a href="/products/prod-a">View</a>',
      '<a href="/products/prod-b">View</a>',
      '<a href="/orders/new">Create order</a>',
    ]) {
      assert.ok(html.includes(fragment), `catalog page is missing ${fragment}`);
    }

    assert.equal(
      html,
      `<!doctype html><html><head><title>ShopFlow Legacy</title></head>
<body><h1>ShopFlow Legacy Catalog</h1><table border="1">
<tr><th>ID</th><th>Name</th><th>Price (cents)</th><th>Stock</th><th></th></tr><tr><td>prod-a</td><td>Product A</td><td>1999</td><td>20</td><td><a href="/products/prod-a">View</a></td></tr><tr><td>prod-b</td><td>Product B</td><td>999</td><td>10</td><td><a href="/products/prod-b">View</a></td></tr>
</table><p><a href="/orders/new">Create order</a></p></body></html>`
    );
  });

  it("AC-10 GET /products/:id renders the product page and 404s for unknown ids", async () => {
    const response = await context.fetchPath("/products/prod-b");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();

    for (const fragment of [
      "<h1>Product B</h1>",
      "ID: prod-b",
      "Price: 999 cents",
      "Stock: 10",
      '<a href="/">Back</a>',
    ]) {
      assert.ok(html.includes(fragment), `product page is missing ${fragment}`);
    }

    const missing = await context.fetchPath("/products/prod-missing");
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "Not found");
  });

  it("AC-10 GET /orders/new renders the order form with the seeded options", async () => {
    const response = await context.fetchPath("/orders/new");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();

    for (const fragment of [
      "<h1>Create order</h1>",
      '<form method="POST" action="/orders">',
      '<select name="productId">',
      '<option value="prod-a">Product A (stock 20)</option>',
      '<option value="prod-b">Product B (stock 10)</option>',
      '<input name="quantity" type="number" value="1" min="1">',
      '<input name="customerEmail" type="email" required>',
      ">Place order</button>",
    ]) {
      assert.ok(html.includes(fragment), `order form is missing ${fragment}`);
    }
  });

  it("AC-10 POST /orders redirects to the order page, which shows the ship form while CONFIRMED", async () => {
    await context.setStock("prod-a", 20);

    const created = await context.postForm("/orders", {
      productId: "prod-a",
      quantity: 2,
      customerEmail: "buyer@example.com",
    });
    assert.equal(created.status, 302);

    const orderId = await createdOrderId(context);
    assert.equal(created.headers.get("location"), `/orders/${orderId}`);
    assert.equal(await context.getStock("prod-a"), 18);

    const detail = await context.fetchPath(`/orders/${orderId}`);
    assert.equal(detail.status, 200);
    assert.match(detail.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(
      await detail.text(),
      `<!doctype html><html><body><h1>Order ${orderId}</h1>
<dl><dt>Status</dt><dd>CONFIRMED</dd><dt>Product</dt><dd>prod-a</dd>
<dt>Quantity</dt><dd>2</dd><dt>Total</dt><dd>3998 cents</dd>
<dt>Customer</dt><dd>buyer@example.com</dd></dl><form method="POST" action="/orders/${orderId}/ship"><button type="submit">Mark SHIPPED</button></form>
<p><a href="/">Home</a></p></body></html>`
    );

    const shipped = await context.postForm(`/orders/${orderId}/ship`, {});
    assert.equal(shipped.status, 302);
    assert.equal(shipped.headers.get("location"), `/orders/${orderId}`);

    const afterShip = await context.fetchPath(`/orders/${orderId}`);
    const html = await afterShip.text();
    assert.ok(html.includes("<dd>SHIPPED</dd>"));
    assert.ok(!html.includes("Mark SHIPPED"));
    assert.ok(html.includes('<a href="/">Home</a>'));

    const secondShip = await context.postForm(`/orders/${orderId}/ship`, {});
    assert.equal(secondShip.status, 400);
    assert.equal(await secondShip.text(), "Cannot ship order");
  });

  it("AC-10 escapes HTML-unsafe customer input on the order page", async () => {
    const unsafeEmail = `a&b<c>"d"'e'@example.com`;
    const created = await context.postForm("/orders", {
      productId: "prod-a",
      quantity: 1,
      customerEmail: unsafeEmail,
    });
    assert.equal(created.status, 302);
    const orderId = await createdOrderId(context);

    const detail = await context.fetchPath(`/orders/${orderId}`);
    const html = await detail.text();
    assert.ok(
      html.includes("<dd>a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;@example.com</dd>")
    );
    assert.ok(!html.includes("<c>"));
    assert.ok(!html.includes('"d"'));
  });

  it("AC-9/§8 HTML failure paths keep their status codes and plain text bodies", async () => {
    await context.setStock("prod-a", 3);

    const invalid = await context.postForm("/orders", {
      productId: "prod-a",
      quantity: 0,
      customerEmail: "buyer@example.com",
    });
    assert.equal(invalid.status, 400);
    assert.equal(await invalid.text(), "Invalid order");

    const insufficient = await context.postForm("/orders", {
      productId: "prod-a",
      quantity: 4,
      customerEmail: "buyer@example.com",
    });
    assert.equal(insufficient.status, 400);
    assert.equal(await insufficient.text(), "Insufficient stock");

    const unknownProduct = await context.postForm("/orders", {
      productId: "prod-missing",
      quantity: 1,
      customerEmail: "buyer@example.com",
    });
    assert.equal(unknownProduct.status, 404);
    assert.equal(await unknownProduct.text(), "Product not found");

    const unknownOrder = await context.fetchPath("/orders/order-does-not-exist");
    assert.equal(unknownOrder.status, 404);
    assert.equal(await unknownOrder.text(), "Not found");

    const unknownShip = await context.postForm(
      "/orders/order-does-not-exist/ship",
      {}
    );
    assert.equal(unknownShip.status, 400);
    assert.equal(await unknownShip.text(), "Cannot ship order");

    assert.equal(await context.getStock("prod-a"), 3);
  });
});

async function createdOrderId(context: IntegrationContext): Promise<string> {
  const result = await context.query(
    "SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1"
  );
  assert.equal(result.rowCount, 1);
  return String(result.rows[0].id);
}
