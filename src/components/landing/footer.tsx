import { Link } from "@tanstack/react-router";
import { Instagram, Mail, Music2 } from "lucide-react";
import { LEGAL_CONTACT_EMAIL } from "../../lib/legal";
import { m } from "../../paraglide/messages";

export function Footer() {
	const contactLinkClass =
		"group inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-primary-foreground/85 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/15 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
	const legalLinkClass =
		"transition-colors hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

	return (
		<footer className="bg-primary pb-[max(2rem,env(safe-area-inset-bottom))] text-primary-foreground">
			<div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
				<div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(24rem,auto)] md:items-start">
					<div className="max-w-sm">
						<img src="/logo-dark.svg" alt="Kedaipal" className="h-8 w-auto" />
						<p className="mt-5 text-sm leading-6 text-primary-foreground/65">
							{m.footer_tagline()}
						</p>
					</div>

					<div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-12">
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
								<a
									href="https://www.instagram.com/kedaipal_my/"
									target="_blank"
									rel="noopener noreferrer"
									className={contactLinkClass}
								>
									<Instagram className="size-4 transition-transform group-hover:-rotate-6" />
									<span>{m.footer_instagram()}</span>
								</a>
								<a
									href="https://www.tiktok.com/@kedaipal"
									target="_blank"
									rel="noopener noreferrer"
									className={contactLinkClass}
								>
									<Music2 className="size-4 transition-transform group-hover:-rotate-6" />
									<span>{m.footer_tiktok()}</span>
								</a>
							</div>
						</div>

						<nav aria-labelledby="footer-legal-heading">
							<h2
								id="footer-legal-heading"
								className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/45"
							>
								{m.footer_legal()}
							</h2>
							<div className="mt-4 flex flex-col items-start gap-3 text-sm text-primary-foreground/65">
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
				<div className="mt-10 border-t border-white/10 pt-6 text-xs text-primary-foreground/50">
					<p>{m.footer_copyright({ year: new Date().getFullYear() })}</p>
				</div>
			</div>
		</footer>
	);
}
