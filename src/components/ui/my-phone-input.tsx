/**
 * The one plated phone control (86eyknr2r; per-country since SG-lite
 * 86eynw28q/86eynw2dy).
 *
 * Every field in the app that takes a store-country phone number renders the
 * same shape — flag, fixed `+60`/`+65`, a rule, then what the user types — as
 * every payment/ride app in this market does (Grab, Shopee, Touch 'n Go,
 * Stripe). Before this the repo had three shapes for one question: this plate
 * (storefront checkout only), a bare `<input type="tel">` with a placeholder,
 * and a 250-country searchable combobox, which is a control with one valid
 * answer per store.
 *
 * The plate is **a promise about what the field accepts**: the country it
 * renders and the country the validator judges by must be the SAME, or it tells
 * the user to type something the save then rejects. It comes in two variants,
 * split by whose number the field holds:
 *
 * - **Seller / platform numbers** (the store's own WhatsApp, alert and
 *   pickup-manager numbers, admin fields) — `MyPhonePrefix` / `MyPhoneInput`:
 *   a FIXED plate for the store's country, validated by
 *   `assertValidMobileForCountry` (`convex/lib/slug.ts`). A store's number is
 *   its identity and the couriers' sender contact, so it stays store-locked.
 *   The default stays "MY" so Kedaipal's own Malaysia-fixed fields need no prop.
 * - **Buyer numbers** (storefront + booking checkout, the track page's number
 *   repair, the counter's manual bind) — `BuyerPhonePrefix` / `BuyerPhoneInput`
 *   (z8r3fdh274): the same plate carrying a country PICKER, defaulting to the
 *   store's country, validated by `assertValidBuyerWaPhone` /
 *   `parseBuyerWaPhone` (`convex/lib/buyerPhone.ts`) against the PICKED
 *   country. A buyer's number is per-person — the JB↔SG corridor, tourists,
 *   an event's overseas participants — so the "one valid answer per store"
 *   premise that removed the old combobox holds for sellers only.
 *
 * Two hosts per variant, one plate, so they can't drift:
 *   - form-bound  → `TextField` with `prefix={<MyPhonePrefix … />}` or
 *                   `prefix={<BuyerPhonePrefix … />}`
 *   - plain state → `MyPhoneInput` / `BuyerPhoneInput` (value/onChange)
 * Both render through `InputPrefixFrame` (`ui/input-prefix-frame.tsx`), which
 * owns the border, focus ring and invalid styling for the composite control.
 * See docs/phone-numbers.md.
 */

import { ChevronDown } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { InputPrefixFrame } from "#/components/ui/input-prefix-frame";
import {
	type DialIso,
	dialCodeLabel,
	dialCountryName,
	NEARBY_DIAL_COUNTRIES,
} from "../../../convex/lib/buyerPhone";
import {
	COUNTRY_DIAL_CODE,
	COUNTRY_LABELS,
	type Country,
	isCountry,
} from "../../../convex/lib/country";
import { DIAL_ROWS } from "../../../convex/lib/dialCodes";
import { detectTypedDialCode } from "../../../convex/lib/phoneDial";

/**
 * Jalur Gemilang at 2:1 — 14 stripes, navy canton, crescent + 14-point star.
 *
 * An inline SVG, not an emoji and not `react-phone-number-input`'s flag set.
 * Emoji regional-indicator pairs don't render as flags on Windows (Segoe UI
 * Emoji has no flag glyphs — you get the letters "MY"), and the `flags` module
 * is a single barrel of ~250 country SVGs, which would land the whole set in
 * the public storefront bundle for two countries. This is ~20 lines and ships
 * nothing extra.
 */
