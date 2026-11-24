ALTER TABLE appointment_requests
  MODIFY COLUMN status ENUM(
    'pending','approved','declined','expired',
    'cancelled','completed','no_show'
  ) NOT NULL;

ALTER TABLE staff_scopes
  MODIFY COLUMN subject
    VARCHAR(255) CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL;

CREATE TABLE IF NOT EXISTS staff_users (
  subject VARCHAR(255) CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin PRIMARY KEY,
  issuer VARCHAR(512) CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auth_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_grants (
  subject VARCHAR(255) CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  role ENUM(
    'scheduler','clinician','administrator','auditor'
  ) NOT NULL,
  PRIMARY KEY(subject,location_id,provider_id,role),
  FOREIGN KEY(subject) REFERENCES staff_users(subject),
  FOREIGN KEY(location_id) REFERENCES locations(id),
  FOREIGN KEY(provider_id) REFERENCES providers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_sessions (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject VARCHAR(255) CHARACTER SET utf8mb4
    COLLATE utf8mb4_bin NOT NULL,
  auth_version INT UNSIGNED NOT NULL,
  csrf_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mfa_verified BOOLEAN NOT NULL,
  mfa_policy_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authenticated_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  idle_expires_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY staff_session_token(token_hash),
  KEY staff_session_owner(subject,revoked_at),
  FOREIGN KEY(subject) REFERENCES staff_users(subject)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_oidc_states (
  state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  binding_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verifier_enc TEXT NOT NULL,
  old_session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  KEY staff_flow_expiry(expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_notes (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  note_enc TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY staff_note_request(request_id,created_at),
  FOREIGN KEY(request_id) REFERENCES appointment_requests(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_proposals (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  original_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  original_version INT UNSIGNED NOT NULL,
  status ENUM('proposed','accepted','declined','withdrawn') NOT NULL,
  version INT UNSIGNED NOT NULL,
  replacement_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  accepted_by VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  acceptance_method VARCHAR(30) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  active_original_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN status='proposed' THEN original_id ELSE NULL END
    ) STORED,
  UNIQUE KEY one_active_staff_proposal(active_original_id),
  KEY staff_proposal_history(original_id,created_at),
  FOREIGN KEY(original_id) REFERENCES appointment_requests(id),
  FOREIGN KEY(replacement_id) REFERENCES appointment_requests(id),
  CHECK(ends_at>starts_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_schedule_revisions (
  provider_id INT UNSIGNED PRIMARY KEY,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY(provider_id) REFERENCES providers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_previews (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  payload_enc MEDIUMTEXT NOT NULL,
  snapshot_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY(subject) REFERENCES staff_users(subject),
  FOREIGN KEY(location_id) REFERENCES locations(id),
  FOREIGN KEY(provider_id) REFERENCES providers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS communications_outbox (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  dedup_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_enc MEDIUMTEXT NOT NULL,
  status ENUM('pending','processing','sent','failed') NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  locked_until DATETIME(3) NULL,
  lease_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_error_code VARCHAR(60) NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY communication_dedup(dedup_key),
  KEY communication_work(status,next_attempt_at,locked_until)
) ENGINE=InnoDB;