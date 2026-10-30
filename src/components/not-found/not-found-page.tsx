import { Link, type LinkProps, useLocation } from "@tanstack/react-router";
import {
	Compass,
	Home,
	type LucideIcon,
	SearchX,
	Signpost,
	Store,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	appSectionFor,
	displayPath,
	type NotFoundContext,
	notFoundContext,
} from "../../lib/not-found";
import { Button } from "../ui/button";
import { Wordmark } from "../ui/wordmark";

/**
 * The router's default not-found page — every URL nothing claims lands here
 * instead of TanStack's bare `<p>Not Found</p>`. A designed page, NOT a
 * redirect to the homepage: a redirect hides the typo the visitor needs to
 * see, turns a mistyped store link into a confusing landing on our marketing
 * site, and answers a URL that doesn't exist with a success (a soft 404). The
 * server still responds 404 (TanStack Start reads it off the not-found match;
 * pinned by `not-found-status.test.ts`).
 *
 * Read the pathname, pick the context (`lib/not-found.ts`), render it.
 */
export function RouteNotFound() {
	const { pathname } = useLocation();
	return <NotFoundPage context={notFoundContext(pathname)} path={pathname} />;
}

type Action = { label: string; to: LinkProps["to"]; icon?: LucideIcon };

/**
 * One page, three contexts — the copy and the way out are decided by where
 * the visitor was, the anatomy never changes:
 *
 * - `app`: rendered INSIDE the dashboard shell (fuzzy not-found mode renders
 *   into `/app`'s outlet), so it carries no wordmark of its own and no full
 *   viewport height — the sidebar is already the brand and the frame.
 * - `store` / `site`: a full page with the Kedaipal wordmark, which is the
 *   only thing telling a buyer who followed a dead store link where they are.
 *   `/$slug` and `/$slug/checkout` render `store` themselves when the slug
 *   names nobody, so a store miss reads the same from every door.
 *
 * The path is printed back in mono: seeing `/kek-sayang-bakeri` is how the
 * visitor spots the typo, which is the whole case against redirecting.
 */
export function NotFoundPage({
	context,
	path,
}: {
	context: NotFoundContext;
	/** What to print back: the requested path, or `/<slug>` for a store. */
	path: string;
}) {
	if (context === "app") {
		const section = appSectionFor(path);
		return (
			<div className="flex min-h-[60dvh] flex-col items-center justify-center py-10">
				<NotFoundBody
					icon={Signpost}
					path={path}
					title="This page doesn't exist"
					primary={{ label: "Back to Home", to: "/app", icon: Home }}
					secondary={
						section
							? { label: `Go to ${section.label}`, to: section.to }
							: undefined
					}
				>
					There's nothing at this address in your dashboard — the link may be
					mistyped or out of date.
				</NotFoundBody>
			</div>
		);
	}
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="flex h-16 shrink-0 items-center px-5 lg:h-20 lg:px-8">
				<Link
					to="/"
					aria-label="Kedaipal home"
					className="-mx-2 inline-flex min-h-11 items-center rounded-lg px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<Wordmark aspect="h-7 w-auto" priority />
				</Link>
			</header>
			<main className="flex flex-1 flex-col items-center justify-center px-5 pt-4 pb-20">
				{context === "store" ? (
					<NotFoundBody
						icon={SearchX}
						path={path}
						title="We couldn't find that store"
						primary={{ label: "Browse stores", to: "/stores", icon: Store }}
						secondary={{ label: "Go to Kedaipal", to: "/" }}
						footnote="Got this link from a seller? Ask them to send it again."
					>
						No store on Kedaipal uses this link — it may be mistyped.
					</NotFoundBody>
				) : (
					<NotFoundBody
						icon={Compass}
						path={path}
						title="Page not found"
						primary={{ label: "Go to homepage", to: "/", icon: Home }}
						secondary={{ label: "Browse stores", to: "/stores" }}
					>
						There's no page at this address — the link may be mistyped or out of
						date.
					</NotFoundBody>
				)}
			</main>
		</div>
	);
}

function NotFoundBody({
	icon: Icon,
	title,
	path,
	children,
	primary,
	secondary,
	footnote,
}: {
	icon: LucideIcon;
	title: string;
	path: string;
	children: ReactNode;
	primary: Action;
	secondary?: Action;
	footnote?: string;
}) {
	return (
		<section
			aria-labelledby="not-found-title"
			className="flex w-full max-w-md flex-col items-center text-center"
		>
			{/* Mint, not the error card's grey: a missing page is a wrong turn,
			    not a breakage, and the tile says "here's the way" before the copy
			    does. */}
			<div className="flex size-14 items-center justify-center rounded-2xl bg-accent/12 text-accent-emphasis ring-1 ring-accent/25">
				<Icon className="size-7" aria-hidden />
			</div>
			<p className="mt-5 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
				Error 404
			</p>
			<h1
				id="not-found-title"
				className="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl"
			>
				{title}
			</h1>
			<p className="mt-3 text-sm text-pretty text-muted-foreground sm:text-base">
				{children}
			</p>
			{/* Its own line, not inline in the sentence: a slug is one long
			    hyphenated word, and inline it broke mid-word on a phone. */}
			<p className="mt-4 max-w-full rounded-lg bg-muted px-3 py-1.5 font-mono text-[0.8125rem] text-foreground [overflow-wrap:anywhere]">
				{displayPath(path)}
			</p>
			<div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">
				<ActionButton action={primary} />
				{secondary ? (
					<ActionButton action={secondary} variant="outline" />
				) : null}
			</div>
			{footnote ? (
				<p className="mt-5 text-xs text-muted-foreground">{footnote}</p>
			) : null}
		</section>
	);
}

function ActionButton({
	action,
	variant = "default",
}: {
	action: Action;
	variant?: "default" | "outline";
}) {
	const Icon = action.icon;
	return (
		<Button
			asChild
			variant={variant}
			className="h-11 w-full rounded-xl px-6 sm:w-auto"
		>
			<Link to={action.to}>
				{Icon ? <Icon aria-hidden /> : null}
				{action.label}
			</Link>
		</Button>
	);
}
