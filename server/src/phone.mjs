import { z } from "zod";
import { normalizeUsPhone } from "../../shared/contact.js";
export const phoneSchema = z.string().trim().max(32)
  .refine(value => !value || Boolean(normalizeUsPhone(value)), "Enter a valid US phone number.")
  .transform(value => value ? normalizeUsPhone(value) : "").optional().default("");
