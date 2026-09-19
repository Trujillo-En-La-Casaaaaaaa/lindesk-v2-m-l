import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  NotificationRepository,
  readNotifications,
  recordNotification,
} from "./notification.repository.js";

function temporaryLogPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-legacy-"));
  return path.join(directory, "notifications.jsonl");
}

describe("notification log file store", () => {
  it("records order confirmations in a local file", () => {
    const logFile = temporaryLogPath();

    const written = recordNotification(logFile, "order-1", "buyer@example.com");
    const records = readNotifications(logFile);

    assert.equal(written.type, "ORDER_CONFIRMATION");
    assert.equal(records.length, 1);
    assert.equal(records[0].orderId, "order-1");
    assert.equal(records[0].payload.orderId, "order-1");
    assert.equal(records[0].payload.customerEmail, "buyer@example.com");
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  });

  it("appends one JSON object per line with the preserved record shape", () => {
    const logFile = temporaryLogPath();

    const first = recordNotification(logFile, "order-1", "buyer@example.com");
    const second = recordNotification(logFile, "order-2", "other@example.com");

    const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(first).sort(), [
      "createdAt",
      "id",
      "orderId",
      "payload",
      "type",
    ]);
    assert.equal(typeof first.id, "string");
    assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(JSON.parse(lines[0]), first);
    assert.deepEqual(JSON.parse(lines[1]), second);

    const records = readNotifications(logFile);
    assert.deepEqual(
      records.map((record) => record.orderId),
      ["order-1", "order-2"]
    );
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  });

  it("creates the notification directory when it does not exist", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-legacy-"));
    const logFile = path.join(directory, "nested", "deeper", "notifications.jsonl");

    recordNotification(logFile, "order-1", "buyer@example.com");

    assert.equal(readNotifications(logFile).length, 1);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("returns an empty list for a missing or blank file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-legacy-"));
    const missing = path.join(directory, "missing.jsonl");
    const blank = path.join(directory, "blank.jsonl");
    fs.writeFileSync(blank, "  \n\n");

    assert.deepEqual(readNotifications(missing), []);
    assert.deepEqual(readNotifications(blank), []);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("exposes the same file semantics through the repository object", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-legacy-"));
    const logFile = path.join(directory, "notifications.jsonl");
    const repository = new NotificationRepository(logFile);

    assert.deepEqual(repository.readAll(), []);
    const record = repository.record("order-9", "buyer@example.com");
    assert.deepEqual(repository.readAll(), [record]);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
