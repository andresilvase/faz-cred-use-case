import { Pool } from "pg";

export interface PostgresConnectionConfig {
  readonly connectionString: string;
}

export function createPostgresPool({
  connectionString,
}: PostgresConnectionConfig): Pool {
  return new Pool({ connectionString });
}
