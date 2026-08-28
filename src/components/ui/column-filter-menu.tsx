import { ListFilter, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { FilterOptionRow } from "./filter-option-row";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Filter a data table from its own column header (86eyrtz74).
 *
 * **Generic on purpose.** This knows nothing about orders — it takes options,
 * a selection and a change handler, so the next table that wants header filters
 * reuses it whole. Everything order-specific (which columns are filterable,
 * where the options come from, how the selection maps to URL state) lives in
 * `order-column-filters.ts`, one layer up.
 *
 * Why the header and not only a filter panel: a filter that is *about a
 * column's values* is discoverable exactly where those values are, and needs no
 * translation step ("Payment status" → which column was that again?). What
 * does NOT belong here is anything that isn't one column — date ranges spanning
 * two columns, cross-cutting toggles like "needs mockup", or the summary of
 * everything currently narrowing the list. Those stay in the panel, which also
 * remains the ONLY filter surface in cards view. So header filters **mirror**
 * the panel rather than replacing it: both write the same state, and a filter
 * set in one shows as active in the other.
 *
 * Design notes that are load-bearing rather than taste:
 *  - **Counts beside every option**, supplied by the caller and tallied over the
 *    unfiltered window. They answer "is there anything in there?" before the
 *    seller commits to a click, and an option showing `0` is the answer to
 *    "why is my list empty?".
 *  - **Options never disappear as you select.** A picker that shrank under use
 *    reads as data vanishing.
 *  - **A search box appears past `SEARCH_THRESHOLD` options**, because a
 *    seller's own category or tag list can be long and scrolling to find one
 *    known name is the slowest way to do anything.
 */
export interface ColumnFilterOption {
	value: string;
	label: string;
	/** Rows this option would match, over the UNFILTERED window. */
	count?: number;
}

export interface ColumnFilterMenuProps {
	/** The column's name — used in the trigger's accessible name and the
	 * panel's heading, so "which filter is open" is never in doubt. */
	label: string;
	options: ColumnFilterOption[];
	selected: string[];
	onChange: (next: string[]) => void;
	/** `single` for mutually-exclusive presets (a due-date window); `multi`
	 * everywhere else, which is the whole point of moving filters here. */
	mode?: "single" | "multi";
	/** Shown in place of the list when there is nothing to filter by — an empty
	 * panel is a dead end and reads as a broken control. */
	emptyHint?: string;
	/** Extra classes for the trigger (alignment inside a header cell). */
	className?: string;
}

const SEARCH_THRESHOLD = 8;

export function ColumnFilterMenu({
	label,
	options,
	selected,
	onChange,
	mode = "multi",
	emptyHint = "Nothing to filter by yet",
	className,
}: ColumnFilterMenuProps) {
	const [open, setOpen] = useState(false);
	const [term, setTerm] = useState("");
	const active = selected.length > 0;

	const shown = useMemo(() => {
		const t = term.trim().toLowerCase();
		if (t === "") return options;
		return options.filter((o) => o.label.toLowerCase().includes(t));
	}, [options, term]);

	function toggle(value: string) {
		if (mode === "single") {
			// Re-picking the active option clears it: with mutually-exclusive
			// presets there is no other way back to "no filter" without hunting
			// for the Clear button.
			onChange(selected[0] === value ? [] : [value]);
			setOpen(false);
			return;
		}
		onChange(
			selected.includes(value)
				? selected.filter((v) => v !== value)
				: [...selected, value],
		);
	}

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setTerm("");
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={
						active
							? `Filter ${label} — ${selected.length} selected`
							: `Filter ${label}`
					}
					title={`Filter ${label}`}
					// Stop the header's own handlers: the cell is a sort control and a
					// drag handle, and opening a filter must be neither.
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
					className={cn(
						"flex size-5 shrink-0 items-center justify-center rounded transition-colors",
						// Never hover-only. A control that appears on hover is one a
						// touch user cannot discover at all, and its mere presence is
						// what tells the seller this column is filterable.
						active
							? "bg-accent text-accent-foreground"
							: "text-muted-foreground/45 hover:bg-background hover:text-foreground",
						className,
					)}
				>
					<ListFilter className="size-3.5" aria-hidden="true" />
				</button>
			</PopoverTrigger>

			<PopoverContent align="start" className="w-64 p-0">
				<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
					<p className="truncate text-[13px] font-semibold">{label}</p>
					{active ? (
						<button
							type="button"
							onClick={() => onChange([])}
							className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-emphasis hover:underline dark:text-accent"
						>
							<X className="size-3" aria-hidden="true" />
							Clear
						</button>
					) : null}
				</div>

				{options.length > SEARCH_THRESHOLD ? (
					<div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
						<Search
							className="size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<input
							type="text"
							value={term}
							onChange={(e) => setTerm(e.target.value)}
							placeholder={`Find in ${label.toLowerCase()}`}
							aria-label={`Find in ${label}`}
							className="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-muted-foreground"
						/>
					</div>
				) : null}

				<div className="max-h-[50vh] overflow-y-auto p-1">
					{options.length === 0 ? (
						<p className="px-3 py-3 text-[12.5px] text-muted-foreground">
							{emptyHint}
						</p>
					) : shown.length === 0 ? (
						<p className="px-3 py-3 text-[12.5px] text-muted-foreground">
							No match for “{term.trim()}”
						</p>
					) : (
						shown.map((o) => (
							<FilterOptionRow
								key={o.value}
								label={o.label}
								count={o.count}
								selected={selected.includes(o.value)}
								shape={mode === "single" ? "radio" : "checkbox"}
								onToggle={() => toggle(o.value)}
							/>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
