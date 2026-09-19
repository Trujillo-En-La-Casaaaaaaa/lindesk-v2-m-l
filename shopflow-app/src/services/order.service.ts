import type { Order } from "../models/order.js";
import type { OrderInput } from "../models/order-input.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { TransactionRunner } from "../repositories/transaction.js";
import type { NotificationService } from "./notification.service.js";

export type CreateOrderOutcome =
  | { status: "created"; order: Order }
  | { status: "product-not-found" }
  | { status: "insufficient-stock" };

class ProductNotFoundError extends Error {}
class InsufficientStockError extends Error {}

/**
 * Application service: order lifecycle.
 *
 * Owns the order-creation transaction boundary: the product row is locked,
 * stock is checked and decremented, and the confirmed order is persisted as one
 * atomic unit (rolled back when it fails). The confirmation notification is
 * emitted only after that unit has been completed, outside of it.
 *
 * The order input rule is applied by the presentation layer before this
 * service is called, so `createOrder` always receives a validated `OrderInput`.
 */
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly notifications: NotificationService,
    private readonly transactions: TransactionRunner
  ) {}

  async createOrder(input: OrderInput): Promise<CreateOrderOutcome> {
    try {
      const order = await this.transactions.run(async (context) => {
        const product = await this.orders.lockProductForUpdate(
          context,
          input.productId
        );
        if (!product) {
          throw new ProductNotFoundError();
        }
        if (product.stock < input.quantity) {
          throw new InsufficientStockError();
        }
        await this.orders.decrementStock(context, input.productId, input.quantity);
        return this.orders.insertConfirmedOrder(context, {
          customerEmail: input.customerEmail,
          productId: input.productId,
          quantity: input.quantity,
          totalCents: product.priceCents * input.quantity,
        });
      });
      this.notifications.emitOrderConfirmation(order);
      return { status: "created", order };
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return { status: "product-not-found" };
      }
      if (error instanceof InsufficientStockError) {
        return { status: "insufficient-stock" };
      }
      throw error;
    }
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.orders.findById(id);
  }

  /**
   * Returns the shipped order, or `null` when there is no `CONFIRMED` order to
   * ship (the conditional write itself is the decision point, so concurrent
   * ship attempts cannot both succeed).
   */
  async shipOrder(id: string): Promise<Order | null> {
    return this.orders.markShipped(id);
  }
}
