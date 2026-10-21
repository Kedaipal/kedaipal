import { Link } from "@tanstack/react-router";
import { Instagram, Mail, Music2 } from "lucide-react";
import { LEGAL_CONTACT_EMAIL } from "../../lib/legal";
import { SOCIAL_LINKS, type SocialLinkId } from "../../lib/site-identity";
import { BLOG_URL } from "../../lib/site-links";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { PaymentStripCompact } from "./payment-methods";

// The profile URLs live in `site-identity.ts` so the footer and the
// Organization `sameAs` on `/` can never point at different accounts.
const SOCIAL_ICON: Record<SocialLinkId, typeof Instagram> = {
	instagram: Instagram,
	tiktok: Music2,
};
const SOCIAL_LABEL: Record<SocialLinkId, () => string> = {
	instagram: m.footer_instagram,
	tiktok: m.footer_tiktok,
};

export function Footer() {
	const contactLinkClass =
		"group inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 dark:border-foreground/10 bg-white/[0.04] dark:bg-foreground/[0.04] px-4 text-sm font-medium text-primary-foreground/85 dark:text-foreground/85 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/15 hover:text-primary-foreground dark:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
	const legalLinkClass =
		"inline-flex min-h-11 items-center transition-colors hover:text-primary-foreground dark:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

	return (
		<footer
			id="site-footer"
			// `bg-primary` is navy in light and MINT in dark (the token flips hue), so the
			// footer takes the card surface in dark; its `text-primary-foreground/NN` ink
			// would turn navy-on-navy there, hence every twin below.
			className="bg-primary pb-[max(2rem,env(safe-area-inset-bottom))] text-primary-foreground dark:bg-card dark:text-foreground"
		>
			<div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
				<div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(24rem,auto)] md:items-start">
					<div className="max-w-sm">
						<AppImage
							src="/logo-dark.svg"
							alt="Kedaipal"
							aspect="h-8 w-auto"
							fill={false}
						/>
						<p className="mt-5 text-sm leading-6 text-primary-foreground/65 dark:text-foreground/65">
							{m.footer_tagline()}
						</p>
					</div>

					<div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-12">
						<div>
							<h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
								{m.footer_contact()}
							</h2>
							<div className="mt-4 flex flex-wrap gap-2.5">
								<a
									href={`mailto:${LEGAL_CONTACT_EMAIL}`}
									className={contactLinkClass}
								>
									<Mail className="size-4 transition-transform group-hover:-rotate-6" />
									<span>{LEGAL_CONTACT_EMAIL}</span>
								</a>
								{SOCIAL_LINKS.map((link) => {
									const Icon = SOCIAL_ICON[link.id];
									return (
										<a
											key={link.id}
											href={link.url}
											target="_blank"
											rel="noopener noreferrer"
											className={contactLinkClass}
										>
											<Icon className="size-4 transition-transform group-hover:-rotate-6" />
											<span>{SOCIAL_LABEL[link.id]()}</span>
										</a>
									);
								})}
							</div>
						</div>

						<nav aria-labelledby="footer-explore-heading">
							<h2
								id="footer-explore-heading"
								className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/45 dark:text-foreground/45"
							>
								{m.footer_explore()}
							</h2>
							<div className="mt-4 flex flex-col items-start gap-3 text-sm text-primary-foreground/65 dark:text-foreground/65">
								<Link to="/stores" className={legalLinkClass}>
									{m.footer_browse_stores()}
								</Link>
								<a href={BLOG_URL} className={legalLinkClass}>
									{m.footer_blog()}
								</a>
							</div>
						</nav>

						<nav aria-labelledby="footer-legal-heading">
							<h2
								id="footer-legal-heading"
								className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/45 dark:text-foreground/45"
							>
								{m.footer_legal()}
							</h2>
							<div className="mt-4 flex flex-col items-start gap-3 text-sm text-primary-foreground/65 dark:text-foreground/65">
								<Link to="/privacy" className={legalLinkClass}>
									{m.footer_privacy()}
								</Link>
								<Link to="/terms" className={legalLinkClass}>
									{m.footer_terms()}
								</Link>
								<Link to="/acceptable-use" className={legalLinkClass}>
									{m.footer_aup()}
								</Link>
							</div>
						</nav>
					</div>
				</div>
				{/* Compact repeat of the payment strip (86eye3p6z §G) — the rails are
				    a trust signal wherever a visitor stops reading, and the footer is
				    where the "can my customers actually pay me?" question surfaces
				    last. Same config array as the full section on `/`. */}
				<div className="mt-10 border-t border-white/10 dark:border-foreground/10 pt-6">
					<PaymentStripCompact />
				</div>
				<div className="mt-6 border-t border-white/10 dark:border-foreground/10 pt-6 text-xs text-primary-foreground/50 dark:text-foreground/50">
					<p>{m.footer_copyright({ year: new Date().getFullYear() })}</p>
				</div>
			</div>
		</footer>
	);
}
