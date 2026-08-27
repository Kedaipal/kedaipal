import { z } from "zod";
import { type Country, COUNTRIES } from "../../convex/lib/country";
import {
	MOBILE_MESSAGE,
	normalizeMobileDigits,
	STORED_MOBILE_PATTERN,
} from "../../convex/lib/slug";

/**
 * Client-side Zod schemas for forms. The phone schemas are BUILT FROM the
 * server validators' own patterns, messages, and normalizer (`convex/lib/
 * slug.ts` — pure, importable from the client) so we fail fast in the UI with
 * exactly the acceptance the server enforces; the other schemas mirror their
 * server counterparts by hand. Server still re-validates — never trust the
 * client.
 */

// The one mobile schema per country, sharing the server's
// `assertValidMobileForCountry` pieces (86eyf1rck buyer checkout; extended to
// every plated field by 86eyknr2r; per-country since SG-lite 86eynw28q).
// Normalizes the way a local actually types — MY `0xx…`/bare `1xx…`/full
// `60xx…`, SG bare `9xxx xxxx`/full `65xx…` — then requires that country's
// MOBILE shape. An MY landline (`03-…`) clears a bare digit count but can
// never receive WhatsApp, and every field using this schema exists so a
// WhatsApp message reaches it.
//
// The bare-NSN arm exists because these fields render a `+60`/`+65` plate:
// someone who reads that badge and types "12-345 6789" / "9123 4567" must not
// be rejected. Each NSN window is pinned tight so it can't swallow a foreign
// number.
//
// A Record keyed by the RETAILER's country, never a permissive both-countries
// schema: an SG store rejects `+60` buyers with the SG message and vice versa,
// keeping each side's typo protection as strict as when the app was MY-only.
function buildWaPhoneCheckoutSchema(country: Country) {
	return z
		.string()
		.transform((s) => normalizeMobileDigits(s, country))
		.pipe(
			z
				.string()
				.regex(STORED_MOBILE_PATTERN[country], MOBILE_MESSAGE[country]),
		);
}

export const waPhoneCheckoutSchema: Record<
	Country,
	ReturnType<typeof buildWaPhoneCheckoutSchema>
> = {
	MY: buildWaPhoneCheckoutSchema("MY"),
	SG: buildWaPhoneCheckoutSchema("SG"),
};

// Optional variant for a FORM field (blank is fine, anything typed must be a
// mobile in the store's country). Deliberately a `refine`, not
// `.optional().transform(…)`: TanStack Form validates without replacing state,
// so a schema whose input type is `string | undefined` no longer matches a
// field that is always a string — and a transform here would describe a
// normalization that never happens. The caller sends the raw text; the server
// normalizes.
function buildWaPhoneFormOptionalSchema(country: Country) {
	return z
		.string()
		.refine(
			(s) =>
				s.trim().length === 0 ||
				STORED_MOBILE_PATTERN[country].test(normalizeMobileDigits(s, country)),
			MOBILE_MESSAGE[country],
		);
}

export const waPhoneFormOptionalSchema: Record<
	Country,
	ReturnType<typeof buildWaPhoneFormOptionalSchema>
> = {
	MY: buildWaPhoneFormOptionalSchema("MY"),
	SG: buildWaPhoneFormOptionalSchema("SG"),
};

// (The old `SettingsWaPhoneFormValues` export had no consumer — dropped
// rather than re-anchored onto one arm.)
export const settingsWaPhoneFormSchema: Record<
	Country,
	z.ZodObject<{ waPhone: ReturnType<typeof buildWaPhoneCheckoutSchema> }>
> = {
	MY: z.object({ waPhone: waPhoneCheckoutSchema.MY }),
	SG: z.object({ waPhone: waPhoneCheckoutSchema.SG }),
};

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

// Mirrors `convex/lib/address.ts` MY_STATES.
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

// Field pieces shared by both country arms of the strict address schema.
const addressLine1Schema = z
	.string()
	.trim()
	.min(3, "Address line 1 must be at least 3 characters")
	.max(120, "Address line 1 must be at most 120 characters");
const addressLine2Schema = z
	.string()
	.trim()
	.max(120, "Address line 2 must be at most 120 characters")
	.optional()
	.or(z.literal(""));
