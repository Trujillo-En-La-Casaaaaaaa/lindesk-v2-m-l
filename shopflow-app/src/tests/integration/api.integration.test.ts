import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Order } from "../../models/order.js";
import type { Product } from "../../models/product.js";
import { startIntegrationContext, type IntegrationContext } from "./harness.js";

/**
 * JSON API contract over real HTTP against real PostgreSQL.
 */
let context: IntegrationContext;

before(async () => {
  context = await startIntegrationContext();
  await context.resetFixture();
});

after(async () => {
  await context.dispose();
});

const orderKeys = [
  "createdAt",
  "customerEmail",
  "id",
  "productId",
  "quantity",
  "status",
  "totalCents",
];

describe("JSON API over real persistence", () => {
  it("GET /api/health returns the health payload", async () => {
    const response = await context.fetchPath("/api/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it("AC-1 GET /api/products returns the seeded catalog ordered by id", async () => {
    const response = await context.fetchPath("/api/products");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);

    const products = (await response.json()) as Product[];
    const ids = products.map((product) => product.id);
    assert.deepEqual(ids, [...ids].sort());
    assert.deepEqual(
      products.filter(
        (product) => product.id === "prod-a" || product.id === "prod-b"
      ),
      [
        { id: "prod-a", name: "Product A", priceCents: 1999, stock: 20 },
        { id: "prod-b", name: "Product B", priceCents: 999, stock: 10 },
      ]
    );
    for (const product of products) {
      assert.deepEqual(Object.keys(product).sort(), [
        "id",
        "name",
        "priceCents",
        "stock",
      ]);
    }
  });

  it("AC-2 GET /api/products/:id returns the current stock and 404 for unknown ids", async () => {
    await context.setStock("prod-a", 7);

    const found = await context.fetchPath("/api/products/prod-a");
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), {
      id: "prod-a",
      name: "Product A",
      priceCents: 1999,
      stock: 7,
    });

    const missing = await context.fetchPath("/api/products/prod-missing");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
  });

  it("AC-5/AC-4 creates a confirmed order, decrements stock by the quantity and persists the row", async () => {
    await context.setStock("prod-a", 20);

    const response = await context.postJson("/api/orders", {
      productId: "prod-a",
      quantity: 3,
      customerEmail: "buyer@example.com",
    });
    assert.equal(response.status, 201);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);

    const order = (await response.json()) as Order;
    assert.deepEqual(Object.keys(order).sort(), orderKeys);
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.quantity, 3);
    assert.equal(order.productId, "prod-a");
    assert.equal(order.customerEmail, "buyer@example.com");
    assert.equal(order.totalCents, 1999 * 3);
    assert.match(order.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(order.createdAt).toISOString(), order.createdAt);

    assert.equal(await context.getStock("prod-a"), 17);

    const stored = await context.query("SELECT * FROM orders WHERE id = $1", [
      order.id,
    ]);
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0].customer_email, "buyer@example.com");
    assert.equal(stored.rows[0].status, "CONFIRMED");
    assert.equal(stored.rows[0].product_id, "prod-a");
    assert.equal(Number(stored.rows[0].quantity), 3);
    assert.equal(Number(stored.rows[0].total_cents), 5997);
    // The preserved mapping renders `created_at` through `new Date(String(...))`,
    // so the serialized timestamp keeps the legacy second precision.
    assert.equal(
      new Date(order.createdAt).getTime(),
      Math.floor(new Date(stored.rows[0].created_at).getTime() / 1000) * 1000
    );
    assert.match(order.createdAt, /\.000Z$/);
  });

  it("AC-3 rejects an order larger than the stock and leaves the stock unchanged", async () => {
    await context.setStock("prod-a", 5);
    const ordersBefore = await context.countOrders("prod-a");
    const notificationsBefore = context.notificationRecords().length;

    const response = await context.postJson("/api/orders", {
      productId: "prod-a",
      quantity: 6,
      customerEmail: "too-many@example.com",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Insufficient stock" });

    assert.equal(await context.getStock("prod-a"), 5);
    assert.equal(await context.countOrders("prod-a"), ordersBefore);
    assert.equal(context.notificationRecords().length, notificationsBefore);
  });

  it("rejects an order for an unknown product without changing any state", async () => {
    const ordersBefore = await context.countOrders();
    const notificationsBefore = context.notificationRecords().length;

    const response = await context.postJson("/api/orders", {
      productId: "prod-missing",
      quantity: 1,
      customerEmail: "unknown@example.com",
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Product not found" });
    assert.equal(await context.countOrders(), ordersBefore);
    assert.equal(context.notificationRecords().length, notificationsBefore);
  });

  it("AC-9 rejects invalid order input with the preserved error message", async () => {
    await context.setStock("prod-a", 20);
    const stockBefore = await context.getStock("prod-a");
    const ordersBefore = await context.countOrders();
    const invalidBodies: Record<string, unknown>[] = [
      { productId: "prod-a", quantity: 1 },
      { productId: "prod-a", quantity: 0, customerEmail: "buyer@example.com" },
      { productId: "prod-a", quantity: 1.5, customerEmail: "buyer@example.com" },
      { productId: "prod-a", quantity: "abc", customerEmail: "buyer@example.com" },
      { productId: "prod-a", quantity: 1, customerEmail: "   " },
      { quantity: 1, customerEmail: "buyer@example.com" },
      {},
    ];

    for (const body of invalidBodies) {
      const response = await context.postJson("/api/orders", body);
      assert.equal(response.status, 400, `body ${JSON.stringify(body)}`);
      assert.deepEqual(await response.json(), { error: "Invalid order" });
    }

    assert.equal(await context.getStock("prod-a"), stockBefore);
    assert.equal(await context.countOrders(), ordersBefore);
  });

  it("AC-6 GET /api/orders/:id returns the created order and 404 for unknown ids", async () => {
    const created = await context.postJson("/api/orders", {
      productId: "prod-b",
      quantity: 2,
      customerEmail: "detail@example.com",
    });
    assert.equal(created.status, 201);
    const order = (await created.json()) as Order;

    const found = await context.fetchPath(`/api/orders/${order.id}`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), order);

    const missing = await context.fetchPath("/api/orders/order-does-not-exist");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
  });

  it("AC-7 ships a confirmed order once, rejects the second attempt and reports SHIPPED", async () => {
    const created = await context.postJson("/api/orders", {
      productId: "prod-a",
      quantity: 1,
      customerEmail: "ship@example.com",
    });
    const order = (await created.json()) as Order;
    const stockAfterOrder = await context.getStock("prod-a");

    const shipped = await context.postJson(`/api/orders/${order.id}/ship`);
    assert.equal(shipped.status, 200);
    const shippedOrder = (await shipped.json()) as Order;
    assert.equal(shippedOrder.status, "SHIPPED");
    assert.equal(shippedOrder.id, order.id);
    assert.equal(shippedOrder.quantity, order.quantity);
    assert.equal(shippedOrder.totalCents, order.totalCents);
    assert.equal(shippedOrder.createdAt, order.createdAt);

    const second = await context.postJson(`/api/orders/${order.id}/ship`);
    assert.equal(second.status, 400);
    assert.deepEqual(await second.json(), { error: "Cannot ship order" });

    const read = await context.fetchPath(`/api/orders/${order.id}`);
    const current = (await read.json()) as Order;
    assert.equal(current.status, "SHIPPED");

    const unknown = await context.postJson("/api/orders/order-does-not-exist/ship");
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: "Cannot ship order" });

    assert.equal(await context.getStock("prod-a"), stockAfterOrder);
  });

  it("AC-8 appends exactly one confirmation per order and serves it through the API", async () => {
    const notificationsBefore = context.notificationRecords().length;

    const created = await context.postJson("/api/orders", {
      productId: "prod-a",
      quantity: 1,
      customerEmail: "notify@example.com",
    });
    const order = (await created.json()) as Order;

    const records = context.notificationRecords();
    assert.equal(records.length, notificationsBefore + 1);
    const record = records[records.length - 1];
    assert.equal(record.type, "ORDER_CONFIRMATION");
    assert.equal(record.orderId, order.id);
    assert.equal(record.payload.orderId, order.id);
    assert.equal(record.payload.customerEmail, "notify@example.com");
    assert.equal(new Date(record.createdAt).toISOString(), record.createdAt);
    assert.deepEqual(Object.keys(record).sort(), [
      "createdAt",
      "id",
      "orderId",
      "payload",
      "type",
    ]);

    const listed = await context.fetchPath("/api/notifications");
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), records);
  });
});

