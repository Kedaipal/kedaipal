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
 * renders and the country the validator judges by must be the SAME retailer
 * country, or it tells the user to type something the save then rejects. Every
 * adopting call site pairs with `assertValidMobileForCountry` (see
 * `convex/lib/slug.ts`) and threads the store's country into `country` here.
 * The default stays "MY" so the platform's own Malaysia-fixed fields need no
 * prop. The counter's manual buyer bind deliberately does NOT wear the plate —
 * it passes a foreign number through by design, for a cashier serving a
 * walk-in from anywhere.
 *
 * Two hosts, one plate, so they can't drift:
 *   - form-bound  → `TextField` with `prefix={<MyPhonePrefix country={…} />}`
 *   - plain state → `MyPhoneInput` (value/onChange), for the `useState` forms
 * Both render through `InputPrefixFrame` (`ui/input-prefix-frame.tsx`), which
 * owns the border, focus ring and invalid styling for the composite control.
 */

import { Input } from "#/components/ui/input";
import { InputPrefixFrame } from "#/components/ui/input-prefix-frame";
import {
	COUNTRY_DIAL_CODE,
	COUNTRY_LABELS,
	type Country,
} from "../../../convex/lib/country";

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
