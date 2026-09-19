import { Router } from "express";
import type { OrderService } from "../services/order.service.js";

/**
 * HTTP translation for the administrative ship transition.
 */
export interface ShipRouteDependencies {
  orders: OrderService;
}

export function createApiShipRouter({ orders }: ShipRouteDependencies): Router {
  const router = Router();

  router.post("/:id/ship", async (req, res) => {
    try {
      const order = await orders.shipOrder(req.params.id);
      if (!order) {
        res.status(400).json({ error: "Cannot ship order" });
        return;
      }
      res.json(order);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database error" });
    }
  });

  return router;
}

export function createPageShipRouter({ orders }: ShipRouteDependencies): Router {
  const router = Router();

  router.post("/:id/ship", async (req, res) => {
    try {
      const order = await orders.shipOrder(req.params.id);
      if (!order) {
        res.status(400).send("Cannot ship order");
        return;
      }
      res.redirect(`/orders/${encodeURIComponent(req.params.id)}`);
    } catch (error) {
      console.error(error);
      res.status(500).send("Database error");
    }
  });

  return router;
}
