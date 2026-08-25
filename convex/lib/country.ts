import { type SupportedCurrency } from "./currency";

/**
 * Store countries (SG-lite, 86eynw27f). One switch every country-shaped rule
 * reads: the checkout phone plate/validator arm (+60 vs +65), the address
 * variant (MY states + 5-digit postcode vs SG 6-digit postal code), the Places
 * autocomplete region, and the currency a new store is born with.
 *
 * Kept as a closed set (the SUPPORTED_CURRENCIES pattern) so the settings
 * dropdown, onboarding picker, server validator, and every per-country branch
 * agree — adding a country here makes each `Record<Country, …>` lookup a
 * compile error until the new arm exists, never a silent MY fallback.
 *
 * `retailers.country` is optional; undefined is treated as MY everywhere
 * (every pre-existing store, zero migration).
 */
export const COUNTRIES = ["MY", "SG"] as const;

export type Country = (typeof COUNTRIES)[number];

export const DEFAULT_COUNTRY: Country = "MY";

export const COUNTRY_LABELS: Record<Country, string> = {
	MY: "Malaysia",
	SG: "Singapore",
};

/**
 * International dialing code, digits only ("60" / "65") — what a stored
 * WhatsApp number starts with and what the phone-input plate renders as
 * `+{code}`. The phone validators in `./slug.ts` key their per-country arms
 * off this.
 */
export const COUNTRY_DIAL_CODE: Record<Country, string> = {
	MY: "60",
	SG: "65",
};

/**
 * The currency a store in this country is born with (createRetailer). A
 * default only — currency stays its own setting and can diverge afterwards.
 */
export const COUNTRY_CURRENCY: Record<Country, SupportedCurrency> = {
	MY: "MYR",
	SG: "SGD",
};

export function isCountry(value: string): value is Country {
	return (COUNTRIES as readonly string[]).includes(value);
}

export function assertCountry(value: string): Country {
	if (!isCountry(value)) {
		throw new Error(
			`Unsupported country "${value}". Supported: ${COUNTRIES.join(", ")}`,
		);
	}
	return value;
}
