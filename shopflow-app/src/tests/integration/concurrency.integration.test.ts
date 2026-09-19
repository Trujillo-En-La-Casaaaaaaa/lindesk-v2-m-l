import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Order } from "../../models/order.js";
import { startIntegrationContext, type IntegrationContext } from "./harness.js";

/**
 * Concurrency: the preserved in-process transaction with `SELECT ... FOR UPDATE`
 * is the only concurrency control, so competing requests must serialize.
 */
let context: IntegrationContext;

before(async () => {
  context = await startIntegrationContext();
  await context.resetFixture();
});

after(async () => {
  await context.dispose();
});

describe("row-level locking", () => {
  it("§5 two competing orders cannot oversell the last unit", async () => {
    await context.setStock("prod-b", 1);
    const ordersBefore = await context.countOrders("prod-b");
    const notificationsBefore = context.notificationRecords().length;

    const [first, second] = await Promise.all([
      context.postJson("/api/orders", {
        productId: "prod-b",
        quantity: 1,
        customerEmail: "race-a@example.com",
      }),
      context.postJson("/api/orders", {
        productId: "prod-b",
        quantity: 1,
        customerEmail: "race-b@example.com",
      }),
    ]);

    assert.deepEqual([first.status, second.status].sort(), [201, 400]);
    const rejected = first.status === 400 ? first : second;
    assert.deepEqual(await rejected.json(), { error: "Insufficient stock" });

    const accepted = first.status === 201 ? first : second;
    const order = (await accepted.json()) as Order;
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.quantity, 1);

    assert.equal(await context.getStock("prod-b"), 0);
    assert.equal(await context.countOrders("prod-b"), ordersBefore + 1);
    assert.equal(context.notificationRecords().length, notificationsBefore + 1);

    const rows = await context.query(
      "SELECT id FROM orders WHERE product_id = 'prod-b' ORDER BY created_at"
    );
    assert.equal(rows.rowCount, ordersBefore + 1);
  });

  it("§5 concurrent orders that fit are all accepted with exact decrements", async () => {
    await context.setStock("prod-a", 12);
    const notificationsBefore = context.notificationRecords().length;

    const responses = await Promise.all(
      [1, 2, 3, 4].map((attempt) =>
        context.postJson("/api/orders", {
          productId: "prod-a",
          quantity: 2,
          customerEmail: `parallel-${attempt}@example.com`,
        })
      )
    );

    for (const response of responses) {
      assert.equal(response.status, 201);
    }
    assert.equal(await context.getStock("prod-a"), 4);

    const created = await Promise.all(
      responses.map((response) => response.json() as Promise<Order>)
    );
    assert.equal(new Set(created.map((order) => order.id)).size, 4);
    assert.equal(
      context.notificationRecords().length,
      notificationsBefore + 4
    );
    assert.equal(await context.countOrders("prod-a"), 4);
  });

  it("§6 a concurrent double ship succeeds exactly once", async () => {
    const created = await context.postJson("/api/orders", {
      productId: "prod-a",
      quantity: 1,
      customerEmail: "ship-race@example.com",
    });
    assert.equal(created.status, 201);
    const order = (await created.json()) as Order;

    const [first, second] = await Promise.all([
      context.postJson(`/api/orders/${order.id}/ship`),
      context.postJson(`/api/orders/${order.id}/ship`),
    ]);

    assert.deepEqual([first.status, second.status].sort(), [200, 400]);
    const rejected = first.status === 400 ? first : second;
    assert.deepEqual(await rejected.json(), { error: "Cannot ship order" });

    const accepted = first.status === 200 ? first : second;
    const shipped = (await accepted.json()) as Order;
    assert.equal(shipped.status, "SHIPPED");

    const read = await context.fetchPath(`/api/orders/${order.id}`);
    const current = (await read.json()) as Order;
    assert.equal(current.status, "SHIPPED");

    const rows = await context.query(
      "SELECT COUNT(*)::int AS count FROM orders WHERE id = $1 AND status = 'SHIPPED'",
      [order.id]
    );
    assert.equal(Number(rows.rows[0].count), 1);
  });
});
