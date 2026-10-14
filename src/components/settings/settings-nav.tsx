import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { SectionLabel } from "./settings-primitives";

/**
 * Settings navigation (86eye9xd4, groups 2A + 14A). Two presentations of ONE
 * structure — the same groups, the same order, the same live glance per tab:
 *
 * - `SettingsRail` (desktop, `lg` up): a persistent section rail. It replaced
 *   a 3-column tile grid that had grown to three full rows above every tab
 *   and said nothing about state.
 * - `SettingsIndex` (mobile, no tab in the URL): the grouped index, one row
 *   per tab with its glance where the chevron sits.
 *
 * Groups split by rhythm: Store (who you are, who helps, what you pay us),
 * Selling (the daily levers), Connections (accounts you paste in once).
 */

export type TabGlance = {
	text: string;
	/** `warn` = this tab needs the seller (amber), never decoration. */
	tone?: "default" | "warn";
};

export type NavTab<T extends string> = { id: T; label: string };

export type NavGroup<T extends string> = { label: string; tabs: T[] };

export function SettingsRail<T extends string>({
	groups,
	labels,
	glances,
	active,
	onSelect,
}: {
	groups: ReadonlyArray<NavGroup<T>>;
	labels: Record<T, string>;
	glances: Partial<Record<T, TabGlance>>;
	active: T;
	onSelect: (tab: T) => void;
}) {
	return (
		<nav
			aria-label="Settings sections"
			className="flex flex-col gap-5 lg:sticky lg:top-6"
		>
			{groups.map((group) =>
				group.tabs.length === 0 ? null : (
					<div key={group.label} className="flex flex-col gap-1">
						<SectionLabel className="px-2 pb-1">{group.label}</SectionLabel>
						{group.tabs.map((id) => {
							const on = id === active;
							const glance = glances[id];
							return (
								<button
									key={id}
									type="button"
									onClick={() => onSelect(id)}
									aria-current={on ? "page" : undefined}
									className={cn(
										"flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
										on
											? "bg-accent/12 font-semibold text-accent-emphasis"
											: "text-foreground hover:bg-muted/60",
									)}
								>
									<span className="min-w-0 truncate">{labels[id]}</span>
									{glance ? (
										<span
											className={cn(
												"ml-auto max-w-[45%] shrink-0 truncate text-[11px] font-normal",
												glance.tone === "warn"
													? "font-semibold text-amber-700 dark:text-amber-400"
													: on
														? "text-accent-emphasis"
														: "text-muted-foreground",
											)}
										>
											{glance.text}
										</span>
									) : null}
								</button>
							);
						})}
					</div>
				),
			)}
		</nav>
	);
}

export function SettingsIndex<T extends string>({
	groups,
	labels,
	glances,
	onSelect,
}: {
	groups: ReadonlyArray<NavGroup<T>>;
	labels: Record<T, string>;
	glances: Partial<Record<T, TabGlance>>;
	onSelect: (tab: T) => void;
}) {
	return (
		<>
			{groups.map((group) =>
				group.tabs.length === 0 ? null : (
					<div key={group.label} className="flex flex-col gap-1.5">
						<SectionLabel>{group.label}</SectionLabel>
						<div className="overflow-hidden rounded-2xl border border-border bg-card px-3.5">
							{group.tabs.map((id, i) => {
								const glance = glances[id];
								return (
									<button
										key={id}
										type="button"
										onClick={() => onSelect(id)}
										className={cn(
											"flex min-h-[52px] w-full items-center gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
											i > 0 && "border-t border-border/60",
										)}
									>
										<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
											{labels[id]}
										</span>
										{glance ? (
											<span
												className={cn(
													"max-w-[55%] truncate text-right text-sm font-semibold",
													glance.tone === "warn"
														? "text-amber-700 dark:text-amber-400"
														: "text-foreground",
												)}
											>
												{glance.text}
											</span>
										) : null}
										<ChevronRight
											aria-hidden
											className="size-4 shrink-0 text-muted-foreground/60"
										/>
									</button>
								);
							})}
						</div>
					</div>
				),
			)}
		</>
	);
}