const addressNotesSchema = z
	.string()
	.max(200, "Notes must be at most 200 characters")
	.optional()
	.or(z.literal(""));
const addressMapsUrlSchema = z
	.string()
	.url("Maps URL must be a valid URL")
	.optional()
	.or(z.literal(""));

// Strict schema applied only when deliveryMethod === "delivery" — one arm per
// store country (SG-lite, 86eynw29u), resolved via `strictAddressSchemaFor`.
// Mirrors the server-side rules in `convex/lib/address.ts` so we surface
// field-level errors before round-tripping to Convex. Also reused (via the
// same country resolution) as the standalone form schema on the tracking-page
// edit dialog.
const myStrictAddressSchema = z.object({
	line1: addressLine1Schema,
	line2: addressLine2Schema,
	city: z
		.string()
		.trim()
		.min(2, "City must be at least 2 characters")
		.max(60, "City must be at most 60 characters"),
	state: z.enum(MY_STATES, { error: () => "Select a state" }),
	postcode: z.string().regex(/^\d{5}$/, "Postcode must be 5 digits"),
	notes: addressNotesSchema,
	mapsUrl: addressMapsUrlSchema,
});

// SG arm: a 6-digit postal code and NO state/city inputs — Singapore has no
// state tier, so the form never renders those fields and the submit handlers
// stamp both as the literal "Singapore" (SG_STATE_LABEL). The schema keeps
// them as loose strings because it validates FORM state, where the two are
// dead fields; the server arm re-enforces the stored literal.
const sgStrictAddressSchema = z.object({
	line1: addressLine1Schema,
	line2: addressLine2Schema,
	city: z.string(),
	state: z.string(),
	postcode: z.string().regex(/^\d{6}$/, "Postal code must be 6 digits"),
	notes: addressNotesSchema,
	mapsUrl: addressMapsUrlSchema,
});

const STRICT_ADDRESS_SCHEMAS: Record<
	Country,
	typeof myStrictAddressSchema | typeof sgStrictAddressSchema
> = {
	MY: myStrictAddressSchema,
	SG: sgStrictAddressSchema,
};

export function strictAddressSchemaFor(country: Country) {
	return STRICT_ADDRESS_SCHEMAS[country];
}

// Loose form-state shape: every field is always present as a string so
// TanStack Form can mount the inputs whether delivery or self_collect is
// selected. Strict validation runs only when delivery is chosen.
//
// `latitude` and `longitude` are stringified numbers captured from Google
// Places autocomplete — kept as strings here to match TanStack Form's
// all-string form state. Empty when the buyer skipped autocomplete; the
// submit handler in checkout-form parses them back to numbers.
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

function buildCheckoutFormSchema(country: Country) {
	return z
		.object({
			name: z
				.string()
				.trim()
				.min(3, "Your name must be at least 3 characters")
				.max(60, "Name must be at most 60 characters"),
			// Required so the order is reachable the moment it's placed — the
			// confirmation lands in THIS number's WhatsApp (86eyf1rck). Judged by
			// the STORE's country (SG-lite) — same arm the server applies.
			waPhone: waPhoneCheckoutSchema[country],
			deliveryMethod: deliveryMethodSchema,
			address: addressFormFieldsSchema,
			// Convex id of the chosen pickup location when deliveryMethod is
			// self_collect and the retailer has 2+ active locations. The
			// "required" check lives in the submit handler because it depends on
			// runtime data (the live location count) not knowable to the schema.
			pickupLocationId: z.string(),
			// When the buyer needs the order, as a native-date "YYYY-MM-DD" string.
			// Required at checkout (the lean Date Picker spec). The actual [min, max]
			// range depends on runtime data (today + the retailer's notice setting), so
			// the precise range check lives in the submit handler — here we only require
			// that a day was picked. Empty string = nothing chosen yet.
			fulfilmentDate: z.string().min(1, "Pick when you need this order"),
			// "HH:MM" — the delivery-order time (86eyg0n8e follow-up). Prefilled and
			// only rendered for delivery, so emptiness is a cleared field; the form
			// enforces it at submit (a schema .min here would block pickup orders,
			// which never render the input).
			fulfilmentTime: z.string(),
			// Optional free-text instruction for the seller. Always a string in form
			// state (empty allowed); trimmed to undefined at submit. Cap mirrors the
			// server (MAX_CUSTOMER_NOTE in convex/orders.ts).
			note: z.string().max(500, "Note must be at most 500 characters"),
		})
		.superRefine((val, ctx) => {
			if (val.deliveryMethod !== "delivery") return;
			const result = strictAddressSchemaFor(country).safeParse(val.address);
			if (result.success) return;
			for (const issue of result.error.issues) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: issue.message,
					path: ["address", ...issue.path],
				});
			}
		});
}

