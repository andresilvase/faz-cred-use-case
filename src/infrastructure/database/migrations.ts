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
  {
    version: "0002_create_state_policies",
    sql: `
      CREATE TABLE state_policies (
        version text PRIMARY KEY,
        minimum_portfolio_for_percentage_rule bigint NOT NULL,
        default_limit_basis_points integer NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT state_policies_version_valid
          CHECK (version <> '' AND version = btrim(version)),
        CONSTRAINT state_policies_minimum_portfolio_valid
          CHECK (
            minimum_portfolio_for_percentage_rule > 0
            AND minimum_portfolio_for_percentage_rule <= 9007199254740991
          ),
        CONSTRAINT state_policies_default_limit_valid
          CHECK (default_limit_basis_points BETWEEN 0 AND 10000)
      );

      CREATE UNIQUE INDEX state_policies_one_active_idx
        ON state_policies (is_active)
        WHERE is_active;

      CREATE TABLE state_policy_limits (
        policy_version text NOT NULL
          REFERENCES state_policies (version) ON DELETE CASCADE,
        uf character(2) NOT NULL,
        limit_basis_points integer NOT NULL,
        PRIMARY KEY (policy_version, uf),
        CONSTRAINT state_policy_limits_uf_valid CHECK (
          uf IN (
            'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
            'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
            'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
          )
        ),
        CONSTRAINT state_policy_limits_percentage_valid
          CHECK (limit_basis_points BETWEEN 0 AND 10000)
      );

      INSERT INTO state_policies (
        version,
        minimum_portfolio_for_percentage_rule,
        default_limit_basis_points,
        is_active
      ) VALUES ('1', 10000000, 1000, true);

      INSERT INTO state_policy_limits (
        policy_version,
        uf,
        limit_basis_points
      ) VALUES ('1', 'SP', 2000);
    `,
  },
];
