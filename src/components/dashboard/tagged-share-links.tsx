import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SHARE_TAG_PRESETS } from "../../../convex/lib/attribution";
import { cn } from "../../lib/utils";
import { BRAND_GLYPHS } from "./brand-icons";

/**
 * Tagged share links (86eyq0eq9) — one tap copies the store link with a
 * `?src=` tag, so orders placed from that channel are labelled in Insights.
 *
 * Lives on the dashboard's **store-link share card**, beside the plain "Copy
 * link" action — deliberately NOT on any QR surface. A poster QR is a physical
 * artifact that outlives any campaign, so its tag is fixed (`online`); a
 * campaign tag belongs on a link you paste (owner call, Arif). This is also
 * the feature's discoverability surface: the Insights breakdown reports on the
 * `?src=` mechanic, and this is where the product teaches it.
 *
 * All-tier on purpose — capture works on every plan even though the report is
 * Pro, so a Starter seller must still be able to build a tagged link.
 */
export function TaggedShareLinks({
	storefrontUrl,
	onCopy,
}: {
	/** The store's plain storefront URL, with no query string. */
	storefrontUrl: string;
	/** Fired after a successful copy — same "shared their link" signal as the
	 * plain copy button (stamps `linkSharedAt`). */
	onCopy?: () => void;
}) {
	const [copiedTag, setCopiedTag] = useState<string | null>(null);

	async function copyTagged(tag: string, label: string) {
		const url = `${storefrontUrl}?src=${tag}`;
		try {
			await navigator.clipboard.writeText(url);
			setCopiedTag(tag);
			setTimeout(() => setCopiedTag((t) => (t === tag ? null : t)), 1800);
			toast.success(`${label} link copied`);
			onCopy?.();
		} catch {
			// Clipboard denied (insecure context / permission) — show the link so
			// the seller can still copy it by hand rather than silently failing.
			toast.error(`Couldn't copy automatically — your link is ${url}`);
		}
	}

	return (
		<div className="flex flex-col gap-2 border-t border-dashed border-foreground/15 pt-3">
			<div className="flex flex-col gap-0.5">
				<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
					Tagged links
				</span>
				<p className="text-xs text-muted-foreground">
					Paste one in your TikTok bio or live chat and orders from it are
					labelled in{" "}
					<Link
						to="/app/insights"
						className="font-semibold text-accent-emphasis hover:underline"
					>
						Insights
					</Link>
					.
				</p>
			</div>
			{/* An even 4-up grid, not a scroller: with exactly four presets a rail
			    would hide the last one behind an edge on a 390px phone and make
			    the seller discover it by swiping. Four equal targets fit, so show
			    all four. Each stays well over the 44px tap floor. */}
			<div className="grid grid-cols-4 gap-2">
				{SHARE_TAG_PRESETS.map((p) => {
					const brand = BRAND_GLYPHS[p.tag];
					const justCopied = copiedTag === p.tag;
					return (
						<button
							key={p.tag}
							type="button"
							onClick={() => void copyTagged(p.tag, p.label)}
							aria-label={`Copy ${p.label} link`}
							className={cn(
								"group flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border bg-background px-1 py-2 transition-colors",
								justCopied
									? "border-accent bg-accent/10"
									: "border-border hover:bg-muted",
							)}
						>
							{/* The glyph carries the recognition, so it leads and the
							    word underneath only confirms it. Swapping it for a tick
							    on copy keeps the feedback in the button the seller just
							    pressed rather than only in a toast they may miss. */}
							{justCopied ? (
								<Check className="size-5 text-accent" aria-hidden />
							) : brand ? (
								<brand.Icon className={cn("size-5", brand.colorClass)} />
							) : (
								<Copy className="size-5 text-muted-foreground" aria-hidden />
							)}
							<span className="text-[11px] font-semibold leading-none">
								{justCopied ? "Copied" : p.label}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
