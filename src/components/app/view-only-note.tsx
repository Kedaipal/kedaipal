import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useStoreRole } from "../../hooks/usePermission";
import { useStoreLock } from "../../hooks/useStoreLock";

/**
 * The in-place "this screen can't act right now" note (z8r3fdeub2).
 *
 * The app-shell banner already says a lapsed store is view-only, but a seller
 * who scrolled past it and is standing over an order needs the constraint
 * WHERE they are about to tap — the standing rule is that a constraint is
 * surfaced, never enforced silently. Renders nothing when the store is
 * writable, so a call site is one line with no conditional of its own.
 *
 * **Deliberately MUTED, not red.** Rendered against the banner it would be the
 * second red block in one viewport — the same alarm twice. The banner is the
 * alarm; this is the explanation for the greyed-out control directly below it,
 * so it reads as a caption rather than competing (compared side by side at
 * desktop and 375px before it shipped). Semantic tokens throughout, so dark
 * mode needs no second set of colours.
 */
export function ViewOnlyNote({ className }: { className?: string }) {
	const { readOnly, reason } = useStoreLock();
	// Billing is the owner's — a member is told who to ask, not sent to a tab
	// they can't open (86exr91r4).
	const isMember = useStoreRole() === "member";
	if (!readOnly) return null;
	return (
		<div
			className={`flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground ${className ?? ""}`}
		>
			<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p className="text-xs leading-relaxed">
				{reason}
				{isMember ? null : " "}
				{isMember ? null : (
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						className="font-semibold text-foreground underline underline-offset-2"
					>
						Go to Billing
					</Link>
				)}
			</p>
		</div>
	);
}
