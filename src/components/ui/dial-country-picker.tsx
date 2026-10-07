/**
 * The buyer's country-code picker (z8r3fdm36y) — a searchable sheet.
 *
 * Replaces the native `<select>` overlaid on the phone plate. That select was a
 * deliberate choice (`86eyknr2r` had just removed a 250-country `cmdk` +
 * `react-phone-number-input` combobox, and the OS list is accessible and ships
 * nothing), but it held **241 options** and could not be searched by the one
 * string the plate actually prints: typing `+81` or `81` matched nothing, and
 * on a phone there was no search field at all — an iOS wheel with 241 stops.
 *
 * What that earlier decision was protecting is kept intact here:
 *
 *  - **No new dependencies.** This is the house `Sheet` (radix Dialog, already
 *    in) + the house `Input`, over the `DIAL_ROWS` table that already shipped.
 *  - **No flag-set barrel.** MY/SG keep their inline SVG flags, everywhere else
 *    keeps the same-size ISO badge, so the public storefront bundle grows by
 *    this file and nothing else.
 *
 * **One control, both breakpoints.** `Sheet` is a bottom sheet on a phone and a
 * centred panel at `sm+` — the house idiom (`product-detail-sheet`,
 * `manual-payment-dialog`) and the shape every payment app in this market uses
 * for exactly this picker. A popover on desktop and a sheet on mobile would be
 * two codepaths for one concept, which is how a control starts drifting.
 *
 * The listbox is the real one; the trigger button carries no `aria-invalid`
 * (the error belongs to the NUMBER, and focus-on-error must land in the input,
 * not here) — unchanged from the select it replaces.
 */

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "#/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import {
	allDialCountries,
	type DialCountryOption,
	dialCountryOption,
	searchDialCountries,
} from "#/lib/dial-country-search";
import { flagEmoji, useFlagEmojiSupport } from "#/lib/flag-emoji";
import { cn } from "#/lib/utils";
import type { DialIso } from "../../../convex/lib/buyerPhone";
import { NEARBY_DIAL_COUNTRIES } from "../../../convex/lib/buyerPhone";
import type { Country } from "../../../convex/lib/country";

/** One flat row in the rendered list, with the group header it sits under. */
interface ListRow {
	option: DialCountryOption;
	/** Rendered above this row when present. */
	heading?: string;
	/**
	 * React key. Group-scoped, not the array index: a neighbour deliberately
	 * appears twice (under Suggested AND in the A–Z list), so the ISO alone
	 * collides and the index would re-key every row as the query changes.
	 */
	key: string;
}

/**
 * The rows to paint. A query flattens the list — group headings over a filtered
 * result set are noise, and the ranking has already decided the order. With no
 * query the shape the `<select>` used is preserved: the store's country first,
 * its neighbours next, then everything A–Z.
 *
 * The neighbours deliberately REPEAT in "All countries" (as the select's
 * optgroups did), so an alphabetical scroll never skips one.
 */
function buildRows(
	query: string,
	storeCountry: Country,
	suggestedLabel: string,
): ListRow[] {
	if (query.trim() !== "") {
		return searchDialCountries(query).map((option) => ({
			option,
			key: `hit-${option.iso}`,
		}));
	}
	const nearby = NEARBY_DIAL_COUNTRIES[storeCountry];
	const suggested: DialIso[] = [storeCountry, ...nearby];
	const rows: ListRow[] = suggested.map((iso, i) => ({
		option: dialCountryOption(iso),
		heading: i === 0 ? suggestedLabel : undefined,
		key: `suggested-${iso}`,
	}));
	allDialCountries().forEach((option, i) => {
		rows.push({
			option,
			heading: i === 0 ? "All countries" : undefined,
			key: `all-${option.iso}`,
		});
	});
	return rows;
}

/**
 * One country's mark, 28x14 whatever it draws, so the rows keep their rhythm
 * and the plate never changes width.
 *
 * `emoji` is the device-wide answer from `supportsFlagEmoji`, passed in rather
 * than measured per row: it decides the WHOLE list at once, so a device shows
 * flags everywhere or badges everywhere and never a mix. See `flag-emoji.ts`
 * for why shipping flag artwork was priced and rejected.
 *
 * `flags` still wins where it has an entry. That is the plate's MY/SG pair:
 * those are inline SVGs that render identically on every device and, unlike the
 * emoji, are safe during SSR — the plate paints on the first byte, the list
 * only ever opens from a tap.
 */
