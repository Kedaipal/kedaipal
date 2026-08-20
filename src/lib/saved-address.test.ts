// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	addressStorageKey,
	loadSavedAddress,
	saveAddress,
} from "./saved-address";
import { emptyAddress } from "./schemas";

const MY_ADDRESS = {
	...emptyAddress,
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

const SG_ADDRESS = {
	...emptyAddress,
	line1: "12 Bedok North Ave 3",
	city: "Singapore",
	state: "Singapore",
	postcode: "238859",
};

beforeEach(() => {
	window.localStorage.clear();
});

describe("saved checkout address — per-country namespace (86eynw29u)", () => {
	it("MY keeps the ORIGINAL un-suffixed key so existing saves survive", () => {
		expect(addressStorageKey("MY")).toBe("kedaipal:lastAddress");
		expect(addressStorageKey("SG")).toBe("kedaipal:lastAddress:SG");
	});

	it("an MY save never restores into an SG checkout (and vice versa)", () => {
		saveAddress("MY", MY_ADDRESS);
		// The cross-contamination bug: "Selangor" + a 5-digit postcode restored
		// invisibly into an SG form. Namespacing makes the restore come up empty.
		expect(loadSavedAddress("SG")).toEqual(emptyAddress);

		saveAddress("SG", SG_ADDRESS);
		expect(loadSavedAddress("SG").postcode).toBe("238859");
		// …and the MY save is still intact, not discarded.
		expect(loadSavedAddress("MY").state).toBe("Selangor");
	});

	it("a pre-namespace legacy save still restores for MY checkouts", () => {
		window.localStorage.setItem(
			"kedaipal:lastAddress",
			JSON.stringify(MY_ADDRESS),
		);
		expect(loadSavedAddress("MY").line1).toBe("12 Jln Mawar 3");
	});

	it("malformed or missing storage restores the empty address", () => {
		expect(loadSavedAddress("MY")).toEqual(emptyAddress);
		window.localStorage.setItem("kedaipal:lastAddress", "{not json");
		expect(loadSavedAddress("MY")).toEqual(emptyAddress);
		// Non-string fields are dropped, never restored as-is.
		window.localStorage.setItem(
			"kedaipal:lastAddress",
			JSON.stringify({ line1: 42, state: ["Selangor"] }),
		);
		expect(loadSavedAddress("MY")).toEqual(emptyAddress);
	});
});
