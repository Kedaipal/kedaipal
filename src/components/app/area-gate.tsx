import { usePermission } from "../../hooks/usePermission";
import type { PermissionArea } from "../../lib/team-permissions";
import { NeedsAccessNote, OwnerOnlyNote } from "./owner-only-note";

/**
 * Member-aware wrapper for a settings tab body (86exr91r4): when the signed-in
 * TEAMMATE lacks write on `area`, the tab still renders — the standing rule is
 * that surfaces are explained, never vanished — but with the reason on top and
 * every control inside inert via a native disabled <fieldset> (inputs, buttons
 * and toggles all pick it up without threading a prop through each form).
 * Owner/admin render children untouched. The server gate stays the rule; this
 * is the disabled-with-reason layer over it.
 *
 * What a disabled fieldset does NOT inert is links — deliberately left alive.
 * Following one only reaches another dashboard page, which carries its own
 * guard, and a view-only teammate navigating to look at something is the point
 * of giving them view. (Drag handles ARE covered: `SortableList`'s grip is a
 * real <button>, so the order-stage and pickup lists can't be dragged into a
 * state that then refuses to save.)
 *
 * `ownerOnly` is the harder gate for the WhatsApp tab (Arif D2): even a
 * member holding every grant reads it as the owner's surface.
 */
export function AreaGate({
	area,
	ownerOnly = false,
	children,
}: {
	area: PermissionArea;
	ownerOnly?: boolean;
	children: React.ReactNode;
}) {
	const { canRead, canWrite, role } = usePermission(area);
	const restricted = role === "member" && (ownerOnly || !canWrite);
	if (!restricted) return <>{children}</>;
	// No READ at all → the note IS the surface. A disabled body here would fire
	// the tab's own queries, which the server refuses for exactly the same
	// reason, so the teammate would read "you don't have access to billing"
	// above a panel of skeletons that never resolve. An owner-only tab still
	// renders its body: the reader HAS the data, it just isn't theirs to change.
	if (!ownerOnly && !canRead)
		return (
			<div className="pt-2">
				<NeedsAccessNote area={area} level="read" />
			</div>
		);
	return (
		<div className="flex flex-col gap-4 pt-2">
			{ownerOnly ? (
				<OwnerOnlyNote />
			) : (
				<NeedsAccessNote area={area} level="write" />
			)}
			<fieldset disabled className="min-w-0 opacity-75">
				{children}
			</fieldset>
		</div>
	);
}
