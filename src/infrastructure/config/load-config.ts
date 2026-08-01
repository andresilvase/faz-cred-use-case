export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly migrationDatabaseUrl: string;
  readonly databaseSslMode: "disable" | "verify-full";
  readonly databaseSslCa?: string;
  readonly nodeEnvironment: "development" | "test" | "production";
}

export function loadConfig(environment: NodeJS.ProcessEnv): ServiceConfig {
  const port = environment.PORT;

  if (port === undefined || port.trim() === "") {
    throw new Error("Missing required environment variable: PORT");
  }

  const parsedPort = Number(port);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(
      "Invalid environment variable PORT: expected an integer between 1 and 65535",
    );
  }

  const databaseUrl = environment.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const migrationDatabaseUrl = environment.MIGRATION_DATABASE_URL;
  const databaseSslMode = environment.DATABASE_SSL_MODE;

  if (
    migrationDatabaseUrl === undefined ||
    migrationDatabaseUrl.trim() === ""
  ) {
    throw new Error(
      "Missing required environment variable: MIGRATION_DATABASE_URL",
    );
  }

  if (databaseSslMode === undefined || databaseSslMode.trim() === "") {
    throw new Error("Missing required environment variable: DATABASE_SSL_MODE");
  }
  if (databaseSslMode !== "disable" && databaseSslMode !== "verify-full") {
    throw new Error(
      "Invalid environment variable DATABASE_SSL_MODE: expected disable or verify-full",
    );
  }

  const nodeEnvironment = environment.NODE_ENV ?? "production";

  if (
    nodeEnvironment !== "development" &&
    nodeEnvironment !== "test" &&
    nodeEnvironment !== "production"
  ) {
    throw new Error(
      "Invalid environment variable NODE_ENV: expected development, test or production",
    );
  }

  const databaseSslCa = environment.DATABASE_SSL_CA;

  return {
    port: parsedPort,
    databaseUrl,
    migrationDatabaseUrl,
    databaseSslMode,
    nodeEnvironment,
    ...(databaseSslCa === undefined || databaseSslCa === ""
      ? {}
      : { databaseSslCa }),
  };
}