// One schema instance per country, built once at module load — the checkout
// form's validator identity must be stable across renders, and an exhaustive
// build over COUNTRIES makes a missing arm a startup error, not a runtime one.
const CHECKOUT_FORM_SCHEMAS = Object.fromEntries(
	COUNTRIES.map((c) => [c, buildCheckoutFormSchema(c)]),
) as Record<Country, ReturnType<typeof buildCheckoutFormSchema>>;

export function checkoutFormSchemaFor(country: Country) {
	return CHECKOUT_FORM_SCHEMAS[country];
}

// Claim-link checkout (86eyq0epn): the storefront checkout schema minus the
// phone — the claim froze the buyer's WhatsApp number at send (it's the number
// the link was delivered to), so there's nothing to type or validate. Name
// stays editable (prefilled from the claim). Same conditional strict-address
// refinement, same per-country instances-built-once posture.
function buildClaimFormSchema(country: Country) {
	return z
		.object({
			name: z
				.string()
				.trim()
				.min(3, "Your name must be at least 3 characters")
				.max(60, "Name must be at most 60 characters"),
			deliveryMethod: deliveryMethodSchema,
			address: addressFormFieldsSchema,
			pickupLocationId: z.string(),
			fulfilmentDate: z.string().min(1, "Pick when you need this order"),
			fulfilmentTime: z.string(),
			note: z.string().max(500, "Note must be at most 500 characters"),
		})
		.superRefine((val, ctx) => {
			if (val.deliveryMethod !== "delivery") return;
			const result = strictAddressSchemaFor(country).safeParse(val.address);
			if (result.success) return;
			for (const issue of result.error.issues) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: issue.message,
					path: ["address", ...issue.path],
				});
			}
		});
}

const CLAIM_FORM_SCHEMAS = Object.fromEntries(
	COUNTRIES.map((c) => [c, buildClaimFormSchema(c)]),
) as Record<Country, ReturnType<typeof buildClaimFormSchema>>;

export function claimFormSchemaFor(country: Country) {
	return CLAIM_FORM_SCHEMAS[country];
}

export type CheckoutFormValues = z.input<
	ReturnType<typeof checkoutFormSchemaFor>
>;
export type CheckoutAddressValues = z.input<typeof addressFormFieldsSchema>;

// Standalone form schema for the tracking-page edit dialog: validates the
// address fields strictly via superRefine but keeps a loose form-state shape
// so TanStack Form mounts inputs even when fields are momentarily empty.
// Country-resolved like the checkout schema (the dialog reads the order's
// `retailerCountry`).
function buildAddressEditFormSchema(country: Country) {
	return addressFormFieldsSchema.superRefine((val, ctx) => {
		const result = strictAddressSchemaFor(country).safeParse(val);
		if (result.success) return;
		for (const issue of result.error.issues) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: issue.message,
				path: issue.path,
			});
		}
	});
}

const ADDRESS_EDIT_FORM_SCHEMAS = Object.fromEntries(
	COUNTRIES.map((c) => [c, buildAddressEditFormSchema(c)]),
) as Record<Country, ReturnType<typeof buildAddressEditFormSchema>>;

export function addressEditFormSchemaFor(country: Country) {
	return ADDRESS_EDIT_FORM_SCHEMAS[country];
}

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

// Product-level details validated by the create/edit form (name + description).
// Price / stock / sku now live per-variant and are validated in the variant
// editor (src/components/forms/variant-editor.tsx), not here. The bulk-import
// CSV/XLSX path keeps its own flat row validation. See docs/product-variants.md.
export const productDetailsSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Name is required")
		.max(120, "Name must be at most 120 characters"),
	description: z
		.string()
		.max(1000, "Description must be at most 1000 characters")
		.transform((s) => (s.trim().length > 0 ? s.trim() : undefined)),
});
