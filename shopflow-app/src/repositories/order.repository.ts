import { randomUUID } from "node:crypto";
import type pg from "pg";
import { orderFromRow, type Order } from "../models/order.js";
import { productFromRow, type Product } from "../models/product.js";
import type { TransactionContext } from "./transaction.js";

export interface NewConfirmedOrder {
  customerEmail: string;
  productId: string;
  quantity: number;
  totalCents: number;
}

/**
 * Persistence: order rows, including the statements that make up the
 * order-creation transaction. Statements only, no business decisions.
 */
export class OrderRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<Order | null> {
    const result = await this.pool.query("SELECT * FROM orders WHERE id = $1", [
      id,
    ]);
    return result.rows[0] ? orderFromRow(result.rows[0]) : null;
  }

  async markShipped(id: string): Promise<Order | null> {
    const result = await this.pool.query(
      `UPDATE orders SET status = 'SHIPPED'
       WHERE id = $1 AND status = 'CONFIRMED'
       RETURNING *`,
      [id]
    );
    return result.rows[0] ? orderFromRow(result.rows[0]) : null;
  }

  /** Locks the product row for the duration of the surrounding transaction. */
  async lockProductForUpdate(
    context: TransactionContext,
    productId: string
  ): Promise<Product | null> {
    const result = await context.query(
      "SELECT * FROM products WHERE id = $1 FOR UPDATE",
      [productId]
    );
    return result.rows[0] ? productFromRow(result.rows[0]) : null;
  }

  async decrementStock(
    context: TransactionContext,
    productId: string,
    quantity: number
  ): Promise<void> {
    await context.query("UPDATE products SET stock = stock - $2 WHERE id = $1", [
      productId,
      quantity,
    ]);
  }

  async insertConfirmedOrder(
    context: TransactionContext,
    order: NewConfirmedOrder
  ): Promise<Order> {
    const result = await context.query(
      `INSERT INTO orders
        (id, customer_email, status, product_id, quantity, total_cents)
       VALUES ($1, $2, 'CONFIRMED', $3, $4, $5)
       RETURNING *`,
      [
        randomUUID(),
        order.customerEmail,
        order.productId,
        order.quantity,
        order.totalCents,
      ]
    );
    return orderFromRow(result.rows[0]);
  }
}
