import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Printer } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	type PosterLocale,
	StorePoster,
} from "../components/poster/store-poster";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { storefrontOrigin } from "../lib/storefront-url";

export const Route = createFileRoute("/app/poster")({
	component: PosterRoute,
});

/** A4 at CSS 96dpi — the poster's natural on-screen size (210mm × 297mm). */
const SHEET_PX_WIDTH = 794;
const SHEET_PX_HEIGHT = 1123;

/**
 * Print rules scoped to this route: mounting the <style> only while the poster
 * page is mounted is the ONLY way to scope `@page` (it can't be conditioned on
 * a selector), so `margin: 0` never leaks into printing other dashboard pages.
 * The app shell chrome carries global `print:hidden` classes instead.
 */
const POSTER_PRINT_CSS = `
@media print {
	@page { size: A4 portrait; margin: 0; }
	.poster-scale { transform: none !important; width: auto !important; height: auto !important; }
}
`;

function PosterRoute() {
	const retailer = useDashboardRetailer();
	const markLinkShared = useMutation(api.retailers.markLinkShared);
	// Poster copy is buyer-facing, so the seller picks its language here —
	// default BM (Malaysian buyers) — independent of the dashboard locale.
	const [posterLocale, setPosterLocale] = useState<PosterLocale>("ms");

	// Scale the A4 sheet down to fit the viewport (~49% on a 390px phone).
	const previewRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	useLayoutEffect(() => {
		const el = previewRef.current;
		if (!el) return;
		const update = () => setScale(Math.min(1, el.clientWidth / SHEET_PX_WIDTH));
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	if (!retailer) return <PosterSkeleton />;

	function handlePrint() {
		// Printing the poster is a "shared their link" signal for the activation
		// funnel. Fire-and-forget; the mutation resolves by caller identity, so
		// skip it in admin act-as (it would stamp the admin's own store).
		if (!retailer?.actingAsAdmin) {
			void markLinkShared({}).catch(() => {
				// ignore — the seller still gets their poster
			});
		}
		window.print();
	}

	return (
		<div className="flex flex-col gap-6">
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static print CSS constant, no user input */}
			<style dangerouslySetInnerHTML={{ __html: POSTER_PRINT_CSS }} />

			{/* Page chrome — never printed */}
			<div className="flex flex-col gap-6 print:hidden">
				<PageHeader
					title="Store poster"
					subtitle="A print-ready A4 poster with your store QR codes"
					back={{ to: "/app", label: "Home" }}
				/>
				{/* Mobile title */}
				<div className="flex flex-col gap-1 lg:hidden">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Store poster
					</h2>
					<p className="text-[13px] text-muted-foreground">
						Print it, stick it at your counter, and buyers order by scanning.
					</p>
				</div>

				<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:max-w-2xl">
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm font-semibold">Poster language</span>
						{/* Buyer-facing copy toggle — BM first (default) */}
						<fieldset
							className="flex rounded-xl border border-border p-1"
							aria-label="Poster language"
						>
							{(
								[
									{ value: "ms", label: "BM" },
									{ value: "en", label: "EN" },
								] as const
							).map((opt) => (
								<button
									key={opt.value}
									type="button"
									onClick={() => setPosterLocale(opt.value)}
									aria-pressed={posterLocale === opt.value}
									className={`min-h-11 rounded-lg px-5 text-sm font-semibold transition-colors ${
										posterLocale === opt.value
											? "bg-foreground text-background"
											: "text-muted-foreground hover:bg-muted"
									}`}
								>
									{opt.label}
								</button>
							))}
						</fieldset>
					</div>
					<Button onClick={handlePrint} className="h-11 w-full gap-2">
						<Printer className="size-4" />
						Print / Save as PDF
					</Button>
					<p className="text-xs text-muted-foreground">
						In the print dialog, choose "Save as PDF" to download. Both QR codes
						open your storefront — the left one is for walk-up buyers at your
						counter, the right one for ordering from home.
					</p>
				</div>
			</div>

			{/* Scaled live preview — becomes the actual print artifact. The inner
			    div keeps its natural 794px layout width (transform doesn't affect
			    layout), so clip the overflow on screen; print resets the transform. */}
			<div
				ref={previewRef}
				className="w-full overflow-hidden print:overflow-visible"
			>
				<div
					className="poster-scale origin-top-left shadow-lg ring-1 ring-border print:shadow-none print:ring-0"
					style={{
						transform: `scale(${scale})`,
						width: SHEET_PX_WIDTH,
						height: SHEET_PX_HEIGHT * scale,
					}}
				>
					<StorePoster
						storeName={retailer.storeName}
						slug={retailer.slug}
						logoUrl={retailer.logoUrl}
						locale={posterLocale}
						origin={storefrontOrigin()}
					/>
				</div>
			</div>
		</div>
	);
}

function PosterSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<PageHeaderSkeleton hasBack hasSubtitle />
			<div className="flex flex-col gap-1.5 lg:hidden">
				<Skeleton className="h-6 w-32" />
				<Skeleton className="h-3 w-52" />
			</div>
			<Skeleton className="h-36 w-full rounded-2xl lg:max-w-2xl" />
			<Skeleton className="aspect-[210/297] w-full max-w-md" />
		</div>
	);
}
