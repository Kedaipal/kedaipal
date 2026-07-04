import QRCode from "react-qr-code";
import { m } from "../../paraglide/messages";

export type PosterLocale = "en" | "ms";

interface StorePosterProps {
	storeName: string;
	slug: string;
	logoUrl?: string | null;
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
 * later) that the storefront ignores today. `online` is the poster's right QR;
 * `counter` is only the fallback the route uses when the walk-in `waUrl` isn't
 * available (WABA number unset) — the primary counter target is the KPS deep
 * link. See docs/store-qr-poster.md.
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

/** Poster copy is buyer-facing; colors are fixed print values (light-theme
 * navy/mint), deliberately NOT semantic tokens — the sheet must print the same
 * regardless of the seller's dashboard theme. */
const NAVY = "#0F172A";
const MINT = "#10B981";

/**
 * The print-ready A4 sheet. Pure presentational — no hooks, no data fetching —
 * so it renders identically on screen (scaled preview) and in print, and is
 * trivially testable. Sized in mm; the parent handles screen scaling and the
 * `@page` print rule.
 */
export function StorePoster({
	storeName,
	slug,
	logoUrl,
	locale,
	counterUrl,
	onlineUrl,
}: StorePosterProps) {
	const longName = storeName.length > 24;
	const longSlug = slug.length > 24;

	return (
		<div
			className="poster-sheet flex w-[210mm] min-h-[296mm] flex-col bg-white text-[#0F172A] [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
			data-testid="poster-sheet"
		>
			{/* Header — full-bleed navy, logo + store name + headline */}
			<div className="flex flex-col items-center gap-[7mm] bg-[#0F172A] px-[12mm] pb-[11mm] pt-[13mm]">
				{logoUrl ? (
					/* Always on a white panel — seller logos can be dark/navy and there
					   is no reliable way to detect that at print time. */
					<div className="flex h-[26mm] w-[26mm] items-center justify-center rounded-2xl bg-white p-[2mm]">
						<img
							src={logoUrl}
							alt=""
							className="h-full w-full object-contain"
						/>
					</div>
				) : null}
				<p
					className={`max-w-full text-balance break-words text-center font-heading font-extrabold text-white ${
						logoUrl ? "text-[20pt]" : longName ? "text-[26pt]" : "text-[34pt]"
					}`}
				>
					{storeName}
				</p>
				<h1 className="max-w-full text-balance text-center font-heading text-[22pt] font-extrabold uppercase tracking-[0.06em] text-white">
					{m.poster_headline({}, { locale })}
				</h1>
			</div>
			<div className="h-[3mm] shrink-0 bg-[#10B981]" aria-hidden="true" />

			{/* Body — two QR cards + URL pill */}
			<div className="flex flex-1 flex-col justify-evenly gap-[8mm] px-[12mm] py-[9mm]">
				<div className="grid grid-cols-2 gap-[6mm]">
					<QrCard
						badge={m.poster_counter_badge({}, { locale })}
						title={m.poster_counter_title({}, { locale })}
						steps={[
							m.poster_counter_step1({}, { locale }),
							m.poster_counter_step2({}, { locale }),
							m.poster_counter_step3({}, { locale }),
						]}
						url={counterUrl}
					/>
					<QrCard
						badge={m.poster_online_badge({}, { locale })}
						title={m.poster_online_title({}, { locale })}
						steps={[
							m.poster_online_step1({}, { locale }),
							m.poster_online_step2({}, { locale }),
							m.poster_online_step3({}, { locale }),
						]}
						url={onlineUrl}
					/>
				</div>

				{/* URL pill — human-readable storefront address, no ?src */}
				<div className="flex justify-center">
					<p
						className={`max-w-full break-all rounded-full bg-[#0F172A] px-[10mm] py-[4mm] text-center font-mono font-semibold text-white ${
							longSlug ? "text-[11pt]" : "text-[14pt]"
						}`}
					>
						kedaipal.com/<span className="text-[#10B981]">{slug}</span>
					</p>
				</div>
			</div>

			{/* Footer — powered by Kedaipal, mint base bar */}
			<div className="flex flex-col items-center gap-[3mm] pb-[8mm]">
				<p className="text-[9pt] font-semibold uppercase tracking-[0.35em] text-[#64748B]">
					{m.poster_powered_by({}, { locale })}
				</p>
				<img src="/logo-2.svg" alt="Kedaipal" className="h-[10mm] w-auto" />
			</div>
			<div className="h-[3mm] shrink-0 bg-[#10B981]" aria-hidden="true" />
		</div>
	);
}

/**
 * One QR card. The QR box is a fixed 56mm so it stays ≥45mm even when iOS
 * Safari ignores `@page` and scale-to-fits the sheet (~10% shrink); the white
 * padding around the SVG is the quiet zone (react-qr-code renders none).
 */
function QrCard({
	badge,
	title,
	steps,
	url,
}: {
	badge: string;
	title: string;
	steps: string[];
	url: string;
}) {
	return (
		<div className="flex flex-col items-center gap-[4mm] rounded-[5mm] border border-[#CBD5E1] bg-[#F8FAFC] px-[7mm] py-[8mm]">
			<span
				className="rounded-full px-[5mm] py-[1.6mm] text-[10pt] font-bold uppercase tracking-[0.08em] text-white"
				style={{ backgroundColor: MINT }}
			>
				{badge}
			</span>
			<h2 className="text-center font-heading text-[15pt] font-extrabold">
				{title}
			</h2>
			<div
				className="rounded-[3mm] border-[0.7mm] bg-white p-[3.5mm]"
				style={{ borderColor: NAVY }}
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
			<ol className="flex w-full flex-col gap-[2.5mm] text-[10.5pt] leading-snug">
				{steps.map((step, i) => (
					<li key={step} className="flex gap-[2mm]">
						<span className="font-bold" style={{ color: MINT }}>
							{i + 1}.
						</span>
						<span>{step}</span>
					</li>
				))}
			</ol>
		</div>
	);
}
