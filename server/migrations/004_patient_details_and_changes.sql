ALTER TABLE appointment_requests
  MODIFY COLUMN status
    ENUM('pending', 'approved', 'declined', 'expired', 'cancelled')
    NOT NULL;

CREATE TABLE IF NOT EXISTS patient_details (
  patient_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  details_enc MEDIUMTEXT NOT NULL,
  version INT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patient_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_reschedules (
  replacement_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  original_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  patient_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  state ENUM('pending', 'approved', 'declined', 'cancelled') NOT NULL,

  active_original_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN state='pending' THEN original_id ELSE NULL END
    ) STORED,

  created_at DATETIME(3) NOT NULL,

  UNIQUE KEY one_pending_replacement (active_original_id),
  KEY original_history (original_id, created_at),

  FOREIGN KEY (replacement_id) REFERENCES appointment_requests(id),
  FOREIGN KEY (original_id) REFERENCES appointment_requests(id),
  FOREIGN KEY (patient_id) REFERENCES patient_accounts(id),

  CHECK (replacement_id <> original_id)
) ENGINE=InnoDB;