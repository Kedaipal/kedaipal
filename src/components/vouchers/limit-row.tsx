import type { ReactNode } from "react";
import { ToggleSwitch } from "../ui/toggle-switch";

/**
 * One switchable rule: a title, a one-line consequence, the house switch,
 * and — only while on — its own control. Shared by the issue and extend
 * dialogs (`z8r3fducfm`, `z8r3fdz0pw`), so a bound reads the same wherever a
 * seller sets it. The card tints like an active
 * `ModeButton` so "which bounds are on" reads at a glance, but it is a
 * SWITCH and not a radio because the two bounds compose.
 */
export function LimitRow({
	on,
	onChange,
	title,
	subtitle,
	children,
}: {
	on: boolean;
	onChange: (on: boolean) => void;
	title: string;
	subtitle: string;
	children: ReactNode;
}) {
	return (
		<div
			className={`flex flex-col gap-3 rounded-xl border-2 p-3 transition-colors ${
				on ? "border-accent bg-accent/5" : "border-border bg-card"
			}`}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-semibold">{title}</p>
					<p className="text-xs text-muted-foreground">{subtitle}</p>
				</div>
				<ToggleSwitch on={on} onChange={onChange} label={title} />
			</div>
			{on ? children : null}
		</div>
	);
}
