import QRCode from "react-qr-code";
import { m } from "../../paraglide/messages";

export type PosterLocale = "en" | "ms";

interface StorePosterProps {
	storeName: string;
	slug: string;
	logoUrl?: string | null;
	/**
	 * Optional header background photo (the seller's storefront cover image).
	 * When set, the mint header is replaced by the photo under a dark scrim so
	 * the white text stays legible — the same treatment the storefront header
	 * uses. Null/undefined keeps the brand mint header (the default).
	 */
	headerImageUrl?: string | null;
	locale: PosterLocale;
	/**
	 * Left "At the counter" QR. The real target is the permanent walk-in
	 * `wa.me?text=…KPS-<counterQrToken>…` deep link (`getStoreQr().waUrl`,
	 * 86ey5m35w): the buyer scans → WhatsApp opens → they're connected → the
	 * cashier rings up the order. The route falls back to the storefront
	 * `?src=counter` link when the WABA number isn't configured, so the poster
	 * is always printable.
	 */
	counterUrl: string;
	/** Right "Order online" QR — the storefront `?src=online` link. */
	onlineUrl: string;
}

/**
 * Storefront QR fallbacks. `?src=` is a reserved attribution tag (PostHog
 * later) that the storefront ignores today. `online` is the poster's online
 * QR; `counter` is only the fallback the route uses when the walk-in `waUrl`
 * isn't available (WABA number unset) — the primary counter target is the KPS
 * deep link. See docs/store-qr-poster.md.
 */
export function posterQrUrls(
	origin: string,
	slug: string,
): { counter: string; online: string } {
	return {
		counter: `${origin}/${slug}?src=counter`,
		online: `${origin}/${slug}?src=online`,
	};
}

/** Poster copy is buyer-facing; colors are fixed print values from Kris's v2
 * Figma spec (86ey65cm6), deliberately NOT semantic tokens — the sheet must
 * print the same regardless of the seller's dashboard theme. */
const NAVY = "#0F172A";
const MINT = "#10B981";
/** Badge/step-number green — the spec uses this second green, not brand mint. */
const BADGE_GREEN = "#00BC7C";
/** Seller-logo ring — a hair darker than the mint header, per the v2 spec. */
const LOGO_RING = "#109B6D";
/** WhatsApp chat bubble green from the spec's phone mockup. */
const BUBBLE_GREEN = "#D1F498";

/**
 * The print-ready A4 sheet, re-skinned to Kris's v2 spec (86ey65cx8): mint
 * header with the store lockup + URL pill, QR column left / step lists right,
 * and a decorative bottom band (gradient + doodles + WhatsApp phone mockup)
 * that bleeds off the page. Pure presentational — no hooks, no data fetching —
 * so it renders identically on screen (scaled preview) and in print, and is
 * trivially testable. Sized in mm; the parent handles screen scaling and the
 * `@page` print rule.
 */
