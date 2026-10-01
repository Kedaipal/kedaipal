import { useNavigate } from "@tanstack/react-router";
import { Hammer, LogOut, ShieldAlert } from "lucide-react";
import { useActAs } from "../../hooks/useActAs";

/**
 * Persistent, high-contrast "you are operating someone else's store" banner shown
 * across every dashboard screen while a Kedaipal admin is in act-as mode. It is
 * deliberately loud (amber, sticky, full-width) so an admin can never mistake
 * whose store they're editing. "Exit" ends the act-as session and returns to the
 * seller directory. See docs/admin-console.md.
 */
export function ActingAsBanner({
	storeName,
	unclaimed = false,
	pendingOwnerEmail,
}: {
	storeName: string;
	/** Who the pre-built store is waiting for. Present ⇒ the handover is set up
	 * and the banner states it; absent ⇒ nobody can claim the store yet, which
	 * is the one thing the admin still has to do, so the banner says so. It used
	 * to tell every admin to "set a handover email" even when one was set
	 * (2 Oct hands-on test) — an instruction to redo finished work. */
	pendingOwnerEmail?: string;
	/** A pre-built store with no owner yet (docs/prebuilt-stores.md). The
	 * warning inverts: in a live seller's store the point is "this is someone's
	 * real shop, be careful"; in a pre-built one it is "nobody owns this yet —
	 * build freely, and remember it needs handing over". An admin standing in
	 * the wrong one of those two, told the wrong thing, is exactly the mistake
	 * a loud banner exists to prevent. */
	unclaimed?: boolean;
}) {
	const navigate = useNavigate();
	const { setActAs } = useActAs();

	function exit() {
		setActAs(undefined);
		navigate({ to: "/app/admin/sellers" });
	}

	return (
		<div className="sticky top-0 z-30 flex items-center gap-3 border-b border-amber-300 bg-amber-400 px-4 py-2 text-amber-950">
			{unclaimed ? (
				<Hammer className="size-5 shrink-0" aria-hidden />
			) : (
				<ShieldAlert className="size-5 shrink-0" aria-hidden />
			)}
			<p className="min-w-0 flex-1 text-sm font-semibold leading-tight">
				<span className="uppercase tracking-wide">
					{unclaimed ? "Admin · building" : "Admin · acting as"}
				</span>{" "}
				<span className="truncate font-bold">{storeName}</span>
				<span className="hidden font-normal sm:inline">
					{" "}
					{unclaimed
						? pendingOwnerEmail
							? `— nobody owns it yet. ${pendingOwnerEmail} claims it when they sign up.`
							: "— nobody owns this store yet, and no handover email is set, so nobody can claim it."
						: "— every change is made on this seller's store and logged to you."}
				</span>
			</p>
			<button
				type="button"
				onClick={exit}
				className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-950 px-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-900"
			>
				<LogOut className="size-4" aria-hidden />
				Exit
			</button>
		</div>
	);
}
