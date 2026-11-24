CREATE TABLE IF NOT EXISTS staff_local_credentials (
  subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
  email_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_enc TEXT NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  is_doctor BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY staff_local_email(email_hash),
  FOREIGN KEY(subject) REFERENCES staff_users(subject)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_local_tokens (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  purpose ENUM('reset','invite','email') NOT NULL,
  auth_version INT UNSIGNED NOT NULL,
  target_email_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_email_enc TEXT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY staff_local_token(token_hash),
  KEY staff_local_token_owner(subject,purpose),
  FOREIGN KEY(subject) REFERENCES staff_users(subject)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_local_recovery (
  subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY(subject,code_hash),
  FOREIGN KEY(subject) REFERENCES staff_users(subject)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_local_guard (
  id TINYINT PRIMARY KEY,
  bootstrap_subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  CHECK(id=1),
  FOREIGN KEY(bootstrap_subject) REFERENCES staff_users(subject)
) ENGINE=InnoDB;

INSERT INTO staff_local_guard(id,bootstrap_subject)
VALUES(1,NULL)
ON DUPLICATE KEY UPDATE id=id;

UPDATE staff_sessions
SET revoked_at=UTC_TIMESTAMP(3)
WHERE revoked_at IS NULL;

DROP TABLE IF EXISTS staff_oidc_states;