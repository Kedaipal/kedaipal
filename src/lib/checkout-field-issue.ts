import { postcodeRule } from "../../convex/lib/address";
import type { Country } from "../../convex/lib/country";

/**
 * The checkout's form fields in the order the buyer sees them, top to bottom.
 * The reason line above Place order names the FIRST one that's wrong, so the
 * buyer fixes the form the way they read it. A path missing here still gets
 * named — after every listed one.
 */
const FIELD_ORDER = [
	"name",
	"waPhone",
	"waDialCountry",
	"deliveryMethod",
	"address.line1",
	"address.postcode",
	"address.city",
	"address.state",
	"address.line2",
	"address.notes",
	"address.mapsUrl",
	"pickupLocationId",
	"fulfilmentDate",
	"fulfilmentTime",
	"note",
] as const;

type IssueOpts = {
	country: Country;
	collectsFromCustomer: boolean;
	/** What the disabled button does — "Add your name to continue" at
	 * checkout, "… to save" in the address edit dialog. */
	goal?: "continue" | "save";
};

/** What a BLANK field is called in "Add your … to continue". A blank field
 * not listed here falls back to its own validation message. */
function blankFieldLine(path: string, opts: IssueOpts): string | null {
	const to = `to ${opts.goal ?? "continue"}`;
	switch (path) {
		case "name":
			return `Add your name ${to}`;
		case "waPhone":
			return `Add your WhatsApp number ${to}`;
		case "address.line1":
			return opts.collectsFromCustomer
				? `Add your collection address ${to}`
				: `Add your delivery address ${to}`;
		case "address.postcode":
			return `Add your ${postcodeRule(opts.country).label.toLowerCase()} ${to}`;
		case "address.city":
			return `Add your city ${to}`;
		case "address.state":
			return `Choose your state ${to}`;
		default:
			return null;
	}
}

function messageOf(error: unknown): string | null {
	if (typeof error === "string") return error || null;
	if (error && typeof error === "object" && "message" in error) {
		const { message } = error as { message: unknown };
		return typeof message === "string" && message ? message : null;
	}
	return null;
}

function valueAt(values: unknown, path: string): unknown {
	let at = values;
	for (const key of path.split(".")) {
		if (at === null || typeof at !== "object") return undefined;
		at = (at as Record<string, unknown>)[key];
	}
	return at;
}

/**
 * Why the form itself is refusing Place order, in the buyer's words — or
 * null when no field is in error. Reads the form's OWN field errors (TanStack
 * `fieldMeta`), the exact state that turns `canSubmit` false, so the line can
 * never name a field the form isn't blocking on, nor miss one it is — even a
 * field that isn't on screen.
 *
 * A blank field reads "Add your name to continue"; a filled-but-wrong one
 * reads its validation message ("Postal code must be 6 digits").
 */
export function checkoutFieldIssueLine(
	fieldMeta: Readonly<
		Record<string, { errors?: ReadonlyArray<unknown> } | undefined>
	>,
	values: unknown,
	opts: IssueOpts,
): string | null {
	const rank = (path: string) => {
		const at = (FIELD_ORDER as readonly string[]).indexOf(path);
		return at === -1 ? FIELD_ORDER.length : at;
	};
	const failing = Object.entries(fieldMeta)
		.map(([path, meta]) => ({
			path,
			message: (meta?.errors ?? []).map(messageOf).find(Boolean) ?? null,
		}))
		.filter((f): f is { path: string; message: string } => f.message !== null)
		.sort((a, b) => rank(a.path) - rank(b.path));
	const first = failing[0];
	if (!first) return null;
	const value = valueAt(values, first.path);
	const blank = typeof value !== "string" || value.trim().length === 0;
	return (blank ? blankFieldLine(first.path, opts) : null) ?? first.message;
}

/**
 * The same line for a form whose values ARE the address — the tracking-page
 * address edit dialog, where TanStack's paths are `postcode`, not
 * `address.postcode`. Its Save disables on `canSubmit` exactly like Place
 * order (e.g. after "Search again" empties the location), so it owes the
 * buyer the same reason.
 */
export function addressFieldIssueLine(
	fieldMeta: Readonly<
		Record<string, { errors?: ReadonlyArray<unknown> } | undefined>
	>,
	values: unknown,
	opts: IssueOpts,
): string | null {
	return checkoutFieldIssueLine(
		Object.fromEntries(
			Object.entries(fieldMeta).map(([path, meta]) => [
				`address.${path}`,
				meta,
			]),
		),
		{ address: values },
		opts,
	);
}
