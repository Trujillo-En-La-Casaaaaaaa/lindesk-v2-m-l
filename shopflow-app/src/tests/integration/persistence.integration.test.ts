import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { NotificationRecord } from "../../models/notification.js";
import type { Order } from "../../models/order.js";
import { OrderRepository } from "../../repositories/order.repository.js";
import { createTransactionRunner } from "../../repositories/transaction.js";
import { startIntegrationContext, type IntegrationContext } from "./harness.js";

/**
 * Persistence-level preservation: transaction boundaries, durability across an
 * application restart, and the unchanged schema/seed contract.
 */
let context: IntegrationContext;

before(async () => {
  context = await startIntegrationContext();
  await context.resetFixture();
});

after(async () => {
  await context.dispose();
});

describe("transaction and durability semantics", () => {
  it("performs the confirmation write after the transaction and keeps the legacy failure response", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-broken-log-"));
    const blocker = path.join(directory, "blocker");
    fs.writeFileSync(blocker, "not a directory");
    const broken = await startIntegrationContext({
      notificationFile: path.join(blocker, "nested", "notifications.jsonl"),
    });

    try {
      await broken.setStock("prod-a", 4);
      const response = await broken.postJson("/api/orders", {
        productId: "prod-a",
        quantity: 2,
        customerEmail: "notify-failure@example.com",
      });

      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Could not create order",
      });

      // The order itself was already completed before the confirmation was
      // attempted, so it stays persisted and the stock stays decremented.
      assert.equal(await broken.getStock("prod-a"), 2);
      const rows = await broken.query(
        "SELECT * FROM orders WHERE customer_email = $1",
        ["notify-failure@example.com"]
      );
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].status, "CONFIRMED");
      assert.equal(Number(rows.rows[0].total_cents), 3998);
    } finally {
      await broken.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back the stock decrement when the order row cannot be persisted", async () => {
    await context.query(
      "UPDATE products SET price_cents = 2000000000 WHERE id = 'prod-b'"
    );
    try {
      await context.setStock("prod-b", 10);
      const ordersBefore = await context.countOrders("prod-b");
      const notificationsBefore = context.notificationRecords().length;

      const response = await context.postJson("/api/orders", {
        productId: "prod-b",
        quantity: 2,
        customerEmail: "overflow@example.com",
      });

      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Could not create order",
      });
      assert.equal(await context.getStock("prod-b"), 10);
      assert.equal(await context.countOrders("prod-b"), ordersBefore);
      assert.equal(context.notificationRecords().length, notificationsBefore);
    } finally {
      await context.query(
        "UPDATE products SET price_cents = 999 WHERE id = 'prod-b'"
      );
    }
  });

  it("rolls back a partially applied transaction when the work fails", async () => {
    await context.setStock("prod-a", 5);
    const ordersBefore = await context.countOrders();
    const repository = new OrderRepository(context.pool);
    const transactions = createTransactionRunner(context.pool);

    await assert.rejects(
      transactions.run(async (transaction) => {
        const product = await repository.lockProductForUpdate(
          transaction,
          "prod-a"
        );
        assert.ok(product);
        await repository.decrementStock(transaction, "prod-a", 2);
        const inTransaction = await transaction.query(
          "SELECT stock FROM products WHERE id = $1",
          ["prod-a"]
        );
        assert.equal(Number(inTransaction.rows[0].stock), 3);
        throw new Error("induced failure");
      }),
      new Error("induced failure")
    );

    assert.equal(await context.getStock("prod-a"), 5);
    assert.equal(await context.countOrders(), ordersBefore);
  });

  it("keeps orders and notifications across an application restart", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-restart-"));
    const notificationFile = path.join(directory, "notifications.jsonl");
    let order: Order | undefined;
    let records: NotificationRecord[] | undefined;

    const first = await startIntegrationContext({ notificationFile });
    try {
      await first.setStock("prod-b", 6);
      const response = await first.postJson("/api/orders", {
        productId: "prod-b",
        quantity: 4,
        customerEmail: "restart@example.com",
      });
      assert.equal(response.status, 201);
      order = (await response.json()) as Order;
      records = first.notificationRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].orderId, order.id);
      assert.equal(await first.getStock("prod-b"), 2);
    } finally {
      await first.dispose();
    }

    assert.ok(order);
    assert.ok(records);

    const second = await startIntegrationContext({ notificationFile });
    try {
      assert.equal(await second.getStock("prod-b"), 2);

      const read = await second.fetchPath(`/api/orders/${order.id}`);
      assert.equal(read.status, 200);
      const persisted = (await read.json()) as Order;
      assert.equal(persisted.id, order.id);
      assert.equal(persisted.status, "CONFIRMED");
      assert.equal(persisted.quantity, 4);
      assert.equal(persisted.totalCents, 3996);
      assert.equal(persisted.createdAt, order.createdAt);
      assert.equal(persisted.customerEmail, "restart@example.com");

      assert.deepEqual(second.notificationRecords(), records);

      const listed = await second.fetchPath("/api/notifications");
      assert.equal(listed.status, 200);
      assert.deepEqual(await listed.json(), records);

      const page = await second.fetchPath(`/orders/${order.id}`);
      assert.equal(page.status, 200);
      assert.ok((await page.text()).includes(`<h1>Order ${order.id}</h1>`));
    } finally {
      await second.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the documented tables, columns and idempotent seed", async () => {
    const tables = await context.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["orders", "products"]
    );

    const columns = await context.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('orders', 'products')
      ORDER BY table_name, ordinal_position`);
    assert.deepEqual(
      columns.rows.map((row) => `${row.table_name}.${row.column_name}`),
      [
        "orders.id",
        "orders.customer_email",
        "orders.status",
        "orders.product_id",
        "orders.quantity",
        "orders.total_cents",
        "orders.created_at",
        "products.id",
        "products.name",
        "products.price_cents",
        "products.stock",
      ]
    );

    const checks = await context.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace"
    );
    const definitions = checks.rows
      .map((row) => String(row.definition))
      .join(" | ");
    for (const fragment of [
      "price_cents >= 0",
      "stock >= 0",
      "quantity > 0",
      "total_cents >= 0",
      "CONFIRMED",
      "SHIPPED",
    ]) {
      assert.ok(
        definitions.includes(fragment),
        `missing check constraint fragment ${fragment}`
      );
    }

    const seeded = await context.query(
      "SELECT id, name, price_cents FROM products WHERE id IN ('prod-a', 'prod-b') ORDER BY id"
    );
    assert.deepEqual(seeded.rows, [
      { id: "prod-a", name: "Product A", price_cents: 1999 },
      { id: "prod-b", name: "Product B", price_cents: 999 },
    ]);

    await context.setStock("prod-a", 3);
    await context.initializeSchema();
    assert.equal(await context.getStock("prod-a"), 3);
    const productCount = await context.query(
      "SELECT COUNT(*)::int AS count FROM products"
    );
    assert.equal(Number(productCount.rows[0].count), 2);
  });
});
