import type { NotificationRecord } from "../models/notification.js";
import type { Order } from "../models/order.js";
import type { NotificationRepository } from "../repositories/notification.repository.js";

/**
 * Application service: order-confirmation notifications.
 *
 * The confirmation is emitted after the order transaction has been completed
 * and outside of it, before the success response is produced.
 */
export class NotificationService {
  constructor(private readonly notifications: NotificationRepository) {}

  emitOrderConfirmation(order: Order): NotificationRecord {
    return this.notifications.record(order.id, order.customerEmail);
  }

  listNotifications(): NotificationRecord[] {
    return this.notifications.readAll();
  }
}