function FlagMY({ title }: { title: string }) {
	return (
		<svg
			viewBox="0 0 28 14"
			role="img"
			aria-label={title}
			className="h-3.5 w-7 shrink-0 rounded-[2px] ring-1 ring-black/10"
		>
			<rect width="28" height="14" fill="#fff" />
			{/* 7 red stripes on the odd bands — the flag starts and ends light/dark
			    correctly at 14 bands (top red, bottom white). */}
			{[0, 2, 4, 6, 8, 10, 12].map((y) => (
				<rect key={y} x="0" y={y} width="28" height="1" fill="#CC0001" />
			))}
			<rect x="0" y="0" width="14" height="8" fill="#010066" />
			{/* Crescent: a yellow disc with a navy disc bitten out of it. */}
			<circle cx="5.6" cy="4" r="2.45" fill="#FFCC00" />
			<circle cx="6.6" cy="4" r="2.1" fill="#010066" />
			{/* Bintang Pecah Empat Belas — 14 points. The inner radius is
			    deliberately chunky (1.35 of 2.0): thin spikes read as a sunburst
			    smudge once this is 14px tall. */}
			<polygon
				fill="#FFCC00"
				points="9.60,2.00 9.90,2.68 10.47,2.20 10.44,2.94 11.16,2.75 10.82,3.41 11.55,3.55 10.95,4.00 11.55,4.45 10.82,4.59 11.16,5.25 10.44,5.06 10.47,5.80 9.90,5.32 9.60,6.00 9.30,5.32 8.73,5.80 8.76,5.06 8.04,5.25 8.38,4.59 7.65,4.45 8.25,4.00 7.65,3.55 8.38,3.41 8.04,2.75 8.76,2.94 8.73,2.20 9.30,2.68"
			/>
		</svg>
	);
}

/** A five-pointed star (unit outer radius, centred on 0,0) — reused for the
 * SG flag's pentagon of stars via translate/scale. */
const STAR_5_POINTS =
	"0,-1 0.235,-0.324 0.951,-0.309 0.380,0.124 0.588,0.809 0,0.4 -0.588,0.809 -0.380,0.124 -0.951,-0.309 -0.235,-0.324";

/**
 * The Singapore flag at the same 2:1 plate ratio — red top half, white bottom,
 * white crescent + pentagon of five stars in the red canton. Same inline-SVG
 * posture as `FlagMY` (no emoji, no flag-set dependency).
 */
function FlagSG({ title }: { title: string }) {
	return (
		<svg
			viewBox="0 0 28 14"
			role="img"
			aria-label={title}
			className="h-3.5 w-7 shrink-0 rounded-[2px] ring-1 ring-black/10"
		>
			<rect width="28" height="14" fill="#fff" />
			<rect width="28" height="7" fill="#ED2939" />
			{/* Crescent: a white disc with a red disc bitten out of it. */}
			<circle cx="5.2" cy="3.5" r="2.5" fill="#fff" />
			<circle cx="6.2" cy="3.5" r="2.15" fill="#ED2939" />
			{/* Pentagon of five stars beside the crescent. */}
			{[
				[9.5, 1.9],
				[8.0, 3.0],
				[11.0, 3.0],
				[8.6, 4.7],
				[10.4, 4.7],
			].map(([x, y]) => (
				<polygon
					key={`${x}-${y}`}
					fill="#fff"
					points={STAR_5_POINTS}
					transform={`translate(${x} ${y}) scale(0.75)`}
				/>
			))}
		</svg>
	);
}

const FLAG: Record<Country, (props: { title: string }) => React.ReactElement> =
	{
		MY: FlagMY,
		SG: FlagSG,
	};

/**
 * Default placeholder per country — the bare national number the plate asks
 * for, and (pinned by test) a value the country's own schema accepts.
 */
export const MOBILE_PLACEHOLDER: Record<Country, string> = {
	MY: "12-345 6789",
	SG: "9123 4567",
};

/**
 * The plate's contents — flag + dial code for the store's country. Drop into
 * `TextField`'s `prefix` slot; the frame draws the divider around it.
 */
export function MyPhonePrefix({ country = "MY" }: { country?: Country }) {
	const Flag = FLAG[country];
	return (
		<>
			<Flag title={COUNTRY_LABELS[country]} />
			{/* Inherits the plate's muted colour on purpose — the dial code is
			    fixed, the digits beside it are the user's. Same weighting Grab and
			    Shopee use, and it stops the code competing with the number. */}
			<span className="text-base font-medium tabular-nums">
				+{COUNTRY_DIAL_CODE[country]}
			</span>
		</>
	);
}

type MyPhoneInputProps = Omit<
	React.ComponentProps<"input">,
	"type" | "onChange" | "value" | "prefix"
> & {
	value: string;
	/** Receives the raw typed string — normalize on submit, not per keystroke. */
	onChange: (value: string) => void;
	isError?: boolean;
	/** The store's country — picks the flag, dial code, and placeholder. MUST
	 * match the country the save path validates by (the plate's promise). */
	country?: Country;
};

