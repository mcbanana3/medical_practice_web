CREATE TABLE IF NOT EXISTS locations (
  id INT UNSIGNED PRIMARY KEY,
  name VARCHAR(160) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS providers (
  id INT UNSIGNED PRIMARY KEY,
  name VARCHAR(160) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointment_types (
  id INT UNSIGNED PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  CHECK (duration_minutes BETWEEN 5 AND 240)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_options (
  location_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  type_id INT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (location_id, provider_id, type_id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (type_id) REFERENCES appointment_types(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weekly_windows (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  UNIQUE KEY unique_window
    (location_id, provider_id, weekday, open_time),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (close_time > open_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id INT UNSIGNED NULL,
  provider_id INT UNSIGNED NULL,
  local_date DATE NOT NULL,
  closed BOOLEAN NOT NULL,
  open_time TIME NULL,
  close_time TIME NULL,
  KEY exception_lookup (local_date, location_id, provider_id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  CHECK (
    (closed = TRUE AND open_time IS NULL AND close_time IS NULL)
    OR
    (closed = FALSE AND open_time IS NOT NULL
      AND close_time IS NOT NULL AND close_time > open_time)
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointment_requests (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  type_id INT UNSIGNED NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  contact_enc TEXT NOT NULL,
  status ENUM('pending', 'approved', 'declined', 'expired') NOT NULL,
  expires_at DATETIME(3) NULL,
  version INT UNSIGNED NOT NULL,
  receipt_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY unique_submission (idempotency_key),
  KEY provider_overlap (provider_id, starts_at, ends_at),
  KEY pending_expiry (status, expires_at),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (type_id) REFERENCES appointment_types(id),
  CHECK (ends_at > starts_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(30) NOT NULL,
  recipient_type ENUM('patient', 'admin') NOT NULL,
  payload_enc TEXT NOT NULL,
  status ENUM('pending', 'processing', 'sent', 'failed') NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  locked_until DATETIME(3) NULL,
  lease_token CHAR(32) NULL,
  last_error_code VARCHAR(60) NULL,
  sent_at DATETIME(3) NULL,
  UNIQUE KEY unique_notification (request_id, event_type, recipient_type),
  KEY outbox_work (status, next_attempt_at, locked_until),
  FOREIGN KEY (request_id) REFERENCES appointment_requests(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor VARCHAR(255) NOT NULL,
  event VARCHAR(80) NOT NULL,
  details JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY audit_request (request_id, created_at),
  FOREIGN KEY (request_id) REFERENCES appointment_requests(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
  expires_at DATETIME(3) NOT NULL,
  hits INT UNSIGNED NOT NULL,
  KEY rate_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_scopes (
  subject VARCHAR(255) NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  can_decide BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (subject, location_id, provider_id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
) ENGINE=InnoDB;