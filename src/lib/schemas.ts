import { z } from "zod";
import { assertValidMapsUrl } from "../../convex/lib/mapsUrl";

/**
 * Client-side Zod schemas for forms. These mirror server-side validators in
 * `convex/lib/slug.ts` so we fail fast in the UI before round-tripping to
 * Convex. Server still re-validates — never trust the client.
 */

// Match `convex/lib/slug.ts` assertValidWaPhone — strip formatting then
// require 8–15 digits.
export const waPhoneSchema = z
	.string()
	.transform((s) => s.replace(/[\s\-()+]/g, ""))
	.pipe(
		z
			.string()
			.regex(
				/^\d{8,15}$/,
				"WhatsApp number must be 8–15 digits, with country code (e.g. 60123456789)",
			),
	);

// Optional variant — empty string is allowed and becomes undefined.
export const waPhoneOptionalSchema = z
	.string()
	.optional()
	.transform((s) => (s && s.trim().length > 0 ? s : undefined))
	.pipe(waPhoneSchema.optional());

export const settingsWaPhoneFormSchema = z.object({
	waPhone: waPhoneSchema,
});

export type SettingsWaPhoneFormValues = z.input<
	typeof settingsWaPhoneFormSchema
>;

// Notification email — empty string allowed (clears the field). When non-empty
// it must look like an email. Mirrors `convex/lib/slug.ts` assertValidEmail.
export const settingsNotifyEmailFormSchema = z.object({
	notifyEmail: z
		.string()
		.transform((s) => s.trim())
		.refine(
			(s) => s.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
			"Email must look like name@example.com",
		)
		.refine((s) => s.length <= 254, "Email is too long"),
});

export type SettingsNotifyEmailFormValues = z.input<
	typeof settingsNotifyEmailFormSchema
>;

// Customer name on checkout — always a string (empty allowed); only the
// length is constrained. We treat empty/whitespace as "no name supplied"
// at submit time.
export const deliveryMethodSchema = z.enum(["delivery", "self_collect"]);

// Malaysia-only for v1. Mirrors `convex/lib/address.ts` MY_STATES.
export const MY_STATES = [
	"Johor",
	"Kedah",
	"Kelantan",
	"Melaka",
	"Negeri Sembilan",
	"Pahang",
	"Perak",
	"Perlis",
	"Pulau Pinang",
	"Sabah",
	"Sarawak",
	"Selangor",
	"Terengganu",
	"WP Kuala Lumpur",
	"WP Labuan",
	"WP Putrajaya",
] as const;

export type MyState = (typeof MY_STATES)[number];

// Strict schema applied only when deliveryMethod === "delivery". Mirrors the
// server-side rules in `convex/lib/address.ts` so we surface field-level
// errors before round-tripping to Convex. Also reused as the standalone form
// schema on the tracking-page edit dialog.
export const strictAddressSchema = z.object({
	line1: z
		.string()
		.trim()
		.min(3, "Address line 1 must be at least 3 characters")
		.max(120, "Address line 1 must be at most 120 characters"),
	line2: z
		.string()
		.trim()
		.max(120, "Address line 2 must be at most 120 characters")
		.optional()
		.or(z.literal("")),
	city: z
		.string()
		.trim()
		.min(2, "City must be at least 2 characters")
		.max(60, "City must be at most 60 characters"),
	state: z.enum(MY_STATES, { error: () => "Select a state" }),
	postcode: z.string().regex(/^\d{5}$/, "Postcode must be 5 digits"),
	notes: z
		.string()
		.max(200, "Notes must be at most 200 characters")
		.optional()
		.or(z.literal("")),
	mapsUrl: z
		.string()
		.url("Maps URL must be a valid URL")
		.optional()
		.or(z.literal("")),
});

// Loose form-state shape: every field is always present as a string so
// TanStack Form can mount the inputs whether delivery or self_collect is
// selected. Strict validation runs only when delivery is chosen.
//
// `latitude` and `longitude` are stringified numbers captured from Google
// Places autocomplete — kept as strings here to match TanStack Form's
// all-string form state. Empty when the buyer skipped autocomplete; the
// submit handler in checkout-sheet parses them back to numbers.
// `placeId` travels alongside lat/lng so derived maps URLs deep-link to
// the named Google place rather than raw coords.
export const addressFormFieldsSchema = z.object({
	line1: z.string(),
	line2: z.string(),
	city: z.string(),
	state: z.string(),
	postcode: z.string(),
	notes: z.string(),
	mapsUrl: z.string(),
	latitude: z.string(),
	longitude: z.string(),
	placeId: z.string(),
});