/**
 * Standalone plated phone field for the plain-`useState` forms (settings cards,
 * the buyer's number-repair form, onboarding, the admin console). Form-bound
 * callers should use `TextField` with `prefix={<MyPhonePrefix country={…} />}`
 * instead so they inherit label/description/error wiring.
 *
 * The value is whatever the user typed — `waPhoneCheckoutSchema[country]`
 * (client) and `assertValidMobileForCountry` (server) both accept the bare
 * national number the plate asks for (`12-345 6789` / `9123 4567`), the local
 * MY `012-…`, and the full international form, so nobody is punished for
 * reading the badge or for ignoring it.
 */
export function MyPhoneInput({
	value,
	onChange,
	isError = false,
	disabled = false,
	className,
	country = "MY",
	placeholder,
	...props
}: MyPhoneInputProps) {
	return (
		<InputPrefixFrame
			prefix={<MyPhonePrefix country={country} />}
			invalid={isError}
			disabled={disabled}
			className={className}
		>
			<Input
				type="tel"
				inputMode="tel"
				autoComplete="tel"
				variant="bare"
				// The frame paints the invalid border; the input still has to carry
				// `aria-invalid` or a screen-reader user gets no signal at all.
				isError={isError}
				disabled={disabled}
				placeholder={placeholder ?? MOBILE_PLACEHOLDER[country]}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="min-h-11 px-3 text-base"
				{...props}
			/>
		</InputPrefixFrame>
	);
}

// ---------------------------------------------------------------------------
// Buyer fields: the plate carries a country picker (z8r3fdh274)
// ---------------------------------------------------------------------------

/**
 * Placeholder for the picked country — the bare national number the plate asks
 * for. MY/SG show a real example; elsewhere we have no per-country example, and
 * a made-up one would be a format the buyer then can't match.
 */
export function buyerPhonePlaceholder(dialCountry: DialIso): string {
	return isCountry(dialCountry)
		? MOBILE_PLACEHOLDER[dialCountry]
		: "Mobile number";
}

/**
 * What a keystroke does to a buyer phone field: a typed or pasted `+CC…` /
 * `00CC…` moves the picker to that country and leaves only the national part
 * in the box (so the plate never reads `+81 | +81 90…`). Everything else is
 * kept exactly as typed. Both hosts route `onChange` through this.
 */
export function applyBuyerPhoneKeystroke(
	typed: string,
	dialCountry: DialIso,
): { value: string; dialCountry: DialIso } {
	const detected = detectTypedDialCode(typed, dialCountry);
	return detected
		? { value: detected.rest, dialCountry: detected.iso }
		: { value: typed, dialCountry };
}

/** Flag-sized ISO badge for the countries without an inline flag — same 28×14
 * footprint, so the plate doesn't change width as the pick changes. */
function IsoBadge({ iso }: { iso: DialIso }) {
	return (
		<span
			aria-hidden
			className="inline-flex h-3.5 w-7 shrink-0 items-center justify-center rounded-[2px] bg-background font-semibold text-[9px] text-foreground leading-none tracking-wide ring-1 ring-black/10 dark:ring-white/15"
		>
			{iso}
		</span>
	);
}

function optionLabel(iso: DialIso): string {
	return `${dialCountryName(iso)} (${dialCodeLabel(iso)})`;
}

/**
 * The buyer plate's contents: flag (or ISO badge) + dial code + chevron, with a
 * native `<select>` laid invisibly over the whole plate. Native on purpose —
 * the OS picker is the mobile-friendly, accessible, zero-dependency list
 * (iOS wheel, Android sheet, desktop type-ahead); it is not the searchable
 * combobox 86eyknr2r removed, and nothing ships but a table of dial codes.
 *
 * Order: the store's country, then its `Nearby` neighbours, then every country
 * A–Z (the neighbours repeat there so an alphabetical scroll never misses one).
 * The select never carries `aria-invalid`: the error belongs to the number, and
 * focus-on-error must land in the input, not on the picker.
 */
