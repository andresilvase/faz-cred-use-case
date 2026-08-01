import { describe, expect, it } from "vitest";

import { JsonTechnicalLogger } from "./technical-logger.js";

describe("JsonTechnicalLogger", () => {
  it("writes structured JSON and redacts sensitive fields", () => {
    const lines: string[] = [];
    const logger = new JsonTechnicalLogger({
      write: (line) => lines.push(line),
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    logger.info("http.request_completed", {
      correlation_id: "correlation-123",
      method: "POST",
      borrower_id: "sensitive-borrower",
      idempotency_key: "sensitive-key",
    });

    expect(JSON.parse(lines[0] ?? "")).toEqual({
      timestamp: "2026-01-02T03:04:05.000Z",
      level: "info",
      event: "http.request_completed",
      correlation_id: "correlation-123",
      method: "POST",
      borrower_id: "[REDACTED]",
      idempotency_key: "[REDACTED]",
    });
    expect(lines[0]).not.toContain("sensitive-borrower");
    expect(lines[0]).not.toContain("sensitive-key");
  });

  it("includes sanitized stack frames only when explicitly enabled", () => {
    const productionLines: string[] = [];
    const developmentLines: string[] = [];
    const error = new Error("database unavailable");

    new JsonTechnicalLogger({
      write: (line) => productionLines.push(line),
    }).error("database.transaction_failed", error);
    new JsonTechnicalLogger({
      write: (line) => developmentLines.push(line),
      includeErrorStack: true,
    }).error("database.transaction_failed", error);

    expect(productionLines[0]).not.toContain("stack");
    expect(developmentLines[0]).toContain("stack");
    expect(productionLines[0]).not.toContain("database unavailable");
    expect(developmentLines[0]).not.toContain("database unavailable");
  });
});