export function StorePoster({
	storeName,
	slug,
	logoUrl,
	headerImageUrl,
	locale,
	counterUrl,
	onlineUrl,
}: StorePosterProps) {
	const longName = storeName.length > 24;
	const longSlug = slug.length > 24;
	const coverHeader = Boolean(headerImageUrl);

	return (
		<div
			className="poster-sheet relative flex h-[296mm] w-[210mm] flex-col overflow-hidden bg-white text-[#0F172A] [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
			data-testid="poster-sheet"
		>
			{/* Bottom band — white→mint gradient as an inline SVG rect (NOT a CSS
			    background gradient: element content always prints, so the band
			    survives even without "Background graphics"). Doodles + phone sit
			    on top of it; everything here is decorative. */}
			<div
				className="absolute inset-x-0 bottom-0 h-[119mm]"
				aria-hidden="true"
				data-testid="poster-band"
			>
				<svg
					className="absolute inset-0 h-full w-full"
					preserveAspectRatio="none"
					viewBox="0 0 10 10"
					role="presentation"
				>
					<defs>
						<linearGradient id="poster-band-fade" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stopColor="#FFFFFF" />
							<stop offset="1" stopColor="#D9F4EA" />
						</linearGradient>
					</defs>
					<rect width="10" height="10" fill="url(#poster-band-fade)" />
				</svg>
				<img
					src="/poster/doodles-left.svg"
					alt=""
					className="absolute bottom-0 left-[-3mm] w-[63mm]"
				/>
				<img
					src="/poster/doodles-right.svg"
					alt=""
					className="absolute bottom-0 right-[-2mm] w-[63mm]"
				/>
			</div>

			{/* Header — mint (default) or the seller's cover photo under a dark
			    scrim; white text either way. */}
			<div
				className="relative h-[63mm] shrink-0"
				style={coverHeader ? undefined : { backgroundColor: MINT }}
				data-testid="poster-header"
			>
				{coverHeader ? (
					<>
						{/* <img>, not a CSS background — backgrounds can be stripped in
						    print; element images always print. */}
						<img
							src={headerImageUrl ?? undefined}
							alt=""
							className="absolute inset-0 h-full w-full object-cover"
						/>
						<div
							className="absolute inset-0"
							style={{ backgroundColor: "rgba(15, 23, 42, 0.55)" }}
							data-testid="poster-header-scrim"
						/>
					</>
				) : null}
				<div
					className={`relative flex h-full flex-col justify-center gap-[3mm] pl-[17mm] ${
						logoUrl ? "pr-[54mm]" : "pr-[17mm]"
					}`}
				>
					<p
						className={`text-balance break-words font-heading font-extrabold leading-tight text-white ${
							longName ? "text-[24pt]" : "text-[35pt]"
						}`}
					>
						{storeName}
					</p>
					<p className="font-heading text-[21pt] font-medium leading-none text-white/80">
						{m.poster_headline({}, { locale })}
					</p>
					{/* Human-readable storefront address, no ?src */}
					<p
						className={`w-fit max-w-full break-all rounded-full px-[7mm] py-[2.2mm] font-heading font-medium ${
							longSlug ? "text-[11pt]" : "text-[13pt]"
						}`}
						style={{ backgroundColor: NAVY, color: MINT }}
					>
						kedaipal.com/
						<span className="font-extrabold text-white">{slug}</span>
					</p>
				</div>
				{logoUrl ? (
					/* White circle panel (seller logos can be dark/navy — no luminance
					   detection at print time) with the spec's thin green ring, a hair
					   darker than the mint header. The logo fills the inner circle with
					   a hairline white gutter so non-circular logos don't touch the ring. */
					<div
						className="absolute right-[13mm] top-[12mm] flex h-[40mm] w-[40mm] items-center justify-center overflow-hidden rounded-full border-[1mm] bg-white p-[1mm]"
						style={{ borderColor: LOGO_RING }}
						data-testid="poster-logo"
					>
						<img
							src={logoUrl}
							alt=""
							className="h-full w-full rounded-full object-contain"
						/>
					</div>
				) : null}
			</div>

			{/* Body — QR column left, step lists right. QR boxes stay ≥56mm (v1
			    invariant): iOS Safari ignores `@page` and scale-to-fits (~10%
			    shrink), so 56mm lands ≥50mm — above the 45mm scan floor. The v2
			    mockup drew them smaller; the ticket AC overrides it. Fixed height:
			    the 56mm boxes outgrow the mockup's flex budget, so the rows stack on
			    explicit gaps and the footer/phone below sit at pinned sheet
			    coordinates — flex flow would push the footer under the phone. */}
			<div className="relative flex flex-col gap-[3mm] px-[17mm] pt-[6mm]">
				<QrRow
					url={counterUrl}
					badge={m.poster_counter_badge({}, { locale })}
					title={m.poster_counter_title({}, { locale })}
					steps={[
						m.poster_counter_step1({}, { locale }),
						m.poster_counter_step2({}, { locale }),
						m.poster_counter_step3({}, { locale }),
					]}
				/>
				<QrRow
					url={onlineUrl}
					badge={m.poster_online_badge({}, { locale })}
					title={m.poster_online_title({}, { locale })}
					steps={[
						m.poster_online_step1({}, { locale }),
						m.poster_online_step2({}, { locale }),
						m.poster_online_step3({}, { locale }),
					]}
				/>
			</div>

			{/* Footer — powered by Kedaipal, pinned above the phone (the phone
			    paints later/on top, so the lockup must never flow under it). */}
			<div className="absolute inset-x-0 top-[204mm] flex flex-col items-center gap-[2.5mm]">
				<p
					className="rounded-full border-[0.4mm] border-[#B9D9CC] px-[5mm] py-[1.4mm] text-[10.5pt] font-semibold uppercase tracking-[0.2em] text-[#7BA394]"
					data-testid="poster-powered-by"
				>
					{m.poster_powered_by({}, { locale })}
				</p>
				<img
					src="/poster/kedaipal-lockup.svg"
					alt="Kedaipal"
					className="h-[7.5mm] w-auto"
				/>
			</div>
			<PhoneMockup storeName={storeName} logoUrl={logoUrl} locale={locale} />
		</div>
	);
}

/**
 * One QR row: the bordered QR box on the left, badge + title + numbered steps
 * on the right. The QR module area is a fixed 56mm with a ≥3mm white quiet
 * zone (react-qr-code renders none itself).
 */
