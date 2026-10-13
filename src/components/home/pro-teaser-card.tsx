import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Compass, Lock, TrendingUp, Trophy, Users } from "lucide-react";
import { Button } from "../ui/button";

/**
 * What Starter is missing, said in terms of what the seller would LEARN
 * (z8r3fdrgzj board 2) — not "unlock analytics".
 *
 * It replaces the three insight cards rather than sitting beside them, so the
 * page has the same shape on every plan and the seller can see exactly where
 * the answers would appear. The server is the real gate; this is the part that
 * makes the gate legible.
 */
export function ProTeaserCard() {
	return (
		<section className="flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-4">
			<span className="inline-flex w-fit items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-bold text-background">
				<Lock className="size-3" aria-hidden="true" />
				Pro
			</span>
			<div className="flex flex-col gap-1.5">
				<h3 className="font-heading text-[17px] font-extrabold leading-snug tracking-tight">
					See what is really selling, and who keeps coming back
				</h3>
				<p className="text-[13px] text-muted-foreground">
					Your orders already hold the answers. Pro reads them for you, right
					here on Home.
				</p>
			</div>
			<ul className="flex flex-col gap-2.5">
				<Perk
					icon={Trophy}
					title="Best sellers"
					detail="Which products bring in the money"
				/>
				<Perk
					icon={Users}
					title="Returning customers"
					detail="Who comes back, and who has gone quiet"
				/>
				<Perk
					icon={Compass}
					title="Where orders come from"
					detail="Which link, QR or counter is working"
				/>
				<Perk
					icon={TrendingUp}
					title="Trends over 7 and 30 days"
					detail="Is this week better than last?"
				/>
			</ul>
			<Button asChild size="lg" className="h-11 w-full sm:h-10">
				<Link to="/app/settings" search={{ tab: "billing" }}>
					See Pro plans
				</Link>
			</Button>
			<p className="text-center text-[11px] text-muted-foreground">
				You are on Starter. Today's sales stay free.
			</p>
		</section>
	);
}

function Perk({
	icon: Icon,
	title,
	detail,
}: {
	icon: LucideIcon;
	title: string;
	detail: string;
}) {
	return (
		<li className="flex items-start gap-2.5">
			<span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
				<Icon className="size-3.5" aria-hidden="true" />
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="text-[13px] font-semibold">{title}</span>
				<span className="text-[11px] text-muted-foreground">{detail}</span>
			</span>
		</li>
	);
}
