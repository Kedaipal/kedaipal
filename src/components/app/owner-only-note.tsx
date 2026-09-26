import { Lock } from "lucide-react";
import { usePermission, useStoreRole } from "../../hooks/usePermission";
import type { PermissionArea } from "../../lib/team-permissions";
import { AREA_COPY, MAX_GRANTABLE } from "../../lib/team-permissions";

/**
 * The member-facing sibling of ViewOnlyNote (86exr91r4): the in-place caption
 * for a surface the signed-in TEAMMATE can see but not use. Same muted, not-red
 * posture and for the same reason — it explains the greyed control below it,
 * it doesn't alarm. Renders nothing for the owner/admin, so a call site is one
 * line. Owner-only surfaces say who CAN act; grant-gated surfaces also say the
 * fix is one ask away — the constraint is surfaced where they'd tap, with the
 * way forward named.
 */
export function OwnerOnlyNote({ className }: { className?: string }) {
	const role = useStoreRole();
	if (role !== "member") return null;
	return (
		<Note className={className}>
			Only the store owner can change this — ask them if something here needs
			updating.
		</Note>
	);
}

/** Grant-gated variant: names the missing access so "ask the owner" is a
 * concrete sentence, not a shrug. `write` = they can look but not touch. */
export function NeedsAccessNote({
	area,
	level = "write",
	className,
}: {
	area: PermissionArea;
	level?: "read" | "write";
	className?: string;
}) {
	const { canRead, canWrite, role } = usePermission(area);
	if (role !== "member") return null;
	if (level === "write" ? canWrite : canRead) return null;
	const label = AREA_COPY[area].label;
	// Some areas are capped at VIEW by the registry (billing: plan changes and
	// auto-renew spend the owner's money). "Ask the owner for edit access"
	// would send a teammate after a grant the Team page cannot give — and it
	// contradicts what the tab itself says once they're inside it.
	const cappedAtRead = MAX_GRANTABLE[area] === "read";
	return (
		<Note className={className}>
			{level === "write" && canRead
				? cappedAtRead
					? `${label[0].toUpperCase()}${label.slice(1)} is view-only for teammates — changes are the owner's to make.`
					: `You can view ${label} but not change it — ask the owner for edit access.`
				: `You don't have access to ${label} — ask the owner to grant it from Settings → Team.`}
		</Note>
	);
}

function Note({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground ${className ?? ""}`}
		>
			<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p className="text-xs leading-relaxed">{children}</p>
		</div>
	);
}
