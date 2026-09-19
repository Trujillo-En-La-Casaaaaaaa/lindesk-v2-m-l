/**
 * Domain model: notification log record (JSON Lines file store).
 *
 * Pure data shape only: no I/O, no framework imports.
 */
export type NotificationType = "ORDER_CONFIRMATION";

export type NotificationRecord = {
  id: string;
  type: NotificationType;
  orderId: string;
  createdAt: string;
  payload: { customerEmail: string; orderId: string };
};
