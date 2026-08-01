export interface Migration {
  readonly version: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: "0001_create_migration_probe",
    sql: `
      CREATE TABLE migration_probe (
        id integer PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `,
  },
];
