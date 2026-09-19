import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NotificationRecord } from "../models/notification.js";

/**
 * Persistence: the JSON Lines notification log file.
 *
 * File semantics (missing file -> [], blank file -> [], one JSON object per
 * line) are part of the preserved behavior contract.
 */
export function recordNotification(
  filePath: string,
  orderId: string,
  customerEmail: string
): NotificationRecord {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const record: NotificationRecord = {
    id: randomUUID(),
    type: "ORDER_CONFIRMATION",
    orderId,
    createdAt: new Date().toISOString(),
    payload: { customerEmail, orderId },
  };
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  return record;
}

export function readNotifications(filePath: string): NotificationRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NotificationRecord);
}

export class NotificationRepository {
  constructor(private readonly filePath: string) {}

  record(orderId: string, customerEmail: string): NotificationRecord {
    return recordNotification(this.filePath, orderId, customerEmail);
  }

  readAll(): NotificationRecord[] {
    return readNotifications(this.filePath);
  }
}
