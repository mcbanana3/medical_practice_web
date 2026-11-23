import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createCipheriv, createDecipheriv, createHmac, randomBytes
} from "node:crypto";
import mysql from "mysql2/promise";
import { config } from "./config.mjs";

const transactionContext = new AsyncLocalStorage();

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  connectionLimit: config.db.connectionLimit,
  timezone: "Z",
  multipleStatements: false,
  ssl: config.db.tls
    ? {
        rejectUnauthorized: true,
        ...(config.db.caFile
          ? { ca: fs.readFileSync(config.db.caFile) }
          : {})
      }
    : undefined
});

export class SafeError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}

export async function query(sql, values = [], connection) {
  const target = connection || transactionContext.getStore() || pool;
  const [rows] = await target.execute(sql, values);
  return rows;
}

export async function transaction(callback) {
  const existing = transactionContext.getStore();
  if (existing) return callback(existing);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const connection = await pool.getConnection();

    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();

      const result = await transactionContext.run(
        connection, () => callback(connection)
      );

      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});

      if (
        !["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code) ||
        attempt === 2
      ) throw error;
    } finally {
      connection.release();
    }
  }
}

export const newId = () => randomBytes(16).toString("hex");

export const digest = (value) =>
  createHmac("sha256", config.hmacKey).update(value).digest("hex");

export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.dataKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"), cipher.final()
  ]);

  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

export function decrypt(value) {
  const [iv, tag, encrypted] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm", config.dataKey, Buffer.from(iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8"));
}

export async function audit(connection, requestId, actor, event, details = {}) {
  await query(
    `INSERT INTO audit_events
      (request_id, actor, event, details, created_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [requestId, actor, event, JSON.stringify(details)],
    connection
  );
}