import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { doneStepsSummary, shouldCollapseDoneSteps } from "../../lib/home-copy";
import { Button } from "../ui/button";

/** The Settings tabs a checklist step can point at. */
export type SettingsTab =
	| "store"
	| "whatsapp"
	| "payments"
	| "fulfilment"
	| "billing";

export type ChecklistItem = {
	key: string;
	done: boolean;
	icon: LucideIcon;
	title: string;
	/** Noun form for the collapsed summary — "WhatsApp number", not "Add your
	 * WhatsApp number". See `doneStepsSummary`. */
	shortTitle: string;
	why: string;
	time: string;
	cta: string;
	to: string;
	tab?: SettingsTab;
	optional?: boolean;
	step: number;
};

/**
 * The setup path (z8r3fdrgzj decision 8).
 *
 * Finished steps collapse into ONE line once three are done. A growing column
 * of struck-through rows is not progress the seller needs to re-read every
 * morning — it is scroll between them and the single thing still asking for
 * them. The active step keeps its full row, with its reason and its button.
 */
export function SetupChecklist({
	requiredSteps,
	optionalSteps,
	renderRow,
	title,
}: {
	requiredSteps: ChecklistItem[];
	optionalSteps: ChecklistItem[];
	/** The route owns row rendering — two steps are interactive components. */
	renderRow: (
		item: ChecklistItem,
		expanded: boolean,
		onToggle?: () => void,
	) => ReactNode;
	title: string;
}) {
	const done = requiredSteps.filter((s) => s.done);
	const pending = requiredSteps.filter((s) => !s.done);
	const collapse = shouldCollapseDoneSteps(done.length);
	const summary = collapse
		? doneStepsSummary(done.map((s) => s.shortTitle))
		: null;
	const activeKey = pending[0]?.key;

	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="font-heading text-base font-extrabold tracking-tight">
					{title}
				</h2>
				<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
					{done.length} of {requiredSteps.length} done
				</span>
			</div>

			{summary ? (
				<p className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
					<Check
						className="mt-px size-3.5 shrink-0 text-accent-emphasis"
						aria-hidden="true"
					/>
					{summary}
				</p>
			) : null}

			<ul className="flex flex-col gap-2">
				{(collapse ? pending : requiredSteps).map((item) =>
					renderRow(item, item.key === activeKey),
				)}
			</ul>

			{optionalSteps.length > 0 ? (
				<OptionalGroup steps={optionalSteps} renderRow={renderRow} />
			) : null}
		</section>
	);
}

function OptionalGroup({
	steps,
	renderRow,
}: {
	steps: ChecklistItem[];
	renderRow: (
		item: ChecklistItem,
		expanded: boolean,
		onToggle?: () => void,
	) => ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2 border-t border-border pt-4">
			<p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
				Optional extras · set up anytime
			</p>
			<ul className="flex flex-col gap-2">
				{steps.map((item) => renderRow(item, false, () => undefined))}
			</ul>
		</div>
	);
}

/** One required step, in its three shapes: done, active, or waiting. */
export function ChecklistRow({
	item,
	expanded,
	onToggle,
}: {
	item: ChecklistItem;
	expanded: boolean;
	onToggle?: () => void;
}) {
	const Icon = item.icon;

	if (item.done)
		return (
			<li className="flex min-h-[4.125rem] items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
					<Check className="size-3.5" aria-hidden="true" />
				</div>
				<p className="flex-1 text-sm font-medium text-muted-foreground line-through">
					{item.title}
				</p>
				<span className="text-xs text-muted-foreground">Done</span>
			</li>
		);

	if (expanded)
		return (
			<li className="flex flex-col gap-3 rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
				<div className="flex items-start gap-3">
					<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
						<Icon className="size-4" />
					</div>
					<div className="flex-1">
						<div className="flex items-center gap-2">
							{item.optional ? (
								<span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
									Optional
								</span>
							) : (
								<span className="text-[10px] font-bold uppercase tracking-wider text-accent">
									Step {item.step}
								</span>
							)}
							<span className="text-[10px] text-muted-foreground">
								{item.time}
							</span>
						</div>
						<p className="mt-0.5 text-sm font-semibold">{item.title}</p>
						<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
							{item.why}
						</p>
					</div>
				</div>
				<Link to={item.to} search={item.tab ? { tab: item.tab } : undefined}>
					<Button size="sm" className="h-11 w-full gap-2">
						{item.cta}
						<ArrowRight className="size-3.5" />
					</Button>
				</Link>
			</li>
		);

	if (onToggle)
		return (
			<li>
				<button
					type="button"
					onClick={onToggle}
					className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent/5"
				>
					<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<Icon className="size-3" />
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</li>
		);

	return (
		<li>
			<Link
				to={item.to}
				search={item.tab ? { tab: item.tab } : undefined}
				className="block"
			>
				<div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/5">
					<div className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-[10px] font-bold text-muted-foreground">
						{item.step}
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
					<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
				</div>
			</Link>
		</li>
	);
}
