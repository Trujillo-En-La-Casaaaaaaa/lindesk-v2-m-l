import type pg from "pg";
import { productFromRow, type Product } from "../models/product.js";

/**
 * Persistence: product rows. Statements only, no business decisions.
 */
export class ProductRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listAll(): Promise<Product[]> {
    const result = await this.pool.query("SELECT * FROM products ORDER BY id");
    return result.rows.map(productFromRow);
  }

  async findById(id: string): Promise<Product | null> {
    const result = await this.pool.query("SELECT * FROM products WHERE id = $1", [
      id,
    ]);
    return result.rows[0] ? productFromRow(result.rows[0]) : null;
  }
}
