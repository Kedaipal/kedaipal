import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useStoreLock } from "../../hooks/useStoreLock";

/**
 * The in-place "this screen can't act right now" note (z8r3fdeub2).
 *
 * The app-shell banner already says a lapsed store is view-only, but a seller
 * who scrolled past it and is standing over an order needs the constraint
 * WHERE they are about to tap — the standing rule is that a constraint is
 * surfaced, never enforced silently. Renders nothing when the store is
 * writable, so a call site is one line with no conditional of its own.
 */
export function ViewOnlyNote({ className }: { className?: string }) {
	const { readOnly, reason } = useStoreLock();
	if (!readOnly) return null;
	return (
		<div
			className={`flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 ${className ?? ""}`}
		>
			<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p className="text-xs leading-relaxed">
				{reason}{" "}
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="font-semibold underline underline-offset-2"
				>
					Go to Billing
				</Link>
			</p>
		</div>
	);
}
