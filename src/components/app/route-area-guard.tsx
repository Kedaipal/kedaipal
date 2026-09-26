import { Link, useLocation } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { usePermission } from "../../hooks/usePermission";
import type { PermissionArea } from "../../lib/team-permissions";
import { AREA_COPY } from "../../lib/team-permissions";

/**
 * ONE route-level permission guard for the whole dashboard (86exr91r4),
 * wrapped around the shell's <Outlet/> instead of repeated in every route
 * file — the path→area map below is the routing mirror of the server's
 * per-function requirements, and a new dashboard section adds one line here.
 *
 * Members without READ on a section's area get a full-page explanation with
 * the way forward (ask the owner), never a raw server "Forbidden" — the nav
 * already hides these sections, so this catches deep links and typed URLs.
 * Owner/admin (and every non-member) pass through untouched.
 */
const AREA_BY_PREFIX: ReadonlyArray<{
	prefix: string;
	area: PermissionArea;
	/** What the SECTION needs, not merely what it displays. Defaults to
	 * "read" — a section that only shows things. */
	level?: "read" | "write";
}> = [
	{ prefix: "/app/orders", area: "orders" },
	// The counter TAKES an order — there is nothing here for a view-only
	// teammate to do, every button on it is a write the server refuses, and
	// the nav already hides it at read (bottom-nav asks for write). Guarding
	// it at READ let a typed URL walk into a checkout that could never finish.
	{ prefix: "/app/checkout", area: "orders", level: "write" },
	{ prefix: "/app/products", area: "products" },
	{ prefix: "/app/customers", area: "customers" },
	{ prefix: "/app/insights", area: "insights" },
	// /app/settings stays open — its tabs carry their own AreaGate, and Team
	// (where a member leaves) must always be reachable. /app/poster rides the
	// storefront link, harmless to every role. /app/admin has requireAdmin.
];

export function RouteAreaGuard({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation();
	const match = AREA_BY_PREFIX.find(
		(entry) =>
			pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
	);
	// Hooks can't be conditional — resolve the permission for the matched area
	// (or a harmless default) and only then decide.
	const { canRead, canWrite, role } = usePermission(match?.area ?? "orders");
	const needsWrite = match?.level === "write";
	const allowed = needsWrite ? canWrite : canRead;
	if (!match || role !== "member" || allowed) return <>{children}</>;

	const label = AREA_COPY[match.area].label;
	return (
		<div className="flex min-h-[50vh] items-center justify-center">
			<div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center">
				<span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<Lock className="size-5" />
				</span>
				<h1 className="font-heading text-lg font-extrabold">
					{needsWrite && canRead
						? `You can view ${label}, but not add to them`
						: `You don't have access to ${label}`}
				</h1>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{needsWrite && canRead
						? "This page takes new orders, so it needs edit access. Ask the store owner for it from Settings → Team — changes apply the next time you load the page."
						: `The store owner controls what each teammate can open. Ask them to grant you ${label} from Settings → Team — changes apply the next time you load the page.`}
				</p>
				<Link
					to="/app"
					className="tap-target mt-1 inline-flex items-center justify-center rounded-lg border border-border px-4 font-semibold transition-colors hover:bg-muted"
				>
					Back to Home
				</Link>
			</div>
		</div>
	);
}
