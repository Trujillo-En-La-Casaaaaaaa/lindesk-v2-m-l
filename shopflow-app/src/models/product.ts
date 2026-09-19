/**
 * Domain model: product catalog entry.
 *
 * Pure data and row mapping only: no I/O, no framework imports.
 */
export type Product = {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
};

export function productFromRow(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.name),
    priceCents: Number(row.price_cents),
    stock: Number(row.stock),
  };
}
