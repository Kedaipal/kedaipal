import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * A parent checkbox over a set of options — "select all / clear" for one group
 * (86eyrtz74).
 *
 * Shared by the orders column picker and the Filters dialog so the two speak
 * one language. Deliberately the same silhouette as the option rows beneath it
 * (same box, same row height), but bolder, so it reads as their heading rather
 * than as a sibling.
 *
 * **Tri-state, always.** A parent reading "unchecked" while three of its seven
 * children are on is telling the user something false. It is a real
 * `<input type="checkbox">` with the `indeterminate` DOM property set through a
 * ref — visually replaced, but a screen reader announces it natively as
 * "partially checked", which is stronger than `role="checkbox"` +
 * `aria-checked="mixed"`. "Some" shows a **dash**, never a tick.
 *
 * **Clicking a partly-filled parent FILLS it**; clicking a full one clears it.
 * Completing the set is the expected reading of a half-ticked box, and having
 * "clear this group" on the same control is what saves the seller unticking
 * six things by hand.
 */
export type BulkState = "none" | "some" | "all";

export function bulkStateOf(total: number, selected: number): BulkState {
	if (selected === 0) return "none";
	return selected >= total ? "all" : "some";
}

export interface BulkSelectRowProps {
	label: string;
	selected: number;
	total: number;
	/** Given the next desired state — `true` to select all, `false` to clear. */
	onToggle: (selectAll: boolean) => void;
	/** `master` tints the row, for a top-level "everything" control. */
	tone?: "group" | "master";
	/** Overrides the `n/total` on the right (e.g. a hint instead). */
	trailing?: React.ReactNode;
	/** Screen-reader noun for what is being counted. */
	unit?: string;
}

export function BulkSelectRow({
	label,
	selected,
	total,
	onToggle,
	tone = "group",
	trailing,
	unit = "options",
}: BulkSelectRowProps) {
	const state = bulkStateOf(total, selected);
	return (
		<label
			className={cn(
				"flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
				tone === "master" && "bg-muted/50 hover:bg-muted",
			)}
		>
			<input
				type="checkbox"
				className="sr-only"
				checked={state === "all"}
				aria-label={`${label} — ${selected} of ${total} ${unit} selected`}
				ref={(el) => {
					if (el) el.indeterminate = state === "some";
				}}
				onChange={() => onToggle(state !== "all")}
			/>
			<span
				aria-hidden="true"
				className={cn(
					"flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
					state === "none"
						? "border-border bg-background"
						: "border-accent bg-accent text-accent-foreground",
				)}
			>
				{state === "all" ? (
					<Check className="size-3" />
				) : state === "some" ? (
					<Minus className="size-3" />
				) : null}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					tone === "master"
						? "text-[13px] font-semibold"
						: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
				)}
			>
				{label}
			</span>
			{trailing ?? (
				<span className="shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
					{selected}/{total}
				</span>
			)}
		</label>
	);
}