function QrRow({
	url,
	badge,
	title,
	steps,
}: {
	url: string;
	badge: string;
	title: string;
	steps: string[];
}) {
	return (
		<div className="flex items-center gap-[10mm]">
			<div
				className="shrink-0 rounded-[4mm] border-[0.8mm] bg-white p-[3mm]"
				style={{ borderColor: MINT }}
				data-testid="poster-qr"
			>
				<div className="h-[56mm] w-[56mm]">
					<QRCode
						value={url}
						level="H"
						size={256}
						style={{ width: "100%", height: "100%" }}
					/>
				</div>
			</div>
			<div className="flex min-w-0 flex-col items-start gap-[3mm]">
				<span
					className="rounded-full px-[7mm] py-[2mm] font-heading text-[15pt] font-extrabold leading-none text-white"
					style={{ backgroundColor: BADGE_GREEN }}
				>
					{badge}
				</span>
				<h2 className="font-heading text-[13.5pt] font-extrabold">{title}</h2>
				<ol className="flex flex-col gap-[2mm] text-[13pt] leading-snug">
					{steps.map((step, i) => (
						<li key={step} className="flex gap-[2.5mm]">
							<span className="font-bold">{i + 1}.</span>
							<span>{step}</span>
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}

/**
 * The decorative WhatsApp phone at the foot of the sheet — Kris's phone-shell
 * raster (empty frame + green header + beige chat wallpaper) with the store's
 * real avatar/name and localized sample bubbles overlaid live, so the mockup
 * always shows the seller's own store. Bleeds off the page bottom by design
 * (the sheet clips it).
 */
function PhoneMockup({
	storeName,
	logoUrl,
	locale,
}: {
	storeName: string;
	logoUrl?: string | null;
	locale: PosterLocale;
}) {
	return (
		<div
			className="absolute left-[49mm] top-[223.5mm] w-[112mm]"
			aria-hidden="true"
			data-testid="poster-phone"
		>
			<img src="/poster/phone-shell.png" alt="" className="w-full" />
			{/* Status bar — the shell raster ships with an empty green band, so
			    the clock + indicators are drawn here (tiny, purely decorative). */}
			<div className="absolute left-[19.5mm] right-[19.5mm] top-[13.2mm] flex items-center justify-between">
				<span className="text-[11pt] font-semibold leading-none text-white">
					9:30
				</span>
				<svg
					viewBox="0 0 46 12"
					className="h-[3mm] w-auto"
					fill="#FFFFFF"
					role="presentation"
				>
					{/* signal bars */}
					<rect x="0" y="7" width="2.5" height="5" rx="0.8" />
					<rect x="4" y="5" width="2.5" height="7" rx="0.8" />
					<rect x="8" y="3" width="2.5" height="9" rx="0.8" />
					<rect x="12" y="1" width="2.5" height="11" rx="0.8" />
					{/* wifi */}
					<path d="M25 3.2a9.4 9.4 0 0 0-6.4 2.5l1.4 1.5A7.4 7.4 0 0 1 25 5.2c1.9 0 3.7.7 5 2l1.4-1.5A9.4 9.4 0 0 0 25 3.2Z" />
					<path d="M25 7.1c-1.2 0-2.3.4-3.1 1.2l1.5 1.6a2.3 2.3 0 0 1 3.2 0l1.5-1.6A4.5 4.5 0 0 0 25 7.1Z" />
					<circle cx="25" cy="11" r="1.2" />
					{/* battery */}
					<rect
						x="34"
						y="1.5"
						width="10"
						height="9"
						rx="2"
						fill="none"
						stroke="#FFFFFF"
						strokeWidth="1"
					/>
					<rect x="35.5" y="3" width="7" height="6" rx="1" />
					<rect x="44.8" y="4.5" width="1.2" height="3" rx="0.6" />
				</svg>
			</div>
			{/* Chat header row — inside the shell's green band */}
			<div className="absolute left-[13mm] right-[13mm] top-[15.5mm] flex items-center gap-[2.5mm]">
				<div className="flex h-[8mm] w-[8mm] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/90">
					{logoUrl ? (
						<img
							src={logoUrl}
							alt=""
							className="h-full w-full rounded-full object-cover"
						/>
					) : (
						<span className="text-[8pt] font-bold" style={{ color: MINT }}>
							{storeName.charAt(0).toUpperCase()}
						</span>
					)}
				</div>
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-[11pt] font-semibold leading-tight text-white">
						{storeName}
					</span>
					<span className="text-[7pt] leading-tight text-white/75">
						{m.poster_chat_online({}, { locale })}
					</span>
				</div>
			</div>
			{/* Buyer-side sample bubbles */}
			<div className="absolute right-[8mm] top-[42mm] flex w-[70mm] flex-col items-end gap-[4mm]">
				{[
					m.poster_chat_bubble1({}, { locale }),
					m.poster_chat_bubble2({}, { locale }),
				].map((text) => (
					<p
						key={text}
						className="max-w-full rounded-[2.5mm] rounded-br-[0.8mm] px-[3.5mm] py-[2mm] text-[10pt] leading-snug"
						style={{ backgroundColor: BUBBLE_GREEN, color: NAVY }}
					>
						{text}
					</p>
				))}
			</div>
		</div>
	);
}
