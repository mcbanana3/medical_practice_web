ALTER TABLE patient_reschedules
  MODIFY COLUMN state ENUM('pending','approved','declined','cancelled','expired') NOT NULL;

CREATE TABLE IF NOT EXISTS appointment_patient_notes (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  author VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  note_enc TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY appointment_patient_note_history(request_id,created_at),
  FOREIGN KEY(request_id) REFERENCES appointment_requests(id)
) ENGINE=InnoDB;
