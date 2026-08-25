import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type {
	CountrySetupItem,
	CountrySetupSeverity,
} from "../../../convex/lib/countrySetup";
import { useActAsRetailerId } from "../../hooks/useActAs";
import {
	type CountrySetupTab,
	countrySetupCopy,
	countrySetupHeadline,
} from "../../lib/country-setup-copy";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

/**
 * What a store still needs to fix after moving country (86eyqgujv).
 *
 * Renders nothing at all for a store that has never switched — the query
 * short-circuits on `countryChangedAt` before touching any other table, so the
 * checklist is free for every store that stays put.
 *
 * Two placements, one component: `variant="card"` inside Settings → Store,
 * directly under the country picker, so the answer to "what did that just do?"
 * is right where the question was asked; and `variant="banner"` on the
 * dashboard home, the daily surface, so it can't be missed by a seller who
 * switched and closed the tab.
 */
export function CountrySetupPanel({
	variant = "card",
	onGoToTab,
}: {
	variant?: "card" | "banner";
	/** Settings can switch tabs in place; the dashboard has to navigate. */
	onGoToTab?: (tab: CountrySetupTab) => void;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const setup = useQuery(
		convexQuery(
			api.retailers.countrySetup,
			actAsRetailerId ? { retailerId: actAsRetailerId } : {},
		),
	).data;
	const ack = useMutation(api.retailers.ackCountrySetup);
	const [acking, setAcking] = useState(false);

	if (!setup || setup.items.length === 0) return null;
	const { country, changedFrom, items } = setup;
	const ackable = items.filter((i) => !i.verifiable);

	async function confirmChecked() {
		setAcking(true);
		try {
			await ack(actAsRetailerId ? { retailerId: actAsRetailerId } : {});
			toast.success("Thanks — we won't ask about those again.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setAcking(false);
		}
	}

	return (
		<section
			className={
				variant === "banner"
					? "flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-500/10 p-4 dark:border-amber-800"
					: "flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-500/10 p-3.5 dark:border-amber-800"
			}
			aria-labelledby="country-setup-heading"
		>
			<div className="flex items-start gap-2.5">
				<TriangleAlert
					className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
					aria-hidden="true"
				/>
				<div className="flex flex-col gap-0.5">
					<h3
						id="country-setup-heading"
						className="font-heading text-sm font-semibold text-amber-900 dark:text-amber-200"
					>
						Finish setting up for {countryName(country)}
					</h3>
					<p className="text-xs text-amber-900/80 dark:text-amber-200/80">
						{countrySetupHeadline(items, country, changedFrom)}
					</p>
				</div>
			</div>

			<ul className="flex flex-col gap-2">
				{items.map((item) => {
					const copy = countrySetupCopy(item, country, changedFrom);
					return (
						<li
							key={item.key}
							className="flex flex-col gap-2 rounded-lg border border-amber-300/60 bg-background/70 p-3 dark:border-amber-800/60"
						>
							<div className="flex flex-wrap items-center gap-2">
								<SeverityChip severity={item.severity} />
								<span className="text-sm font-medium">{copy.title}</span>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{copy.body}
							</p>
							{onGoToTab ? (
								<Button
									type="button"
									variant="outline"
									onClick={() => onGoToTab(copy.tab)}
									className="h-10 sm:w-auto sm:self-start sm:px-4"
								>
									{copy.action}
								</Button>
							) : null}
						</li>
					);
				})}
			</ul>

			{ackable.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					<Button
						type="button"
						variant="outline"
						onClick={confirmChecked}
						disabled={acking}
						className="h-11 sm:w-auto sm:self-start sm:px-5"
					>
						<CircleCheck className="mr-1.5 size-4" aria-hidden="true" />
						{acking
							? "Saving…"
							: ackable.length === 1
								? "I've checked this one"
								: `I've checked these ${ackable.length}`}
					</Button>
					{/* Says exactly what the button retires, so it never reads as a
					    blanket dismiss. The rows we CAN check for ourselves stay
					    until they're genuinely fixed. */}
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{items.length === ackable.length
							? "These are your own details, so we can't check them for you."
							: `Only clears the ${ackable.length} we can't check for you. The rest stay until they're fixed.`}
					</p>
				</div>
			) : null}
		</section>
	);
}

/** Ranked by what it costs to get wrong — a seller reads the first row and
 * maybe the second, so the money ones have to look different. */
function SeverityChip({ severity }: { severity: CountrySetupSeverity }) {
	if (severity === "money") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-400">
				<CircleAlert className="size-3" aria-hidden="true" />
				Payments at risk
			</span>
		);
	}
	if (severity === "buyer_visible") {
		return (
			<span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
				Buyers see this
			</span>
		);
	}
	return (
		<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
			Tidy-up
		</span>
	);
}

function countryName(country: string): string {
	return country === "SG" ? "Singapore" : "Malaysia";
}

export type { CountrySetupItem };
