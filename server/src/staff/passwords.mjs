import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveAsync = promisify(scrypt);
const settings = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const prefix = "$scrypt$N=131072,r=8,p=1$";
const format = /^\$scrypt\$N=131072,r=8,p=1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
let active = 0;

export class PasswordBusyError extends Error {}

export function passwordValid(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 1024) {
    return false;
  }
  const length = [...value].length;
  return length >= 8 && length <= 128;
}

async function derive(password, salt) {
  if (active >= 2) throw new PasswordBusyError("Password service is busy.");
  active += 1;
  try {
    return await deriveAsync(password, salt, 64, settings);
  } finally {
    active -= 1;
  }
}

export async function hashPassword(password) {
  if (!passwordValid(password)) {
    throw new TypeError("Use 8–128 characters for the password.");
  }
  const salt = randomBytes(16);
  const result = await derive(password, salt);
  return prefix + salt.toString("hex") + "$" + result.toString("hex");
}

export async function verifyPassword(password, encoded) {
  const match = typeof encoded === "string" && encoded.length <= 256
    ? format.exec(encoded) : null;
  const usable = Boolean(passwordValid(password) && match);
  const actual = await derive(
    passwordValid(password) ? password : "invalid-password",
    usable ? Buffer.from(match[1], "hex") : Buffer.alloc(16)
  );
  const expected = usable ? Buffer.from(match[2], "hex") : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && usable;
}