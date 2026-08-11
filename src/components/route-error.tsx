import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "./ui/button";

/**
 * The router's default error boundary (86eyheqzv). Before this existed, any
 * route-level throw — including a transient SSR loader failure — fell through
 * to TanStack's built-in fallback: an unstyled "Something went wrong!" with a
 * Show-Error button that dumps the raw error message. Buyers arriving from a
 * WhatsApp link read that as the store being broken.
 *
 * Errors here are overwhelmingly transient (an upstream blip during a loader
 * run), so the card leads with the one action that fixes those: try again,
 * which re-runs the failed loaders via router.invalidate(). No raw error text
 * in production — the message is not actionable for a shopper and can leak
 * internals; dev builds show it inline for debugging.
 */
export function RouteErrorCard({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<WifiOff className="size-6" aria-hidden />
			</div>
			<h1 className="text-2xl font-bold">Something went wrong</h1>
			<p className="text-sm text-muted-foreground">
				This is usually temporary — your order and cart are safe. Give it
				another try, and if it keeps happening, wait a minute and reload.
			</p>
			<Button
				type="button"
				className="mt-2 h-11 rounded-xl px-6"
				onClick={() => {
					// Order matters: clear the boundary first, then re-run the failed
					// loaders — invalidate alone would re-render into the stale error.
					reset();
					void router.invalidate();
				}}
			>
				<RefreshCw className="size-4" aria-hidden />
				Try again
			</Button>
			{import.meta.env.DEV ? (
				<pre className="mt-4 max-w-full overflow-auto rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-left text-xs text-destructive">
					{error.message}
				</pre>
			) : null}
		</main>
	);
}
