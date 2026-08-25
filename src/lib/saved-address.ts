import { type Country, DEFAULT_COUNTRY } from "../../convex/lib/country";
import { type CheckoutAddressValues, emptyAddress } from "./schemas";

/**
 * The buyer's last-used checkout address, persisted per device — namespaced
 * PER COUNTRY (SG-lite, 86eynw29u). One global key cross-contaminated:
 * a stored MY address restored `state: "Selangor"` invisibly into an SG form
 * (no state field renders there, so it was submittable), and its 5-digit
 * postcode failed the 6-digit rule with no visible cause. Namespacing keeps
 * each variant's saved address intact instead of discarding on mismatch — a
 * buyer who shops both an MY and an SG store keeps both prefills.
 *
 * MY deliberately keeps the ORIGINAL un-suffixed key so every existing
 * buyer's saved address survives this change.
 */
const LEGACY_ADDRESS_STORAGE_KEY = "kedaipal:lastAddress";

export function addressStorageKey(country: Country): string {
	return country === DEFAULT_COUNTRY
		? LEGACY_ADDRESS_STORAGE_KEY
		: `${LEGACY_ADDRESS_STORAGE_KEY}:${country}`;
}

export function loadSavedAddress(country: Country): CheckoutAddressValues {
	if (typeof window === "undefined") return emptyAddress;
	try {
		const raw = window.localStorage.getItem(addressStorageKey(country));
		if (!raw) return emptyAddress;
		const parsed = JSON.parse(raw);
		return {
			line1: typeof parsed.line1 === "string" ? parsed.line1 : "",
			line2: typeof parsed.line2 === "string" ? parsed.line2 : "",
			city: typeof parsed.city === "string" ? parsed.city : "",
			state: typeof parsed.state === "string" ? parsed.state : "",
			postcode: typeof parsed.postcode === "string" ? parsed.postcode : "",
			notes: typeof parsed.notes === "string" ? parsed.notes : "",
			mapsUrl: typeof parsed.mapsUrl === "string" ? parsed.mapsUrl : "",
			latitude: typeof parsed.latitude === "string" ? parsed.latitude : "",
			longitude: typeof parsed.longitude === "string" ? parsed.longitude : "",
			placeId: typeof parsed.placeId === "string" ? parsed.placeId : "",
		};
	} catch {
		return emptyAddress;
	}
}

export function saveAddress(
	country: Country,
	addr: CheckoutAddressValues,
): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			addressStorageKey(country),
			JSON.stringify(addr),
		);
	} catch {
		// Quota errors / privacy mode — silently ignore.
	}
}
