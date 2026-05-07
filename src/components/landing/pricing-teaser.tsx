import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";

const TIER_INCLUDES = [
	"pricing_include_1",
	"pricing_include_2",
	"pricing_include_3",
	"pricing_include_4",
] as const;

const COMPARISON_ROWS = [
	{ label: "Custom website build", price: "RM 3,000–10,000 one-time", highlight: false },
	{ label: "Shopify + WhatsApp plugin", price: "RM 130–200/mo", highlight: false },
	{ label: "Kedaipal (after beta)", price: "from RM 79/mo", highlight: false },
	{ label: "Kedaipal (beta)", price: "Free", highlight: true },
] as const;

export function PricingTeaser() {
	const { isSignedIn } = useAuth();
	const includes = TIER_INCLUDES.map((k) => m[k]());

	return (
		<section
			id="pricing"
			aria-labelledby="pricing-heading"
			className="border-b border-border/60 bg-muted/30"
		>
			<div className="mx-auto max-w-5xl px-5 py-24 md:px-8 md:py-32">
				<div className="text-center">
					<span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
						<Sparkles className="size-3" />
						{m.pricing_badge()}
					</span>
					<h2
						id="pricing-heading"
						className="mt-4 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.pricing_heading()}
					</h2>
					<div className="mx-auto mt-6 max-w-xl rounded-xl border-l-4 border-accent/40 bg-accent/5 px-5 py-3 text-left text-sm text-muted-foreground">
						{m.pricing_anchor()}
					</div>
				</div>

				{/* 3-tier grid */}
				<div className="mt-10 grid gap-4 md:grid-cols-3">
					{/* Starter */}
					<div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
						<p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
							Starter
						</p>
						<p className="mt-3 text-4xl font-bold tracking-tight">Free</p>
						<p className="mt-1 text-sm text-muted-foreground">during beta</p>
						<ul className="mt-6 flex-1 space-y-2">
							{includes.map((item) => (
								<li key={item} className="flex items-center gap-2 text-sm">
									<Check className="size-4 shrink-0 text-accent" />
									{item}
								</li>
							))}
						</ul>
						<div className="mt-6">
							{isSignedIn ? (
								<Button asChild className="w-full" variant="outline">
									<Link to="/app">
										{m.nav_go_to_dashboard()}
										<ArrowRight />
									</Link>
								</Button>
							) : (
								<Button asChild className="w-full" variant="outline">
									<Link to="/sign-up/$" params={{ _splat: "" }}>
										{m.pricing_cta()}
										<ArrowRight />
									</Link>
								</Button>
							)}
						</div>
					</div>

					{/* Pro — highlighted with gradient border */}
					<div
						className="relative flex flex-col rounded-2xl bg-gradient-to-br from-accent/5 to-transparent p-6 shadow-[0_8px_40px_hsl(160_84%_39%_/_0.16)]"
						style={{
							background:
								"linear-gradient(white, white) padding-box, linear-gradient(135deg, hsl(160 84% 39%), hsl(160 84% 68%), hsl(160 84% 39%)) border-box",
							border: "2px solid transparent",
						}}
					>
						<span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-accent-foreground">
							Popular
						</span>
						<p className="text-sm font-semibold uppercase tracking-wider text-accent">
							Pro
						</p>
						<p className="mt-3 text-4xl font-bold tracking-tight">RM 79</p>
						<p className="mt-1 text-sm text-muted-foreground">/mo after beta</p>
						<ul className="mt-6 flex-1 space-y-2">
							{includes.map((item) => (
								<li key={item} className="flex items-center gap-2 text-sm">
									<Check className="size-4 shrink-0 text-accent" />
									{item}
								</li>
							))}
						</ul>
						<p className="mt-4 text-xs font-medium text-accent">
							Beta users lock in founder pricing
						</p>
						<div className="mt-3">
							{isSignedIn ? (
								<Button asChild className="w-full">
									<Link to="/app">
										{m.nav_go_to_dashboard()}
										<ArrowRight />
									</Link>
								</Button>
							) : (
								<Button asChild className="w-full">
									<Link to="/sign-up/$" params={{ _splat: "" }}>
										{m.pricing_cta()}
										<ArrowRight />
									</Link>
								</Button>
							)}
						</div>
					</div>

					{/* Scale — coming soon */}
					<div className="flex flex-col rounded-2xl border border-border bg-card/50 p-6 opacity-60">
						<p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
							Scale
						</p>
						<p className="mt-3 text-4xl font-bold tracking-tight text-muted-foreground">
							RM 199
						</p>
						<p className="mt-1 text-sm text-muted-foreground">/mo</p>
						<ul className="mt-6 flex-1 space-y-2">
							{includes.map((item) => (
								<li
									key={item}
									className="flex items-center gap-2 text-sm text-muted-foreground"
								>
									<Check className="size-4 shrink-0" />
									{item}
								</li>
							))}
						</ul>
						<div className="mt-6">
							<Button className="w-full" variant="outline" disabled>
								Coming soon
							</Button>
						</div>
					</div>
				</div>

				<p className="mt-4 text-center text-xs text-muted-foreground">
					{m.pricing_future()}
				</p>

				{/* Comparison table */}
				<div className="mt-12 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
					<div className="border-b border-border px-6 py-4">
						<p className="font-semibold">{m.pricing_compare_heading()}</p>
					</div>
					<table className="w-full">
						<tbody>
							{COMPARISON_ROWS.map((row) => (
								<tr
									key={row.label}
									className={
										row.highlight
											? "bg-accent/5 font-medium"
											: "border-t border-border/50"
									}
								>
									<td className="px-6 py-3 text-sm">{row.label}</td>
									<td
										className={`px-6 py-3 text-right text-sm ${row.highlight ? "font-bold text-accent" : "text-muted-foreground"}`}
									>
										{row.price}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<p className="mt-6 text-center text-xs text-muted-foreground">
					{m.pricing_no_lockin()}
				</p>
			</div>
		</section>
	);
}
