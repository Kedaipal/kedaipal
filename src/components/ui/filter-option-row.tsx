import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * One tickable filter option: a box, a label, and the number of rows it holds
 * (86eyrtz74).
 *
 * Extracted so the **column header menus and the Filters dialog render the
 * identical control**. They were two different shapes for one idea — chips in
 * the dialog, checkbox rows in the header — which made the app look like two
 * apps and meant a seller learnt the same filter twice. One primitive is what
 * makes "the filter language" a single thing.
 *
 * The count is not decoration. It answers "is there anything in there?" before
 * the seller commits to a tick, and a `0` is the answer to "why did my list go
 * empty?". It is always tallied over the UNFILTERED window, so options never
 * shrink or vanish as a selection grows.
 */
export interface FilterOptionRowProps {
	label: string;
	selected: boolean;
	onToggle: () => void;
	/** Rows this option matches, over the unfiltered window. Omit when the
	 * dimension has no count to give (date presets). */
	count?: number;
	/** `radio` for mutually-exclusive presets — a round box, since a square one
	 * promises a set you can build. */
	shape?: "checkbox" | "radio";
	/** Dimmed label for an option that names an absence ("Unspecified"). */
	muted?: boolean;
}

export function FilterOptionRow({
	label,
	selected,
	onToggle,
	count,
	shape = "checkbox",
	muted,
}: FilterOptionRowProps) {
	return (
		<button
			type="button"
			// A toggle button, not a `menuitemcheckbox`: neither host is a menu, and
			// a menu-item role outside a menu is a lie assistive tech works around.
			aria-pressed={selected}
			// Spelled out rather than left to name concatenation — the label and
			// count sit in adjacent spans with no whitespace, so the computed name
			// would otherwise run together as "Delivered0".
			aria-label={
				count === undefined
					? label
					: `${label}, ${count} ${count === 1 ? "order" : "orders"}`
			}
			onClick={onToggle}
			className={cn(
				// min-h-9 rather than a fixed height: a long custom stage name wraps
				// instead of being clipped, and the row grows with it.
				"flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
				selected ? "bg-accent/10" : "hover:bg-muted",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"flex size-[17px] shrink-0 items-center justify-center border transition-colors",
					shape === "radio" ? "rounded-full" : "rounded-[5px]",
					selected
						? "border-accent bg-accent text-accent-foreground"
						: "border-border bg-background",
				)}
			>
				{selected ? <Check className="size-3" /> : null}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1",
					selected && "font-semibold",
					muted && !selected && "text-muted-foreground",
				)}
			>
				{label}
			</span>
			{count !== undefined ? (
				<span
					className={cn(
						"shrink-0 tabular-nums text-[11.5px]",
						count === 0
							? "text-muted-foreground/40"
							: selected
								? "text-foreground"
								: "text-muted-foreground",
					)}
				>
					{count}
				</span>
			) : null}
		</button>
	);
}