describe("express defaults", () => {
  it("keeps the default handling of unhandled routes and malformed bodies", async () => {
    const unhandled = await context.fetchPath("/api/unknown");
    assert.equal(unhandled.status, 404);
    assert.match(await unhandled.text(), /Cannot GET \/api\/unknown/);

    const unhandledPage = await context.fetchPath("/unknown");
    assert.equal(unhandledPage.status, 404);
    assert.match(await unhandledPage.text(), /Cannot GET \/unknown/);

    const malformed = await context.fetchPath("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(malformed.status, 400);

    const health = await context.fetchPath("/api/health");
    assert.deepEqual(await health.json(), { ok: true });
  });
});

describe("database error paths", () => {
  let broken: IntegrationContext;

  before(async () => {
    broken = await startIntegrationContext({
      databaseUrl: "postgres://shopflow:shopflow@127.0.0.1:1/shopflow",
      initializeSchema: false,
    });
  });

  after(async () => {
    await broken.dispose();
  });

  it("reports the documented 500 responses while the health route keeps working", async () => {
    const health = await broken.fetchPath("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const catalog = await broken.fetchPath("/api/products");
    assert.equal(catalog.status, 500);
    assert.deepEqual(await catalog.json(), { error: "Database error" });

    const product = await broken.fetchPath("/api/products/prod-a");
    assert.equal(product.status, 500);
    assert.deepEqual(await product.json(), { error: "Database error" });

    const order = await broken.fetchPath("/api/orders/order-1");
    assert.equal(order.status, 500);
    assert.deepEqual(await order.json(), { error: "Database error" });

    const create = await broken.postJson("/api/orders", {
      productId: "prod-a",
      quantity: 1,
      customerEmail: "buyer@example.com",
    });
    assert.equal(create.status, 500);
    assert.deepEqual(await create.json(), { error: "Could not create order" });

    const ship = await broken.postJson("/api/orders/order-1/ship");
    assert.equal(ship.status, 500);
    assert.deepEqual(await ship.json(), { error: "Database error" });

    const notifications = await broken.fetchPath("/api/notifications");
    assert.equal(notifications.status, 200);
    assert.deepEqual(await notifications.json(), []);
  });
});
