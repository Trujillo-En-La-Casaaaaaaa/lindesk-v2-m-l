import type pg from "pg";

/**
 * Persistence: idempotent schema bootstrap (tables plus seed rows) executed by
 * the composition root at startup. There are no migration files.
 */
export async function initializeDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_email TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'SHIPPED')),
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO products (id, name, price_cents, stock) VALUES
      ('prod-a', 'Product A', 1999, 20),
      ('prod-b', 'Product B', 999, 10)
    ON CONFLICT (id) DO NOTHING
  `);
}
