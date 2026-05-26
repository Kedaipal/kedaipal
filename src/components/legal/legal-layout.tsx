import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

interface LegalLayoutProps {
	/** Document title rendered as the page H1. */
	title: string;
	/** ISO date string shown under the title (the document version). */
	lastUpdated: string;
	/** Optional plain-language summary bullets shown above the body. */
	summary?: ReactNode[];
	/** The document body — a stack of <section> blocks. */
	children: ReactNode;
}

/**
 * Shared chrome for the public legal pages (/terms, /privacy, /acceptable-use):
 * sticky header, a centered article column, an optional plain-language summary
 * card, and a footer that cross-links all three documents. Keeps the legal
 * routes free of duplicated header/footer markup.
 */
export function LegalLayout({
	title,
	lastUpdated,
	summary,
	children,
}: LegalLayoutProps) {
	return (
		<main className="min-h-dvh bg-background text-foreground">
			<header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
				<div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5 md:px-8">
					<Link to="/" className="flex items-center">
						<img src="/logo-3.svg" alt="Kedaipal" className="h-9 w-auto" />
					</Link>
					<Link
						to="/"
						className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						← Back to home
					</Link>
				</div>
			</header>

			<article className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
				<h1 className="text-4xl font-bold tracking-tight md:text-5xl">
					{title}
				</h1>
				<p className="mt-3 text-sm text-muted-foreground">
					Last updated: {lastUpdated}
				</p>

				{summary && summary.length > 0 ? (
					<div className="mt-8 rounded-2xl border border-border bg-muted/30 p-5 md:p-6">
						<p className="text-sm font-semibold uppercase tracking-widest text-accent">
							In plain language
						</p>
						<ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground/90">
							{summary.map((item, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable copy
								<li key={i}>{item}</li>
							))}
						</ul>
					</div>
				) : null}

				<div className="mt-10 space-y-8 text-base leading-relaxed text-foreground/90">
					{children}
				</div>
			</article>

			<footer className="border-t border-border/60 bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
				<div className="mx-auto max-w-3xl px-5 py-8 text-xs text-muted-foreground md:px-8">
					<p>
						© {new Date().getFullYear()} Kedaipal ·{" "}
						<Link to="/privacy" className="hover:text-foreground">
							Privacy
						</Link>{" "}
						·{" "}
						<Link to="/terms" className="hover:text-foreground">
							Terms
						</Link>{" "}
						·{" "}
						<Link to="/acceptable-use" className="hover:text-foreground">
							Acceptable Use
						</Link>
					</p>
				</div>
			</footer>
		</main>
	);
}
