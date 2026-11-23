import { z } from "zod";

export const phoneSchema = z.string()
  .trim()
  .max(32)
  .refine((value) => {
    if (!value) return true;

    const digits = value.replace(/\D/g, "");

    return (
      /^\+?[\d(). -]+$/.test(value) &&
      digits.length >= 7 &&
      digits.length <= 15
    );
  }, "Enter a valid contact number.")
  .optional()
  .default("");