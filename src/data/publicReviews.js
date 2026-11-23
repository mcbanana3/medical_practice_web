/**
 * PUBLIC CONTENT ONLY.
 *
 * This file must contain only authentic reviews already approved for
 * publication by the authorized doctor, with source and permission checks.
 *
 * Never place pending reviews, private submissions, consent evidence,
 * internal notes, or patient records in frontend source files.
 *
 * The later backend must enforce moderation and return only public records.
 *
 * Published record shape:
 * {
 *   id: string,
 *   displayName: string,
 *   text: string,
 *   type: "testimonial" | "third-party-review",
 *   sourceLabel: string,
 *   sourceUrl?: string
 * }
 *
 * There are deliberately no fabricated sample reviews.
 */

export const publishedReviews = [];