export function BuyerPhonePrefix({
	storeCountry,
	dialCountry,
	onDialCountryChange,
	disabled = false,
}: {
	storeCountry: Country;
	dialCountry: DialIso;
	onDialCountryChange: (iso: DialIso) => void;
	disabled?: boolean;
}) {
	const nearby = NEARBY_DIAL_COUNTRIES[storeCountry];
	return (
		<>
			<select
				aria-label="Country of your WhatsApp number"
				value={dialCountry}
				disabled={disabled}
				onChange={(e) => onDialCountryChange(e.target.value as DialIso)}
				// 16px so iOS Safari doesn't zoom on focus, even at opacity 0.
				className="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none text-base opacity-0 disabled:cursor-not-allowed"
			>
				<option value={storeCountry}>{optionLabel(storeCountry)}</option>
				<optgroup label="Nearby">
					{nearby.map((iso) => (
						<option key={iso} value={iso}>
							{optionLabel(iso)}
						</option>
					))}
				</optgroup>
				<optgroup label="All countries">
					{DIAL_ROWS.map((row) => (
						<option key={row.iso} value={row.iso}>
							{optionLabel(row.iso)}
						</option>
					))}
				</optgroup>
			</select>
			{/* Hover wash for the whole plate — the select above is invisible, so
			    this is what says "tap me" on desktop. */}
			<span
				aria-hidden
				className="pointer-events-none absolute inset-0 transition-colors peer-hover:bg-muted peer-disabled:bg-transparent"
			/>
			<span className="relative flex items-center gap-1.5">
				{/* The select already announces the country; the flag is decoration
				    here, hidden rather than read twice. */}
				<span aria-hidden className="flex">
					{isCountry(dialCountry) ? (
						(() => {
							const Flag = FLAG[dialCountry];
							return <Flag title={COUNTRY_LABELS[dialCountry]} />;
						})()
					) : (
						<IsoBadge iso={dialCountry} />
					)}
				</span>
				<span className="text-base font-medium tabular-nums">
					{dialCodeLabel(dialCountry)}
				</span>
				<ChevronDown aria-hidden className="-ml-0.5 size-4 shrink-0" />
			</span>
		</>
	);
}

type BuyerPhoneInputProps = Omit<
	React.ComponentProps<"input">,
	"type" | "onChange" | "value" | "prefix"
> & {
	value: string;
	/** Receives the typed string (minus any `+CC` the picker absorbed) —
	 * normalize on submit with `parseBuyerWaPhone`, not per keystroke. */
	onChange: (value: string) => void;
	/** The store's country: the picker's first option and its default. */
	storeCountry: Country;
	dialCountry: DialIso;
	onDialCountryChange: (iso: DialIso) => void;
	isError?: boolean;
};

/**
 * Plain-state buyer phone field (booking checkout, the track page's number
 * repair, the counter's manual bind). Form-bound callers use `TextField` with
 * `prefix={<BuyerPhonePrefix … />}` and route `onChange` through
 * `applyBuyerPhoneKeystroke`, so both hosts behave the same.
 *
 * Its validator is `parseBuyerWaPhone` / `assertValidBuyerWaPhone`
 * (`convex/lib/buyerPhone.ts`), judged by the picked country — the plate's
 * promise, kept.
 */
export function BuyerPhoneInput({
	value,
	onChange,
	storeCountry,
	dialCountry,
	onDialCountryChange,
	isError = false,
	disabled = false,
	className,
	placeholder,
	...props
}: BuyerPhoneInputProps) {
	return (
		<InputPrefixFrame
			prefix={
				<BuyerPhonePrefix
					storeCountry={storeCountry}
					dialCountry={dialCountry}
					onDialCountryChange={onDialCountryChange}
					disabled={disabled}
				/>
			}
			invalid={isError}
			disabled={disabled}
			className={className}
		>
			<Input
				type="tel"
				inputMode="tel"
				autoComplete="tel"
				variant="bare"
				isError={isError}
				disabled={disabled}
				placeholder={placeholder ?? buyerPhonePlaceholder(dialCountry)}
				value={value}
				onChange={(e) => {
					const next = applyBuyerPhoneKeystroke(e.target.value, dialCountry);
					if (next.dialCountry !== dialCountry)
						onDialCountryChange(next.dialCountry);
					onChange(next.value);
				}}
				className="min-h-11 px-3 text-base"
				{...props}
			/>
		</InputPrefixFrame>
	);
}

/**
 * The rejection's one-tap fix: typed digits that fit the OTHER supported
 * country ("9123 4567" under +60) get a button that switches the picker —
 * `parseBuyerWaPhone(...).suggest`. The action names its consequence.
 */
export function BuyerPhoneCountrySwitch({
	suggest,
	onSwitch,
	locale,
}: {
	suggest: Country;
	onSwitch: (country: Country) => void;
	locale?: string;
}) {
	const label = `${COUNTRY_LABELS[suggest]} (+${COUNTRY_DIAL_CODE[suggest]})`;
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="tap-target self-start"
			onClick={() => onSwitch(suggest)}
		>
			{locale === "ms" ? `Tukar ke ${label}` : `Switch to ${label}`}
		</Button>
	);
}
