import { Router } from "express";
import type { Order } from "../models/order.js";
import { validateOrderInput, type OrderInput } from "../models/order-input.js";
import type { OrderService } from "../services/order.service.js";

/**
 * HTTP translation for order creation, in both the JSON and the page form.
 */
export interface OrderRouteDependencies {
  orders: OrderService;
}

interface CreateOrderResponder {
  invalidOrder(): void;
  productNotFound(): void;
  insufficientStock(): void;
  created(order: Order): void;
  failed(error: unknown): void;
}

async function handleCreateOrder(
  orders: OrderService,
  body: unknown,
  respond: CreateOrderResponder
): Promise<void> {
  let input: OrderInput;
  try {
    input = validateOrderInput((body ?? {}) as Record<string, unknown>);
  } catch {
    respond.invalidOrder();
    return;
  }

  try {
    const outcome = await orders.createOrder(input);
    if (outcome.status === "product-not-found") {
      respond.productNotFound();
      return;
    }
    if (outcome.status === "insufficient-stock") {
      respond.insufficientStock();
      return;
    }
    respond.created(outcome.order);
  } catch (error) {
    respond.failed(error);
  }
}

export function createApiOrderRouter({ orders }: OrderRouteDependencies): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    await handleCreateOrder(orders, req.body, {
      invalidOrder: () => {
        res.status(400).json({ error: "Invalid order" });
      },
      productNotFound: () => {
        res.status(404).json({ error: "Product not found" });
      },
      insufficientStock: () => {
        res.status(400).json({ error: "Insufficient stock" });
      },
      created: (order) => {
        res.status(201).json(order);
      },
      failed: (error) => {
        console.error(error);
        res.status(500).json({ error: "Could not create order" });
      },
    });
  });

  return router;
}

export function createPageOrderRouter({ orders }: OrderRouteDependencies): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    await handleCreateOrder(orders, req.body, {
      invalidOrder: () => {
        res.status(400).send("Invalid order");
      },
      productNotFound: () => {
        res.status(404).send("Product not found");
      },
      insufficientStock: () => {
        res.status(400).send("Insufficient stock");
      },
      created: (order) => {
        res.redirect(`/orders/${encodeURIComponent(order.id)}`);
      },
      failed: (error) => {
        console.error(error);
        res.status(500).send("Could not create order");
      },
    });
  });

  return router;
}
