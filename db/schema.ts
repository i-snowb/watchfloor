export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS case_state (
    session_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    fixture_version TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    activity_sequence INTEGER NOT NULL CHECK (activity_sequence >= 0),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, case_id)
  )`,
  `CREATE TABLE IF NOT EXISTS operation_receipt (
    session_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    logical_sequence INTEGER NOT NULL CHECK (logical_sequence >= 1),
    reported_surface TEXT NOT NULL
      CHECK (reported_surface IN ('webmcp_callback', 'analyst_control')),
    attribution_assurance TEXT NOT NULL
      CHECK (attribution_assurance = 'client_reported_unauthenticated'),
    tool_name TEXT NOT NULL,
    title TEXT NOT NULL,
    target TEXT,
    result_summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'rejected')),
    base_revision INTEGER NOT NULL,
    result_revision INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT NOT NULL,
    server_derived INTEGER NOT NULL DEFAULT 0,
    principal_assurance TEXT NOT NULL DEFAULT 'legacy_unrecorded',
    PRIMARY KEY (session_id, case_id, generation, request_id),
    UNIQUE (session_id, case_id, generation, logical_sequence)
  )`,
  `CREATE INDEX IF NOT EXISTS operation_receipt_case_sequence
    ON operation_receipt (session_id, case_id, generation, logical_sequence)`,
  `CREATE TABLE IF NOT EXISTS session_lease (
    session_id TEXT NOT NULL PRIMARY KEY,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    last_activity_at_ms INTEGER NOT NULL CHECK (last_activity_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms)
  )`,
  `CREATE INDEX IF NOT EXISTS session_lease_expiry
    ON session_lease (expires_at_ms)`,
  `CREATE TABLE IF NOT EXISTS session_work_ledger (
    session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    work_kind TEXT NOT NULL CHECK (work_kind IN ('mutation', 'reset')),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
    PRIMARY KEY (session_id, case_id, generation, request_id)
  )`,
  `CREATE INDEX IF NOT EXISTS session_work_ledger_budget
    ON session_work_ledger (session_id, work_kind, expires_at_ms)`,
  `CREATE INDEX IF NOT EXISTS session_work_ledger_expiry
    ON session_work_ledger (expires_at_ms)`,
] as const;
