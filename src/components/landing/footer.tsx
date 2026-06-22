import { Link } from "@tanstack/react-router";
import { m } from "../../paraglide/messages";

export function Footer() {
	return (
		<footer className="bg-primary pb-[max(2rem,env(safe-area-inset-bottom))] text-primary-foreground">
			<div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
				<div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
					<img src="/logo-dark.svg" alt="Kedaipal" className="h-8 w-auto" />
				</div>
				<div className="mt-8 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-primary-foreground/60 md:flex-row md:items-center md:justify-between">
					<p>{m.footer_copyright({ year: new Date().getFullYear() })}</p>
					<div className="flex items-center gap-4">
						<Link
							to="/privacy"
							className="transition-colors hover:text-primary-foreground"
						>
							{m.footer_privacy()}
						</Link>
						<Link
							to="/terms"
							className="transition-colors hover:text-primary-foreground"
						>
							{m.footer_terms()}
						</Link>
						<Link
							to="/acceptable-use"
							className="transition-colors hover:text-primary-foreground"
						>
							{m.footer_aup()}
						</Link>
					</div>
					<p>{m.footer_tagline()}</p>
				</div>
			</div>
		</footer>
	);
}
