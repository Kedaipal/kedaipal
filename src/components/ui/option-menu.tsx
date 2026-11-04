import { ChevronDown, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../../lib/utils";
import { FilterOptionRow } from "./filter-option-row";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * A toolbar control for "pick ONE of these": a labelled trigger that reads
 * `Label · Value`, opening a radio list in a popover (Admin · Sellers' Status
 * and Sort, 4 Nov 2026).
 *
 * Why a third list primitive and not `DropdownMenu`: the house filter
 * language is `FilterOptionRow` — the box, the label, the count over the
 * unfiltered window — and a Status filter that drew its options as plain menu
 * items while the inbox drew the identical idea as rows would be two apps
 * again. `ColumnFilterMenu` is the same list behind a header funnel icon; this
 * is it behind a labelled toolbar button. Sort has no counts and uses the same
 * component anyway, so the two triggers beside each other are one control.
 *
 * - **Counts stay honest**: supplied by the caller over the whole book, drawn
 *   on the row AND, for a non-default value, as a pill on the closed trigger
 *   so an active filter is visible without opening anything.
 * - **Options never vanish** as the value changes; a `0` is the answer to
 *   "why is my list empty?".
 * - **The way back is in the panel** (`Clear`, shown only off the default)
 *   and on the default option itself.
 * - **Groups** carry a heading each; the first group may go without one (the
 *   "All" row).
 */
export interface OptionMenuOption<V extends string> {
	value: V;
	label: string;
	/** Rows this option holds, over the UNFILTERED book. Omit for a sort. */
	count?: number;
	/** `attention` draws a non-zero count in amber: a to-do, not a state. */
	countTone?: "muted" | "attention";
}

export interface OptionMenuGroup<V extends string> {
	heading?: string;
	options: OptionMenuOption<V>[];
}

export interface OptionMenuProps<V extends string> {
	/** "Status", "Sort" — the trigger's prefix and the panel's heading. */
	label: string;
	value: V;
	/** The value that means "nothing applied"; off it the trigger shows the
	 * count pill and the panel offers Clear. Omit for a control with no
	 * neutral position (a sort). */
	defaultValue?: V;
	groups: OptionMenuGroup<V>[];
	onChange: (next: V) => void;
	/** The trigger's leading icon. */
	icon?: ReactNode;
	/** The noun for a count's accessible name ("3 sellers"). */
	countNoun?: string;
	/** One line under the options saying how they are decided. */
	note?: ReactNode;
	className?: string;
}

export function OptionMenu<V extends string>({
	label,
	value,
	defaultValue,
	groups,
	onChange,
	icon,
	countNoun = "order",
	note,
	className,
}: OptionMenuProps<V>) {
	const [open, setOpen] = useState(false);
	const current = groups
		.flatMap((g) => g.options)
		.find((o) => o.value === value);
	const currentLabel = current?.label ?? value;
	const offDefault = defaultValue !== undefined && value !== defaultValue;
	const pill =
		offDefault && current?.count !== undefined ? current.count : undefined;
	const pillAttention = current?.countTone === "attention" && (pill ?? 0) > 0;
	const triggerName =
		pill === undefined
			? `${label}: ${currentLabel}`
			: `${label}: ${currentLabel}, ${pill} ${pill === 1 ? countNoun : `${countNoun}s`}`;

	function pick(next: V) {
		onChange(next);
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={triggerName}
					className={cn(
						"inline-flex h-11 min-w-0 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:h-10",
						className,
					)}
				>
					{icon ? (
						<span
							className="shrink-0 text-muted-foreground [&_svg]:size-4"
							aria-hidden="true"
						>
							{icon}
						</span>
					) : null}
					<span className="hidden text-muted-foreground sm:inline">
						{label}
					</span>
					<span className={cn("truncate", offDefault && "font-semibold")}>
						{currentLabel}
					</span>
					{pill !== undefined ? (
						<span
							className={cn(
								"flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums",
								pillAttention
									? "bg-amber-500 text-white"
									: "bg-muted text-muted-foreground",
							)}
						>
							{pill > 99 ? "99+" : pill}
						</span>
					) : null}
					<ChevronDown
						className={cn(
							"ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
							open && "rotate-180",
						)}
						aria-hidden="true"
					/>
				</button>
			</PopoverTrigger>

			<PopoverContent align="start" className="w-72 gap-0 p-0">
				<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
					<p className="truncate text-[13px] font-semibold">{label}</p>
					{offDefault && defaultValue !== undefined ? (
						<button
							type="button"
							onClick={() => pick(defaultValue)}
							className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-emphasis hover:underline dark:text-accent"
						>
							<X className="size-3" aria-hidden="true" />
							Clear
						</button>
					) : null}
				</div>
				<div className="max-h-[60vh] overflow-y-auto p-1">
					{groups.map((group, i) => (
						<div key={group.heading ?? `group-${i}`}>
							{group.heading ? (
								<p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
									{group.heading}
								</p>
							) : null}
							{group.options.map((o) => (
								<FilterOptionRow
									key={o.value}
									label={o.label}
									count={o.count}
									countTone={o.countTone}
									countNoun={countNoun}
									selected={o.value === value}
									shape="radio"
									onToggle={() => pick(o.value)}
								/>
							))}
						</div>
					))}
				</div>
				{note ? (
					<div className="border-t border-border bg-muted/50 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
						{note}
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
