import { ExternalLink, Lock, TrendingUp } from "lucide-react";
import { buildWaContactLink } from "../../lib/contact";
import { KpiRow } from "./kpi-row";

// Starter sees this instead of a wall of nothing — a blurred SAMPLE of what
// Insights shows, with a one-tap upgrade CTA (manual billing → message Arif on
// WhatsApp). The real numbers are withheld SERVER-SIDE (the query returns
// `{ gated: true }`); this preview is static sample data, never the seller's own.

const SAMPLE_TREND = [40, 62, 35, 78, 55, 90, 48, 70, 60, 82, 45, 66];

export function LockedTeaser({
	currency,
	slug,
}: {
	currency: string;
	slug: string;
}) {
	const upgradeUrl = buildWaContactLink(
		`Hi, I'd like to upgrade to Pro to unlock Business insights for my Kedaipal store (/${slug}).`,
	);

	return (
		<div className="relative overflow-hidden rounded-2xl border border-border">
			{/* Blurred sample behind the gate — gives Starter a real sense of the value. */}
			<div
				aria-hidden="true"
				className="pointer-events-none select-none blur-[3px]"
			>
				<div className="flex flex-col gap-4 p-5">
					<KpiRow
						earned={1_284_000}
						collected={968_000}
						orderCount={73}
						aov={17_589}
						currency={currency}
					/>
					<div className="flex h-40 items-end gap-1.5 rounded-2xl border border-border bg-card p-5">
						{SAMPLE_TREND.map((h, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: static decorative sample
								key={i}
								className="flex-1 rounded-t bg-accent/70"
								style={{ height: `${h}%` }}
							/>
						))}
					</div>
				</div>
			</div>

			{/* Gate overlay */}
			<div className="absolute inset-0 flex items-center justify-center bg-background/60 p-6 backdrop-blur-[1px]">
				<div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
					<span className="flex size-12 items-center justify-center rounded-full bg-accent/12 text-accent">
						<Lock className="size-5" />
					</span>
					<h3 className="font-heading text-lg font-extrabold">
						Insights is a Pro feature
					</h3>
					<p className="text-sm text-muted-foreground">
						See revenue earned vs collected, your best sellers, revenue trends
						and how buyers pay — upgrade to Pro to unlock it for your store.
					</p>
					<a
						href={upgradeUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="tap-target mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-primary-foreground transition-colors hover:bg-accent/90"
					>
						<TrendingUp className="size-4" />
						Upgrade to Pro
						<ExternalLink className="size-3.5 opacity-70" />
					</a>
					<p className="text-[11px] text-muted-foreground">
						We'll set it up for you on WhatsApp.
					</p>
				</div>
			</div>
		</div>
	);
}
