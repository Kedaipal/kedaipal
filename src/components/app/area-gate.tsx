import type { PermissionArea } from "../../lib/team-permissions";
import { usePermission } from "../../hooks/usePermission";
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
	const { canWrite, role } = usePermission(area);
	const restricted = role === "member" && (ownerOnly || !canWrite);
	if (!restricted) return <>{children}</>;
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
