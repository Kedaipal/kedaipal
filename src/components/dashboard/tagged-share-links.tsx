import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SHARE_TAG_PRESETS } from "../../../convex/lib/attribution";

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
			{/* Horizontal scroll below sm rather than a wrap: keeps the share card
			    a predictable height on a phone (the category-rail idiom). */}
			<div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{SHARE_TAG_PRESETS.map((p) => (
					<button
						key={p.tag}
						type="button"
						onClick={() => void copyTagged(p.tag, p.label)}
						className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3.5 text-sm font-semibold transition-colors hover:bg-muted"
					>
						<Copy className="size-3.5 text-muted-foreground" aria-hidden />
						{copiedTag === p.tag ? "Copied!" : p.label}
					</button>
				))}
			</div>
		</div>
	);
}
