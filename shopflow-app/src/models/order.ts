/**
 * Domain model: customer order.
 *
 * Pure data and row mapping only: no I/O, no framework imports.
 */
export type OrderStatus = "CONFIRMED" | "SHIPPED";

export type Order = {
  id: string;
  customerEmail: string;
  status: OrderStatus;
  productId: string;
  quantity: number;
  totalCents: number;
  createdAt: string;
};

export function orderFromRow(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    customerEmail: String(row.customer_email),
    status: row.status as OrderStatus,
    productId: String(row.product_id),
    quantity: Number(row.quantity),
    totalCents: Number(row.total_cents),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
