import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ImagePlus, Loader2, Printer, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	type PosterLocale,
	type PosterVariant,
	posterQrUrls,
	StorePoster,
} from "../components/poster/store-poster";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Skeleton } from "../components/ui/skeleton";
import {
	useActAsRetailerId,
	useDashboardRetailer,
} from "../hooks/useDashboardRetailer";
import { convexErrorMessage } from "../lib/format";
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

type HeaderStyle = "brand" | "cover";

/**
 * Print-button helper text per template — the poster's behavior must never be
 * guessed from the preview alone, so each template names what its QR(s) do.
 */
const TEMPLATE_HELP: Record<PosterVariant, string> = {
	both: 'In the print dialog, choose "Save as PDF" to download. The top QR connects walk-up buyers to you on WhatsApp so you can ring them up at the counter; the bottom QR opens your storefront for ordering from home.',
	counter:
		'In the print dialog, choose "Save as PDF" to download. This poster has one big counter QR — walk-up buyers scan it to connect with you on WhatsApp, and you ring up their order at the counter.',
	online:
		'In the print dialog, choose "Save as PDF" to download. This poster has one big online QR — buyers scan it to open your storefront and order from home.',
};

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
	const rotateCounterQrToken = useMutation(
		api.counterCheckout.rotateCounterQrToken,
	);
	const [confirmRotate, setConfirmRotate] = useState(false);
	const [rotating, setRotating] = useState(false);
	// Poster copy is buyer-facing, so the seller picks its language here —
	// default BM (Malaysian buyers) — independent of the dashboard locale.
	const [posterLocale, setPosterLocale] = useState<PosterLocale>("ms");
	// Poster template: the approved two-QR sheet (default) or a single giant
	// DuitNow-style QR for one context. Session-only, like the other toggles.
	const [template, setTemplate] = useState<PosterVariant>("both");
	// Header background: brand mint (Kris's approved default) or the seller's
	// storefront cover photo. Session-only, like the language toggle.
	const [headerStyle, setHeaderStyle] = useState<HeaderStyle>("brand");
	// Don't let a print fire while the cover photo is still streaming — it
	// would print as an empty box. Tracked only for the cover variant.
	const [coverLoaded, setCoverLoaded] = useState(false);

	const coverImageUrl = retailer?.coverImageUrl ?? null;
	const useCover = headerStyle === "cover" && Boolean(coverImageUrl);

	// Preload the cover photo the moment the seller flips to it, and gate the
	// print button until the browser has it (StorePoster stays presentational).
	useEffect(() => {
		if (!useCover || !coverImageUrl) return;
		setCoverLoaded(false);
		const img = new Image();
		img.onload = () => setCoverLoaded(true);
		img.onerror = () => setCoverLoaded(true); // don't wedge the button on a bad blob
		img.src = coverImageUrl;
		if (img.complete) setCoverLoaded(true);
	}, [useCover, coverImageUrl]);

	async function rotate() {
		setRotating(true);
		try {
			await rotateCounterQrToken({ retailerId: actAsRetailerId });
			toast.success(
				"New store QR generated — reprint the poster; old printed copies no longer work.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setRotating(false);
		}
	}

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
	const printWaiting = useCover && !coverLoaded;

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

				{/* One control surface: pick the template, style it, print it. The
				    template comes first — it's the structural choice; language and
				    header background style whichever template is picked. */}
				<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 lg:max-w-2xl">
					<PosterToggle
						label="Poster type"
						options={[
							{ value: "both", label: "Both QRs" },
							{ value: "counter", label: "Counter only" },
							{ value: "online", label: "Online only" },
						]}
						value={template}
						onChange={(v) => setTemplate(v as PosterVariant)}
					/>
					<PosterToggle
						label="Poster language"
						options={[
							{ value: "ms", label: "BM" },
							{ value: "en", label: "EN" },
						]}
						value={posterLocale}
						onChange={(v) => setPosterLocale(v as PosterLocale)}
					/>
					<div className="flex flex-col gap-1.5">
						<PosterToggle
							label="Header background"
							options={[
								{ value: "brand", label: "Kedaipal green" },
								{
									value: "cover",
									label: "Cover photo",
									disabled: !coverImageUrl,
								},
							]}
							value={headerStyle}
							onChange={(v) => setHeaderStyle(v as HeaderStyle)}
						/>
						{!coverImageUrl ? (
							// Disabled-with-reason, always visible (no hover on mobile):
							// the option doubles as a nudge to upload a cover photo.
							<Link
								to="/app/settings"
								search={{ tab: "store" }}
								className="inline-flex items-center gap-1.5 self-end text-xs text-muted-foreground underline-offset-2 hover:underline"
							>
								<ImagePlus className="size-3.5" aria-hidden />
								Upload a cover photo in Settings to use it here
							</Link>
						) : null}
					</div>
					<Button
						onClick={handlePrint}
						disabled={printWaiting}
						className="h-11 w-full gap-2"
					>
						{printWaiting ? (
							<>
								<Loader2 className="size-4 animate-spin" />
								Loading your cover photo…
							</>
						) : (
							<>
								<Printer className="size-4" />
								Print / Save as PDF
							</>
						)}
					</Button>
					<p className="text-xs text-muted-foreground">
						{TEMPLATE_HELP[template]}
					</p>
				</div>

				{/* Counter QR management — the one home for rotating the permanent QR
				    (86ey5neg6). Rotating replaces the token, so every printed poster
				    stops working; confirm-gated. */}
				<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:max-w-2xl">
					<div>
						<p className="text-sm font-semibold">Counter QR</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Your permanent counter QR never expires. If a poster leaks or gets
							misused, rotate it — old printed copies stop working immediately,
							so reprint and put up the new poster.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => setConfirmRotate(true)}
						disabled={rotating || !storeQr?.token}
						className="h-11 w-full gap-2 sm:w-fit"
					>
						<RefreshCw className="size-4" />
						Rotate QR…
					</Button>
				</div>

				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:max-w-2xl">
					Preview — exactly what prints
				</p>
			</div>

			<ConfirmDialog
				open={confirmRotate}
				onOpenChange={setConfirmRotate}
				title="Rotate the store QR?"
				description="A new QR is generated and every printed copy of the old one stops working immediately. You'll need to print and put up the new poster."
				confirmLabel="Rotate QR"
				cancelLabel="Keep current QR"
				destructive
				onConfirm={() => {
					void rotate();
				}}
			/>

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
						headerImageUrl={useCover ? coverImageUrl : null}
						locale={posterLocale}
						counterUrl={counterUrl}
						onlineUrl={onlineUrl}
						variant={template}
					/>
				</div>
			</div>
		</div>
	);
}

/**
 * Segmented control shared by the language + header-background pickers.
 * Options can be disabled-with-reason (the caller renders the reason inline —
 * hover tooltips don't exist on mobile).
 */
function PosterToggle({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: { value: string; label: string; disabled?: boolean }[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		// flex-wrap: a 3-option toggle (Poster type) outgrows a 390px row, so
		// the pill group drops to its own line instead of overflowing the card.
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
			<span className="text-sm font-semibold">{label}</span>
			<fieldset
				className="flex rounded-xl border border-border p-1"
				aria-label={label}
			>
				{options.map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => onChange(opt.value)}
						disabled={opt.disabled}
						aria-pressed={value === opt.value}
						className={`min-h-11 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 ${
							value === opt.value
								? "bg-foreground text-background"
								: "text-muted-foreground hover:bg-muted"
						}`}
					>
						{opt.label}
					</button>
				))}
			</fieldset>
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
			<Skeleton className="h-52 w-full rounded-2xl lg:max-w-2xl" />
			<Skeleton className="h-32 w-full rounded-2xl lg:max-w-2xl" />
			<Skeleton className="aspect-[210/297] w-full max-w-md" />
		</div>
	);
}
