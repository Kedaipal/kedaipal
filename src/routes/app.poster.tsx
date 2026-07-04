import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	type PosterLocale,
	posterQrUrls,
	StorePoster,
} from "../components/poster/store-poster";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import {
	useActAsRetailerId,
	useDashboardRetailer,
} from "../hooks/useDashboardRetailer";
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
	const actAsRetailerId = useActAsRetailerId();
	const markLinkShared = useMutation(api.retailers.markLinkShared);
	// The permanent walk-in store QR (86ey5m35w): the left "At the counter" QR
	// encodes this `KPS-` wa.me deep link so a scan starts a walk-in checkout
	// the cashier rings up. `waUrl` is undefined until a token exists / if the
	// WABA number is unset.
	const storeQr = useQuery(api.counterCheckout.getStoreQr, {
		retailerId: actAsRetailerId,
	});
	const ensureCounterQrToken = useMutation(
		api.counterCheckout.ensureCounterQrToken,
	);
	// Poster copy is buyer-facing, so the seller picks its language here —
	// default BM (Malaysian buyers) — independent of the dashboard locale.
	const [posterLocale, setPosterLocale] = useState<PosterLocale>("ms");

	// Self-serve provisioning: the printable poster needs the permanent token to
	// exist, so mint it on first visit if the seller never opened Counter
	// Checkout. Idempotent + owner-or-admin (act-as operates the seller's store),
	// so it's safe to fire once. The counter QR falls back to the storefront
	// link until it resolves, so the poster is never blocked.
	const ensuredToken = useRef(false);
	useEffect(() => {
		if (ensuredToken.current) return;
		if (storeQr === undefined || storeQr.token !== null) return;
		ensuredToken.current = true;
		void ensureCounterQrToken({ retailerId: actAsRetailerId }).catch(() => {
			// Non-fatal — the counter QR falls back to the storefront link.
		});
	}, [storeQr, ensureCounterQrToken, actAsRetailerId]);

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

	// Left QR = the walk-in KPS deep link when available; else the storefront
	// `?src=counter` fallback so the poster always prints. Right QR = storefront.
	const { counter: counterFallback, online: onlineUrl } = posterQrUrls(
		storefrontOrigin(),
		retailer.slug,
	);
	const counterUrl = storeQr?.waUrl ?? counterFallback;

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
						In the print dialog, choose "Save as PDF" to download. The left QR
						connects walk-up buyers to you on WhatsApp so you can ring them up
						at the counter; the right QR opens your storefront for ordering from
						home.
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
						counterUrl={counterUrl}
						onlineUrl={onlineUrl}
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
