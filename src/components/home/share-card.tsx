import { Link } from "@tanstack/react-router";
import { ExternalLink, Instagram, Printer, QrCode } from "lucide-react";
import { useState } from "react";
import { TaggedShareLinks } from "../dashboard/tagged-share-links";
import { Button } from "../ui/button";

/**
 * One card for every way of putting the store in front of a buyer
 * (z8r3fdrgzj decision 9).
 *
 * The link, the QR, the poster and the tagged variants used to be three
 * separate cards stacked down the page, which read as three unrelated features
 * rather than one job. They are the same job — "get this link seen" — so they
 * share a card, with the poster and tagged links as quieter rows beneath the
 * two primary actions.
 */
export function ShareCard({
	slug,
	storefrontUrl,
	onCopy,
	onOpenQr,
}: {
	slug: string;
	storefrontUrl: string;
	/** Fire-and-forget "they shared it" stamp — see `markLinkShared`. */
	onCopy: () => void;
	onOpenQr: () => void;
}) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(storefrontUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
			onCopy();
		} catch {
			// The seller can still read the link off the card.
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-foreground/20 bg-card p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
						Your store link
					</span>
					<span className="truncate font-mono text-sm font-medium">
						kedaipal.com/
						<span className="kp-highlight">{slug}</span>
					</span>
				</div>
				<Button
					variant="secondary"
					size="icon"
					className="size-11 shrink-0 rounded-xl"
					onClick={onOpenQr}
					aria-label="Show QR code"
				>
					<QrCode className="size-5" />
				</Button>
			</div>
			<div className="flex gap-2">
				<Button onClick={copy} className="h-11 flex-1">
					{copied ? "Copied!" : "Copy link"}
				</Button>
				<Button asChild variant="outline" className="h-11 flex-1">
					<a href={`/${slug}`} target="_blank" rel="noopener noreferrer">
						<ExternalLink className="size-4" />
						Open live
					</a>
				</Button>
			</div>
			<div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
				<Link
					to="/app/poster"
					className="flex min-h-11 items-center gap-2 rounded-xl px-1 text-xs font-semibold transition-colors hover:bg-muted"
				>
					<Printer
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					Print a QR poster
				</Link>
				<span className="flex min-h-11 items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
					<Instagram className="size-4 shrink-0" aria-hidden="true" />
					Links for Instagram, TikTok
				</span>
			</div>
			<TaggedShareLinks storefrontUrl={storefrontUrl} onCopy={onCopy} />
		</section>
	);
}
