import { createContext, type ReactNode, useContext, useId } from "react";
import { cn } from "../../lib/utils";

/**
 * A pick-one MODE as a full-width row: radio dot, title, one honest line about
 * what the mode does. The row form of `ModeButton`, for choices whose options
 * need a real sentence each — a two-column tile grid crams the subtitle, and an
 * odd number of options leaves a hole in the last row (86eye9xd4).
 *
 * A real `<input type="radio">` under a styled label, so arrow keys, focus and
 * screen-reader semantics come from the platform rather than from us.
 *
 * `partner` marks an option that runs on a third-party account the seller
 * owns (z8r3fdcx5k): its border is dashed, matching the mint "Partner
 * integration" label above it. One chooser carries both kinds, so the
 * built-in/partner distinction never needs a second selector.
 */
const GroupName = createContext<string | null>(null);

export function ModeRowGroup({
	label,
	children,
	className,
}: {
	/** Accessible name for the choice, e.g. "How you charge for delivery". */
	label: string;
	children: ReactNode;
	className?: string;
}) {
	const name = useId();
	return (
		<fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
			<legend className="sr-only">{label}</legend>
			<GroupName.Provider value={name}>{children}</GroupName.Provider>
		</fieldset>
	);
}

export function ModeRow({
	active,
	disabled,
	onSelect,
	title,
	description,
	badge,
	partner = false,
}: {
	active: boolean;
	disabled?: boolean;
	onSelect: () => void;
	title: string;
	description: ReactNode;
	/** Trailing chip on the title line (the PRO badge). */
	badge?: ReactNode;
	partner?: boolean;
}) {
	const name = useContext(GroupName) ?? "mode";
	return (
		<label
			className={cn(
				"flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
				partner && "border-dashed",
				active
					? "border-2 border-accent bg-accent/10 px-[13px] py-[11px]"
					: "border-border bg-card hover:border-accent/50",
				disabled && "cursor-not-allowed opacity-60 hover:border-border",
			)}
		>
			<input
				type="radio"
				name={name}
				checked={active}
				disabled={disabled}
				onChange={onSelect}
				className="sr-only"
			/>
			<span
				aria-hidden
				className={cn(
					"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
					active ? "border-accent" : "border-border",
				)}
			>
				{active ? <span className="size-2 rounded-full bg-accent" /> : null}
			</span>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span
					className={cn(
						"flex flex-wrap items-center gap-1.5 text-sm font-semibold",
						active ? "text-accent-emphasis" : "text-foreground",
					)}
				>
					{title}
					{badge}
				</span>
				<span className="text-xs leading-snug text-muted-foreground">
					{description}
				</span>
			</span>
		</label>
	);
}
