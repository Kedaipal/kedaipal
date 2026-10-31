import { describe, expect, it } from "vitest";
import {
	addressFieldIssueLine,
	checkoutFieldIssueLine,
} from "./checkout-field-issue";

const MY = { country: "MY" as const, collectsFromCustomer: false };
const SG = { country: "SG" as const, collectsFromCustomer: false };

/** TanStack's field errors are Standard Schema issues: `{ message }`. */
const err = (message: string) => ({ errors: [{ message }] });

const values = (over: Record<string, unknown> = {}) => ({
	name: "",
	waPhone: "",
	address: { line1: "", postcode: "", city: "", state: "" },
	fulfilmentDate: "",
	...over,
});

describe("checkoutFieldIssueLine — the reason Place order is disabled", () => {
	it("is null when no field is in error", () => {
		expect(checkoutFieldIssueLine({}, values(), MY)).toBeNull();
		expect(
			checkoutFieldIssueLine({ name: { errors: [] } }, values(), MY),
		).toBeNull();
	});

	it("names a blank name in buyer words, not the length rule", () => {
		expect(
			checkoutFieldIssueLine(
				{ name: err("Your name must be at least 3 characters") },
				values(),
				MY,
			),
		).toBe("Add your name to continue");
	});

	it("a filled-but-wrong field reads its own validation message", () => {
		expect(
			checkoutFieldIssueLine(
				{ name: err("Your name must be at least 3 characters") },
				values({ name: "Al" }),
				MY,
			),
		).toBe("Your name must be at least 3 characters");
	});

	it("names the FIRST field the buyer sees, whatever order the errors arrive in", () => {
		const meta = {
			fulfilmentDate: err("Pick when you need this order"),
			"address.postcode": err("Postal code must be 6 digits"),
			waPhone: err("Enter your WhatsApp number"),
		};
		expect(checkoutFieldIssueLine(meta, values(), SG)).toBe(
			"Add your WhatsApp number to continue",
		);
		const { waPhone: _, ...afterPhone } = meta;
		expect(checkoutFieldIssueLine(afterPhone, values(), SG)).toBe(
			"Add your postal code to continue",
		);
	});

	it("a postcode the Google pick didn't carry is named by the store country's word", () => {
		const meta = { "address.postcode": err("Postcode must be 5 digits") };
		expect(checkoutFieldIssueLine(meta, values(), MY)).toBe(
			"Add your postcode to continue",
		);
		expect(checkoutFieldIssueLine(meta, values(), SG)).toBe(
			"Add your postal code to continue",
		);
	});

	it("a bad postcode (not blank) quotes the rule", () => {
		expect(
			checkoutFieldIssueLine(
				{ "address.postcode": err("Postal code must be 6 digits") },
				values({
					address: { line1: "x", postcode: "1234", city: "", state: "" },
				}),
				SG,
			),
		).toBe("Postal code must be 6 digits");
	});

	it("an empty state is chosen, not added", () => {
		expect(
			checkoutFieldIssueLine(
				{ "address.state": err("Select a state") },
				values(),
				MY,
			),
		).toBe("Choose your state to continue");
	});

	it("a collection-service store asks for the collection address", () => {
		const meta = {
			"address.line1": err("Address line 1 must be at least 3 characters"),
		};
		expect(checkoutFieldIssueLine(meta, values(), MY)).toBe(
			"Add your delivery address to continue",
		);
		expect(
			checkoutFieldIssueLine(meta, values(), {
				...MY,
				collectsFromCustomer: true,
			}),
		).toBe("Add your collection address to continue");
	});

	it("a blank field with no buyer noun falls back to its message", () => {
		expect(
			checkoutFieldIssueLine(
				{ fulfilmentDate: err("Pick when you need this order") },
				values(),
				MY,
			),
		).toBe("Pick when you need this order");
	});

	it("a field outside the known order is still named, after every known one", () => {
		const meta = {
			somethingNew: err("Something new is wrong"),
			note: err("Note must be at most 500 characters"),
		};
		expect(
			checkoutFieldIssueLine(meta, values({ note: "x".repeat(501) }), MY),
		).toBe("Note must be at most 500 characters");
		expect(
			checkoutFieldIssueLine(
				{ somethingNew: err("Something new is wrong") },
				values(),
				MY,
			),
		).toBe("Something new is wrong");
	});

	it("reads string errors as well as issue objects, and skips empty ones", () => {
		expect(
			checkoutFieldIssueLine(
				{ name: { errors: [undefined, "", "Name is off"] } },
				values({ name: "Zz" }),
				MY,
			),
		).toBe("Name is off");
	});
});

describe("addressFieldIssueLine — the address edit dialog's Save", () => {
	it("reads un-prefixed address paths and says 'to save'", () => {
		expect(
			addressFieldIssueLine(
				{
					state: err("Select a state"),
					postcode: err("Postcode must be 5 digits"),
				},
				{ line1: "Jalan Ceylon", postcode: "", city: "", state: "" },
				{ ...MY, goal: "save" },
			),
		).toBe("Add your postcode to save");
	});

	it("a filled-but-wrong field still quotes its rule", () => {
		expect(
			addressFieldIssueLine(
				{ postcode: err("Postal code must be 6 digits") },
				{ line1: "x", postcode: "4601", city: "", state: "" },
				{ ...SG, goal: "save" },
			),
		).toBe("Postal code must be 6 digits");
	});
});
