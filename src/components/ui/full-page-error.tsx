import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A page-sized "this didn't work" state: an icon, a heading, a sentence or
 * two, and the actions that get the reader out. Every full-page failure renders
 * through it — the router's error boundary (`RouteErrorCard`) and the
 * dashboard's failed store read (`DashboardLoadError`) — so they read as one
 * thing, not two.
 *
 * `detail` is the raw error, shown in dev builds only: it is not actionable for
 * a seller or a shopper, and it can leak internals.
 */
export function FullPageError({
	icon: Icon,
	title,
	children,
	actions,
	footer,
	detail,
}: {
	icon: LucideIcon;
	title: string;
	/** The sentence(s) under the heading. */
	children: ReactNode;
	/** The way(s) out — buttons at least 44px tall. */
	actions: ReactNode;
	/** A quieter line under the actions, e.g. a support link. */
	footer?: ReactNode;
	detail?: string;
}) {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<Icon className="size-6" aria-hidden />
			</div>
			<h1 className="text-2xl font-bold">{title}</h1>
			<p className="text-sm text-muted-foreground">{children}</p>
			<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
				{actions}
			</div>
			{footer}
			{import.meta.env.DEV && detail ? (
				<pre className="mt-4 max-w-full overflow-auto rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-left text-xs text-destructive">
					{detail}
				</pre>
			) : null}
		</main>
	);
}
