CREATE TABLE IF NOT EXISTS patient_accounts (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  email_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  profile_enc TEXT NOT NULL,
  password_hash VARCHAR(255) NULL,
  google_sub VARCHAR(255) CHARACTER SET ascii NULL,
  email_verified_at DATETIME(3) NULL,
  disabled_at DATETIME(3) NULL,
  auth_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY unique_patient_email (email_hash),
  UNIQUE KEY unique_google_subject (google_sub)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_sessions (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  patient_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  auth_version INT UNSIGNED NULL,
  csrf_token CHAR(64) CHARACTER SET ascii NOT NULL,
  created_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  idle_expires_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  last_auth_at DATETIME(3) NULL,
  last_auth_method VARCHAR(20) NULL,
  google_nonce_hash CHAR(64) CHARACTER SET ascii NULL,
  google_nonce_expires_at DATETIME(3) NULL,
  google_purpose ENUM('signin', 'link', 'reauth') NULL,
  UNIQUE KEY unique_session_token (token_hash),
  KEY patient_session_lookup (patient_id, revoked_at),
  FOREIGN KEY (patient_id) REFERENCES patient_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_auth_tokens (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  patient_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose ENUM('verify', 'reset') NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  UNIQUE KEY unique_auth_token (token_hash),
  KEY patient_token_lookup (patient_id, purpose),
  FOREIGN KEY (patient_id) REFERENCES patient_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_request_links (
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  patient_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  linked_at DATETIME(3) NOT NULL,
  KEY patient_history (patient_id, request_id),
  FOREIGN KEY (request_id) REFERENCES appointment_requests(id),
  FOREIGN KEY (patient_id) REFERENCES patient_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_guest_link_codes (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  patient_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  issued_by VARCHAR(255) NOT NULL,
  UNIQUE KEY unique_guest_link_token (token_hash),
  FOREIGN KEY (request_id) REFERENCES appointment_requests(id),
  FOREIGN KEY (patient_id) REFERENCES patient_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_mail_outbox (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  payload_enc TEXT NOT NULL,
  status ENUM('pending', 'processing', 'sent', 'failed') NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  locked_until DATETIME(3) NULL,
  lease_token CHAR(32) NULL,
  last_error_code VARCHAR(60) NULL,
  sent_at DATETIME(3) NULL,
  KEY patient_mail_work (status, next_attempt_at, locked_until)
) ENGINE=InnoDB;