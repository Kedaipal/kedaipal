import { useMutation } from "convex/react";
import { Check, Copy, ExternalLink, QrCode } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { ChecklistItem } from "../../routes/app.index";
import { Button } from "../ui/button";

const SHARE_SPOTS = [
	"Your WhatsApp Business bio / status",
	"Instagram & TikTok bio link",
	"Your Facebook page & posts",
	"Reply to customers who DM asking to order",
];

/**
 * Inline setup-checklist row for the "Share your store link" activation step.
 * Like {@link GreetingChecklistRow}, the expanded state is a self-contained card
 * rather than a link to a settings page — the actions (copy link, show QR) live
 * here. Copying or opening the QR stamps `linkSharedAt` (a soft proxy for a real
 * share), which marks the step done and advances the activation funnel. The QR
 * itself is rendered by the dashboard's shared dialog via `onOpenQr`.
 */
export function ShareLinkChecklistRow({
	item,
	expanded,
	storefrontUrl,
	slug,
	onOpenQr,
}: {
	item: ChecklistItem;
	expanded: boolean;
	storefrontUrl: string;
	slug: string;
	onOpenQr: () => void;
}) {
	const Icon = item.icon;
	const markShared = useMutation(api.retailers.markLinkShared);
	const [copied, setCopied] = useState(false);

	if (item.done) {
		return (
			// min-h matches the two-line pending rows (uniform-cards rule).
			<li className="flex min-h-[4.125rem] items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
				<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
					<Check className="size-3" />
				</div>
				<p className="flex-1 text-sm font-medium text-muted-foreground line-through">
					{item.title}
				</p>
				<span className="text-xs text-muted-foreground">Done</span>
			</li>
		);
	}

	if (!expanded) {
		return (
			<li>
				<div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-[10px] font-bold text-muted-foreground">
						{item.step}
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
				</div>
			</li>
		);
	}

	// Fire-and-forget: a failed stamp must never block the actual share action.
	function stamp() {
		void markShared({}).catch(() => {
			// ignore — the seller still copied / saw the QR
		});
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(storefrontUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
			stamp();
		} catch {
			// clipboard may be unavailable (insecure context / permissions)
		}
	}

	function showQr() {
		stamp();
		onOpenQr();
	}

	return (
		<li className="flex flex-col gap-3 rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
			<div className="flex items-start gap-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
					<Icon className="size-4" />
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2">
						<span className="text-[10px] font-bold uppercase tracking-wider text-accent">
							Step {item.step}
						</span>
						<span className="text-[10px] text-muted-foreground">
							{item.time}
						</span>
					</div>
					<p className="mt-0.5 text-sm font-semibold">{item.title}</p>
					<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
						{item.why}
					</p>
				</div>
			</div>

			{/* The link itself */}
			<p className="break-all rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs text-foreground">
				{storefrontUrl}
			</p>

			<div className="flex gap-2">
				<Button onClick={copy} className="h-11 flex-1 gap-2">
					{copied ? (
						<>
							<Check className="size-3.5" />
							Copied!
						</>
					) : (
						<>
							<Copy className="size-3.5" />
							Copy link
						</>
					)}
				</Button>
				<Button
					variant="outline"
					className="h-11 flex-1 gap-2"
					onClick={showQr}
				>
					<QrCode className="size-4" />
					Show QR
				</Button>
				<Button asChild variant="outline" className="h-11 w-11 shrink-0 p-0">
					<a
						href={`/${slug}`}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Open store"
					>
						<ExternalLink className="size-4" />
					</a>
				</Button>
			</div>

			{/* Where to share */}
			<div className="rounded-lg bg-muted/40 px-3 py-2.5">
				<p className="text-[11px] font-semibold text-foreground">
					Where to put it:
				</p>
				<ul className="mt-1 flex flex-col gap-1 text-[11px] text-muted-foreground">
					{SHARE_SPOTS.map((spot) => (
						<li key={spot} className="flex gap-2">
							<span className="text-accent">•</span>
							<span>{spot}</span>
						</li>
					))}
				</ul>
			</div>
		</li>
	);
}
