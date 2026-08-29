import { useNavigate } from "@tanstack/react-router";
import { LogOut, ShieldAlert } from "lucide-react";
import { useActAs } from "../../hooks/useActAs";

/**
 * Persistent, high-contrast "you are operating someone else's store" banner shown
 * across every dashboard screen while a Kedaipal admin is in act-as mode. It is
 * deliberately loud (amber, sticky, full-width) so an admin can never mistake
 * whose store they're editing. "Exit" ends the act-as session and returns to the
 * seller directory. See docs/admin-console.md.
 */
export function ActingAsBanner({ storeName }: { storeName: string }) {
	const navigate = useNavigate();
	const { setActAs } = useActAs();

	function exit() {
		setActAs(undefined);
		navigate({ to: "/app/admin/sellers" });
	}

	return (
		<div
			// dark-ok: `bg-amber-400` is a saturated attention fill chosen for its own
			// hue, so it — and the `text-amber-950` sitting on it — read the same
			// whichever theme the page is in. Only the hairline is page-relative:
			// amber-300 becomes a bright seam once what's below the banner goes dark.
			className="sticky top-0 z-30 flex items-center gap-3 border-b border-amber-300 bg-amber-400 px-4 py-2 text-amber-950 dark:border-amber-600"
		>
			<ShieldAlert className="size-5 shrink-0" aria-hidden />
			<p className="min-w-0 flex-1 text-sm font-semibold leading-tight">
				<span className="uppercase tracking-wide">Admin · acting as</span>{" "}
				<span className="truncate font-bold">{storeName}</span>
				<span className="hidden font-normal sm:inline">
					{" "}
					— every change is made on this seller's store and logged to you.
				</span>
			</p>
			<button
				type="button"
				onClick={exit}
				// dark-ok: an inverse plate cut from the banner's own amber ramp. It
				// only ever sits on the fixed amber-400 fill, never on the page, so its
				// ground and its `text-amber-50` are theme-invariant by construction.
				className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-950 px-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-900"
			>
				<LogOut className="size-4" aria-hidden />
				Exit
			</button>
		</div>
	);
}