export const checkoutFormSchema = z
	.object({
		name: z.string().max(60, "Name must be at most 60 characters"),
		deliveryMethod: deliveryMethodSchema,
		address: addressFormFieldsSchema,
		// Convex id of the chosen pickup location when deliveryMethod is
		// self_collect and the retailer has 2+ active locations. The
		// "required" check lives in the submit handler because it depends on
		// runtime data (the live location count) not knowable to the schema.
		pickupLocationId: z.string(),
	})
	.superRefine((val, ctx) => {
		if (val.deliveryMethod !== "delivery") return;
		const result = strictAddressSchema.safeParse(val.address);
		if (result.success) return;
		for (const issue of result.error.issues) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: issue.message,
				path: ["address", ...issue.path],
			});
		}
	});

export type CheckoutFormValues = z.input<typeof checkoutFormSchema>;
export type CheckoutAddressValues = z.input<typeof addressFormFieldsSchema>;

// Standalone form schema for the tracking-page edit dialog: validates the
// address fields strictly via superRefine but keeps a loose form-state shape
// so TanStack Form mounts inputs even when fields are momentarily empty.
export const addressEditFormSchema = addressFormFieldsSchema.superRefine(
	(val, ctx) => {
		const result = strictAddressSchema.safeParse(val);
		if (result.success) return;
		for (const issue of result.error.issues) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: issue.message,
				path: issue.path,
			});
		}
	},
);

export const emptyAddress: CheckoutAddressValues = {
	line1: "",
	line2: "",
	city: "",
	state: "",
	postcode: "",
	notes: "",
	mapsUrl: "",
	latitude: "",
	longitude: "",
	placeId: "",
};

// Product form. Price is entered as a major-unit decimal string (e.g. "120" or
// "120.50") and transformed to integer minor units (sen) for storage. Stock is
// a non-negative integer. See `src/lib/format.ts` for the inverse.
export const productFormSchema = z.object({
	sku: z
		.string()
		.max(60, "SKU must be at most 60 characters")
		.transform((s) => (s.trim().length > 0 ? s.trim() : undefined)),
	name: z
		.string()
		.trim()
		.min(1, "Name is required")
		.max(120, "Name must be at most 120 characters"),
	description: z
		.string()
		.max(1000, "Description must be at most 1000 characters")
		.transform((s) => (s.trim().length > 0 ? s.trim() : undefined)),
	price: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Price must be a number, e.g. 120 or 120.50")
		.transform((s) => Math.round(Number.parseFloat(s) * 100)),
	stock: z
		.string()
		.regex(/^\d+$/, "Stock must be a whole number")
		.transform((s) => Number.parseInt(s, 10)),
});

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormOutput = z.output<typeof productFormSchema>;

// Pickup location settings form. mapsUrl is optional but, if provided, must
// pass the strict domain allowlist in `convex/lib/mapsUrl.ts` (Waze + Google
// Maps share-sheet hosts). Empty string is normalised to undefined.
export const pickupLocationFormSchema = z.object({
	label: z
		.string()
		.trim()
		.min(1, "Label is required")
		.max(60, "Label must be at most 60 characters"),
	address: z
		.string()
		.trim()
		.min(3, "Address must be at least 3 characters")
		.max(500, "Address must be at most 500 characters"),
	mapsUrl: z
		.string()
		.transform((s) => s.trim())
		.refine(
			(s) => {
				if (s.length === 0) return true;
				try {
					assertValidMapsUrl(s);
					return true;
				} catch {
					return false;
				}
			},
			"Maps URL must be a Waze or Google Maps link (https://)",
		)
		.transform((s) => (s.length > 0 ? s : undefined)),
	notes: z
		.string()
		.max(200, "Notes must be at most 200 characters")
		.transform((s) => (s.trim().length > 0 ? s.trim() : undefined)),
});

export type PickupLocationFormInput = z.input<typeof pickupLocationFormSchema>;
export type PickupLocationFormOutput = z.output<
	typeof pickupLocationFormSchema
>;

export const emptyPickupLocationForm: PickupLocationFormInput = {
	label: "",
	address: "",
	mapsUrl: "",
	notes: "",
};
