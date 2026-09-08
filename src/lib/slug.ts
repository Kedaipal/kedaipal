import { z } from "zod";
import {
	isReservedSlug,
	RESERVED_SLUG_MESSAGE,
} from "../../convex/lib/reservedSlugs";

/**
 * Reserved handles live in ONE module shared with the server validator —
 * `convex/lib/reservedSlugs.ts` — and are machine-checked against the route
 * tree there. This file mirrors the SHAPE rules of `convex/lib/slug.ts` only.
 */

/**
 * Derive a URL-safe slug from a store name.
 *
 * - Unicode normalize (strip diacritics)
 * - lowercase
 * - non-alphanumeric → `-`
 * - collapse repeated dashes
 * - trim leading/trailing dashes
 * - truncate to 32 chars (dash-safe)
 */
export function slugify(input: string): string {
	const normalized = input
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	if (normalized.length <= 32) return normalized;
	return normalized.slice(0, 32).replace(/-$/, "");
}

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const slugSchema = z
	.string()
	.trim()
	.min(SLUG_MIN, `Slug must be at least ${SLUG_MIN} characters`)
	.max(SLUG_MAX, `Slug must be at most ${SLUG_MAX} characters`)
	.transform((s) => s.toLowerCase())
	.refine((s) => SLUG_PATTERN.test(s), {
		message: "Use lowercase letters, numbers and single dashes",
	})
	.refine((s) => !isReservedSlug(s), {
		message: RESERVED_SLUG_MESSAGE,
	});

/**
 * Category slugs share the store-slug shape/length rules but skip the
 * reserved-word list — they live under `/$slug/c/…`, so they can never collide
 * with app routes. Mirrors `assertValidCategorySlug` in convex/lib/slug.ts.
 * Per-retailer uniqueness is enforced server-side.
 */
export const categorySlugSchema = z
	.string()
	.trim()
	.min(SLUG_MIN, `Slug must be at least ${SLUG_MIN} characters`)
	.max(SLUG_MAX, `Slug must be at most ${SLUG_MAX} characters`)
	.transform((s) => s.toLowerCase())
	.refine((s) => SLUG_PATTERN.test(s), {
		message: "Use lowercase letters, numbers and single dashes",
	});

export const storeNameSchema = z
	.string()
	.trim()
	.min(2, "Store name must be at least 2 characters")
	.max(60, "Store name must be at most 60 characters");

export type SlugValidationResult =
	| { ok: true; value: string }
	| {
			ok: false;
			reason: "empty" | "tooShort" | "tooLong" | "invalid" | "reserved";
	  };

/**
 * Client-side pre-check used for live form feedback. Mirrors slugSchema but returns
 * a structured reason so the UI can distinguish error cases without try/catch.
 */
export function validateSlugShape(raw: string): SlugValidationResult {
	const s = raw.trim().toLowerCase();
	if (s.length === 0) return { ok: false, reason: "empty" };
	if (s.length < SLUG_MIN) return { ok: false, reason: "tooShort" };
	if (s.length > SLUG_MAX) return { ok: false, reason: "tooLong" };
	if (!SLUG_PATTERN.test(s)) return { ok: false, reason: "invalid" };
	if (isReservedSlug(s)) return { ok: false, reason: "reserved" };
	return { ok: true, value: s };
}
