/**
 * Domain rule: order request shape.
 *
 * Pure validation only: no I/O, no framework imports.
 */
export type OrderInput = {
  productId: string;
  quantity: number;
  customerEmail: string;
};

export function validateOrderInput(body: Record<string, unknown>): OrderInput {
  const input = {
    productId: String(body.productId ?? ""),
    quantity: Number(body.quantity),
    customerEmail: String(body.customerEmail ?? "").trim(),
  };
  if (
    !input.productId ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    !input.customerEmail
  ) {
    throw new Error("Invalid order");
  }
  return input;
}
