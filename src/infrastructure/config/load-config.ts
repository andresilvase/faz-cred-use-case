export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
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

  return { port: parsedPort, databaseUrl };
}
