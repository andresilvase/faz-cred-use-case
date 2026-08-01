export type TechnicalLogFields = Readonly<Record<string, unknown>>;

export interface TechnicalLogger {
  info(event: string, fields?: TechnicalLogFields): void;
  warn(event: string, fields?: TechnicalLogFields): void;
  error(event: string, error: unknown, fields?: TechnicalLogFields): void;
}

export const NOOP_TECHNICAL_LOGGER: TechnicalLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface JsonTechnicalLoggerOptions {
  readonly write?: (line: string) => void;
  readonly includeErrorStack?: boolean;
  readonly now?: () => Date;
}

export class JsonTechnicalLogger implements TechnicalLogger {
  private readonly write: (line: string) => void;
  private readonly includeErrorStack: boolean;
  private readonly now: () => Date;

  constructor(options: JsonTechnicalLoggerOptions = {}) {
    this.write = options.write ?? console.log;
    this.includeErrorStack = options.includeErrorStack ?? false;
    this.now = options.now ?? (() => new Date());
  }

  info(event: string, fields: TechnicalLogFields = {}): void {
    this.emit("info", event, fields);
  }

  warn(event: string, fields: TechnicalLogFields = {}): void {
    this.emit("warn", event, fields);
  }

  error(
    event: string,
    error: unknown,
    fields: TechnicalLogFields = {},
  ): void {
    this.emit("error", event, {
      ...fields,
      error: serializeError(error, this.includeErrorStack),
    });
  }

  private emit(
    level: "info" | "warn" | "error",
    event: string,
    fields: TechnicalLogFields,
  ): void {
    this.write(
      JSON.stringify({
        ...sanitizeFields(fields),
        timestamp: this.now().toISOString(),
        level,
        event,
      }),
    );
  }
}

const SENSITIVE_FIELD_PATTERN =
  /(authorization|borrower|idempotency|password|payload|secret|token)/i;

function sanitizeFields(fields: TechnicalLogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? "[REDACTED]" : sanitizeValue(value),
    ]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeFields(value as Record<string, unknown>);
  }

  return value;
}

function serializeError(
  error: unknown,
  includeStack: boolean,
): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { name: "UnknownError" };
  }

  return {
    name: error.name,
    ...(includeStack && error.stack !== undefined
      ? { stack: error.stack.split("\n").slice(1).join("\n") }
      : {}),
  };
}
