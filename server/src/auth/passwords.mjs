import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { SafeError } from "../db.mjs";

const options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1
};

let active = 0;
const waiting = [];

async function bounded(callback) {
  if (waiting.length >= 32) {
    throw new SafeError(503, "AUTH_BUSY", "Account services are busy. Try again.");
  }

  if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
  active += 1;

  try {
    return await callback();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

export const hashPassword = (password) =>
  bounded(() => argon2.hash(password, options));

const dummyHash = await hashPassword(randomBytes(32).toString("hex"));

export async function checkPassword(hash, password) {
  const valid = await bounded(() =>
    argon2.verify(hash || dummyHash, password).catch(() => false)
  );
  return Boolean(hash) && valid;
}