function FlagOrBadge({
	iso,
	flags,
	emoji,
}: {
	iso: DialIso;
	flags?: Partial<Record<string, (p: { title: string }) => React.ReactElement>>;
	emoji: boolean;
}) {
	const Flag = flags?.[iso];
	if (Flag)
		return (
			// Decoration at both call sites — the trigger carries the button's
			// accessible name, and a list row has the country name beside it. The
			// flags take a `title`, so hiding happens on the wrapper.
			<span aria-hidden className="flex">
				<Flag title="" />
			</span>
		);
	if (emoji)
		return (
			// `leading-none` + a fixed box: an emoji sits on the text baseline and
			// would otherwise push the 44px row around as the glyph's height varies
			// between platforms.
			<span
				aria-hidden
				className="inline-flex h-3.5 w-7 shrink-0 items-center justify-center text-base leading-none"
			>
				{flagEmoji(iso)}
			</span>
		);
	return (
		<span
			aria-hidden
			className="inline-flex h-3.5 w-7 shrink-0 items-center justify-center rounded-[2px] bg-background font-semibold text-[9px] text-foreground leading-none tracking-wide ring-1 ring-black/10 dark:ring-white/15"
		>
			{iso}
		</span>
	);
}

export function DialCountryPicker({
	storeCountry,
	value,
	onChange,
	disabled = false,
	label,
	flags,
	/** Heading over the store's country + its neighbours. */
	suggestedLabel = "Suggested",
}: {
	storeCountry: Country;
	value: DialIso;
	onChange: (iso: DialIso) => void;
	disabled?: boolean;
	/** Accessible name of the control — "your" on the buyer's own screens, "the
	 * buyer's" at the counter, where a cashier keys someone else's number. */
	label: string;
	/** The inline MY/SG flags, injected so this file pulls in no flag assets. */
	flags: Partial<Record<string, (p: { title: string }) => React.ReactElement>>;
	suggestedLabel?: string;
}) {
	// One answer for the whole control, read through `useSyncExternalStore` so
	// the first client paint matches the SSR HTML and the flags arrive a tick
	// later. Reading the probe directly during render was wrong: the comment
	// here used to claim SSR only ever paints an MY/SG plate, but a FOREIGN
	// dial country can be prefilled (the `/track` repair form), and that plate
	// would have rendered a badge on the server and a flag on the client.
	const emoji = useFlagEmojiSupport();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const baseId = useId();

	const rows = useMemo(
		() => buildRows(query, storeCountry, suggestedLabel),
		[query, storeCountry, suggestedLabel],
	);
	const current = dialCountryOption(value);

	// Opening lands on the CURRENT pick, not on row 0 — the list is 241 long and
	// "where am I now?" is the first question it has to answer. A fresh query
	// resets to the top, where the best match is.
	useEffect(() => {
		if (!open) return;
		const i = rows.findIndex((r) => r.option.iso === value);
		setActiveIndex(query.trim() === "" && i >= 0 ? i : 0);
	}, [open, query, rows, value]);

	// Keep the active row on screen for both arrow-keying and the open-on-current
	// case above.
	useEffect(() => {
		if (!open) return;
		const row = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
		// Guarded: jsdom has no `scrollIntoView`, and a picker that throws in the
		// test environment would be untestable for the behaviour that matters.
		if (row && typeof row.scrollIntoView === "function")
			row.scrollIntoView({ block: "nearest" });
	}, [open, activeIndex]);

	function commit(iso: DialIso) {
		onChange(iso);
		setOpen(false);
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (rows.length === 0) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const delta = e.key === "ArrowDown" ? 1 : -1;
			setActiveIndex((i) => (i + delta + rows.length) % rows.length);
			return;
		}
		if (e.key === "Home") {
			e.preventDefault();
			setActiveIndex(0);
			return;
		}
		if (e.key === "End") {
			e.preventDefault();
			setActiveIndex(rows.length - 1);
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			const row = rows[activeIndex];
			if (row) commit(row.option.iso);
		}
	}

	return (
		<>
			{/* The plate itself is the tap target — the whole 44px of it, as the
			    invisible <select> was. `absolute inset-0` covers the plate's own
			    padding too. */}
			<button
				type="button"
				disabled={disabled}
				aria-label={label}
				aria-haspopup="dialog"
				onClick={() => {
					setQuery("");
					setOpen(true);
				}}
				className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
			/>
			{/* Hover + keyboard wash for the plate. The button above is invisible,
			    so this is what says "tap me" and what shows a Tab landing here —
			    the frame's own ring can't say whether the picker or the number has
			    focus. Unchanged from the select it replaces. */}
			<span
				aria-hidden
				className="pointer-events-none absolute inset-0 transition-colors peer-hover:bg-muted peer-focus-visible:bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-inset peer-disabled:bg-transparent"
			/>
			<span className="relative flex items-center gap-1.5">
				<FlagOrBadge iso={value} flags={flags} emoji={emoji} />
				<span className="text-base font-medium tabular-nums">
					+{current.dial}
				</span>
				<ChevronDown aria-hidden className="-ml-0.5 size-4 shrink-0" />
			</span>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					// Taller than the default sheet and `sm:max-w-md` rather than
					// `sm:max-w-sm`: this one holds a scrolling list, not a short form.
					// `overflow-hidden` because the LIST scrolls, not the sheet — a
					// sheet that scrolls as a whole takes the search field off screen.
					// `min-h` as well as `max-h`: the panel is content-sized, so
					// filtering 241 rows down to one used to collapse it from full
					// height to a single row — on a phone the bottom sheet shrank away
					// under the thumb that was typing. A floor keeps it steady while
					// the list changes, and stays under the cap on a short screen.
					className="h-[min(32rem,85dvh)] max-h-[85dvh] gap-3 overflow-hidden sm:max-w-md"
					onOpenAutoFocus={(e) => {
						// Focus the search box, never the first row: typing is the point.
						// On a phone that also means the keyboard is up immediately, which
						// is what a 241-row list wants.
						e.preventDefault();
						(
							listRef.current?.parentElement?.querySelector(
								"input",
							) as HTMLInputElement | null
						)?.focus();
					}}
				>
					<SheetHeader>
						<SheetTitle>{label}</SheetTitle>
					</SheetHeader>

					<div className="relative shrink-0">
						<Search
							aria-hidden
							className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={onKeyDown}
							variant="field"
							type="text"
							// `search` would paint the browser's own clear button beside
							// ours. `off` because a country name is not a saved form value.
							autoComplete="off"
							autoCorrect="off"
							spellCheck={false}
							role="combobox"
							aria-expanded
							aria-controls={`${baseId}-list`}
							aria-activedescendant={
								rows.length > 0 ? `${baseId}-row-${activeIndex}` : undefined
							}
							// Names the two things a buyer actually knows — the point of
							// the change. 16px (`text-base` via `field`) so iOS doesn't zoom.
							placeholder="Search country or code"
							className="pl-9 pr-12"
						/>
						{query !== "" ? (
							<button
								type="button"
								onClick={() => setQuery("")}
								aria-label="Clear search"
								// 44px of HIT AREA around a 16px glyph. An in-input adornment is
								// conventionally smaller, but the house floor is the floor, and
								// this one is reached mid-search with a thumb.
								className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
							>
								<X className="size-4" />
							</button>
						) : null}
					</div>

					{/* The live count: a sighted user sees the list shrink, a screen
					    reader user gets told. */}
					<p aria-live="polite" className="sr-only">
						{rows.length === 1 ? "1 country" : `${rows.length} countries`}
					</p>

					{rows.length === 0 ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
							<p className="text-sm font-medium">No country matches that</p>
							<p className="text-sm text-muted-foreground">
								Try the country's name, or its code like{" "}
								<span className="tabular-nums">+65</span>.
							</p>
						</div>
					) : (
						<div
							ref={listRef}
							id={`${baseId}-list`}
							role="listbox"
							aria-label={label}
							className="-mx-1 flex-1 overflow-y-auto overscroll-contain px-1"
						>
							{rows.map((row, i) => {
								const picked = row.option.iso === value;
								return (
									<div key={row.key}>
										{row.heading ? (
											<p className="sticky top-0 z-10 bg-popover px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
												{row.heading}
											</p>
										) : null}
										{/* A real button, not a div with an onClick: it activates
										    on Enter/Space for free. `tabIndex={-1}` keeps it out of
										    the tab order — the search field owns the keyboard and
										    points here via `aria-activedescendant`. */}
										<button
											type="button"
											id={`${baseId}-row-${i}`}
											data-index={i}
											role="option"
											aria-selected={picked}
											tabIndex={-1}
											onClick={() => commit(row.option.iso)}
											onMouseMove={() => setActiveIndex(i)}
											className={cn(
												"flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left",
												i === activeIndex && "bg-muted",
											)}
										>
											{/* Deliberately no `flags`: handing MY/SG their inline SVGs here is
											    exactly what made two rows out of 248 look different. */}
											<FlagOrBadge iso={row.option.iso} emoji={emoji} />
											<span className="flex-1 truncate text-sm">
												{row.option.name}
											</span>
											<span className="shrink-0 text-sm tabular-nums text-muted-foreground">
												+{row.option.dial}
											</span>
											<Check
												aria-hidden
												className={cn(
													"size-4 shrink-0 text-accent-emphasis",
													picked ? "opacity-100" : "opacity-0",
												)}
											/>
										</button>
									</div>
								);
							})}
						</div>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
