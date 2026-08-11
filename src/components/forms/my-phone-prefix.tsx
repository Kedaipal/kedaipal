/**
 * The static Malaysia country prefix for phone inputs — flag + `+60` — as
 * every payment/ride/delivery app in the market renders it (Grab, Shopee,
 * Touch 'n Go, Stripe): flag, dial code, then a rule separating the fixed part
 * from what the user types.
 *
 * The flag is an inline SVG, not an emoji and not `react-phone-number-input`'s
 * flag set. Emoji regional-indicator pairs don't render as flags on Windows
 * (Segoe UI Emoji has no flag glyphs — you get the letters "MY"), and the
 * `flags` module is a single barrel of ~250 country SVGs, which would land the
 * whole set in the public storefront bundle for one country. This is ~20 lines
 * and ships nothing extra.
 *
 * The static counterpart of `PhoneField`'s searchable country selector: the
 * dashboard may key any country, but the storefront checkout is Malaysia-only
 * by schema (`myWaPhoneCheckoutSchema`), so a picker there would be a control
 * with one valid answer.
 */

/** Jalur Gemilang at 2:1 — 14 stripes, navy canton, crescent + 14-point star. */
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

/**
 * Drop into `TextField`'s `prefix` slot. The field renders the divider, so this
 * is only the flag + dial code.
 */
export function MyPhonePrefix() {
	return (
		<>
			<FlagMY title="Malaysia" />
			{/* Inherits the plate's muted colour on purpose — the dial code is
			    fixed, the digits beside it are the buyer's. Same weighting Grab
			    and Shopee use, and it stops `+60` competing with the number. */}
			<span className="text-base font-medium tabular-nums">+60</span>
		</>
	);
}
