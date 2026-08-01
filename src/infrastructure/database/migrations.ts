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
  {
    version: "0003_create_exposure_aggregates",
    sql: `
      CREATE TABLE exposure_aggregates (
        aggregate_key varchar(5) PRIMARY KEY,
        amount_minor_units bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT exposure_aggregates_key_valid CHECK (
          aggregate_key = 'TOTAL'
          OR aggregate_key IN (
            'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
            'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
            'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
          )
        ),
        CONSTRAINT exposure_aggregates_amount_non_negative
          CHECK (amount_minor_units >= 0)
      );

      INSERT INTO exposure_aggregates (aggregate_key)
      VALUES ('TOTAL');
    `,
  },
  {
    version: "0004_create_loans",
    sql: `
      CREATE TABLE loans (
        id uuid PRIMARY KEY,
        borrower_id text NOT NULL,
        uf character(2) NOT NULL,
        amount_minor_units bigint NOT NULL,
        policy_version text NOT NULL
          REFERENCES state_policies (version),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT loans_borrower_id_valid
          CHECK (borrower_id <> '' AND borrower_id = btrim(borrower_id)),
        CONSTRAINT loans_uf_valid CHECK (
          uf IN (
            'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
            'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
            'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
          )
        ),
        CONSTRAINT loans_amount_valid CHECK (
          amount_minor_units > 0
          AND amount_minor_units <= 9007199254740991
        )
      );

      CREATE INDEX loans_borrower_id_idx ON loans (borrower_id);
      CREATE INDEX loans_uf_idx ON loans (uf);
      CREATE INDEX loans_policy_version_idx ON loans (policy_version);
    `,
  },
  {
    version: "0005_create_idempotency_requests",
    sql: `
      CREATE TABLE idempotency_requests (
        borrower_id text NOT NULL,
        idempotency_key text NOT NULL,
        request_hash character(64) NOT NULL,
        decision varchar(8) NOT NULL,
        message text NOT NULL,
        loan_id uuid REFERENCES loans (id),
        policy_version text NOT NULL REFERENCES state_policies (version),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (borrower_id, idempotency_key),
        CONSTRAINT idempotency_requests_borrower_id_valid
          CHECK (borrower_id <> '' AND borrower_id = btrim(borrower_id)),
        CONSTRAINT idempotency_requests_key_valid
          CHECK (idempotency_key <> '' AND idempotency_key = btrim(idempotency_key)),
        CONSTRAINT idempotency_requests_hash_valid
          CHECK (request_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT idempotency_requests_result_valid CHECK (
          (
            decision = 'APPROVED'
            AND message = 'O valor solicitado foi aprovado.'
            AND loan_id IS NOT NULL
          )
          OR (
            decision = 'DENIED'
            AND message = 'O empréstimo foi negado.'
            AND loan_id IS NULL
          )
        )
      );

      CREATE INDEX idempotency_requests_policy_version_idx
        ON idempotency_requests (policy_version);
    `,
  },
];
