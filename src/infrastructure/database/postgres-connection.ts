import { Pool } from "pg";

import {
  NOOP_TECHNICAL_LOGGER,
  type TechnicalLogger,
} from "../logging/technical-logger.js";

export interface PostgresConnectionConfig {
  readonly connectionString: string;
  readonly sslMode?: "disable" | "verify-full";
  readonly sslCa?: string;
  readonly logger?: TechnicalLogger;
}

export function createPostgresPool({
  connectionString,
  sslMode = "disable",
  sslCa,
  logger = NOOP_TECHNICAL_LOGGER,
}: PostgresConnectionConfig): Pool {
  const pool = new Pool({
    connectionString,
    application_name: "loan-decision-service",
    ssl:
      sslMode === "verify-full"
        ? {
            rejectUnauthorized: true,
            ...(sslCa === undefined ? {} : { ca: sslCa }),
          }
        : false,
  });
  pool.on("error", (error) => {
    logger.error("database.pool_error", error);
  });

  return pool;
}
