import { UserButton, useUser } from "@clerk/tanstack-react-start";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
	ChevronLeft,
	ChevronRight,
	Home,
	LineChart,
	type LucideIcon,
	Package,
	QrCode,
	Settings,
	ShieldCheck,
	ShoppingBag,
	Siren,
	Store,
	Users,
} from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import type { api } from "../../../convex/_generated/api";
import { AppVersionRow } from "./app-version-row";
import { WhatsNewNavItem } from "./whats-new";
import { useActAs } from "../../hooks/useActAs";
import { useSidebarCollapsed } from "../../hooks/useSidebarCollapsed";
import { hasFeature } from "../../lib/subscription";
import { cn } from "../../lib/utils";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { TierPill } from "./tier-pill";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

interface SidebarProps {
	// Null when a Kedaipal admin has no store of their own — the dashboard chrome
	// still renders (admin links + user menu), just without the seller sections.
	retailer: Retailer | null;
	// Orders the seller hasn't looked at yet — the inbox's "New" bucket. See the
	// note on BottomNavProps: a badge is a notification, not a pipeline gauge.
	newOrdersCount: number;
	isAdmin?: boolean;
	// True when an admin is viewing their OWN store — the tier pill reads "Admin"
	// instead of the store's trial/plan state. False while acting-as a seller.
	adminBadge?: boolean;
}

export function Sidebar({
	retailer,
	newOrdersCount,
	isAdmin,
	adminBadge,
}: SidebarProps) {
	const [collapsed, setCollapsed] = useSidebarCollapsed();
	const { user } = useUser();
	const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;
	const userName =
		user?.fullName ||
		user?.firstName ||
		user?.username ||
		userEmail?.split("@")[0] ||
		null;

	// The act-as session is held globally (see useActAs), so seller nav links need
	// no special handling — they stay in the vendor store automatically. The ADMIN
	// group links end the session (leaving the vendor-operation view).
	const { setActAs } = useActAs();
	const exitActAs = () => setActAs(undefined);

	return (
		<aside
			className={cn(
				// `relative` anchors the collapse control, which straddles the right
				// border rather than sitting in the footer (86eyqgxv9).
				"sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card lg:flex print:hidden",
				collapsed ? "w-[68px]" : "w-60",
			)}
			aria-label="Dashboard navigation"
		>

			<div
				className={cn(
					"flex h-16 items-center border-b border-border px-3",
					collapsed ? "justify-center" : "gap-2.5 px-4",
				)}
			>
				<Link
					to={retailer ? "/app" : "/app/admin/sellers"}
					onClick={retailer ? undefined : exitActAs}
					className="flex items-center gap-2.5 min-w-0"
				>
					<AppImage
						src="/logo.svg"
						alt="Kedaipal"
						aspect="h-8 w-auto shrink-0"
						fill={false}
						priority
					/>
					{!collapsed ? (
						<div className="flex min-w-0 flex-col">
							<span className="truncate text-sm font-semibold leading-tight">
								{retailer ? retailer.storeName : "Kedaipal"}
							</span>
							<span className="truncate font-mono text-[11px] text-muted-foreground">
								{retailer ? `/${retailer.slug}` : "Admin console"}
							</span>
						</div>
					) : null}
				</Link>
			</div>

			{/* Subscription tier pill — always-visible chrome (links to billing).
			    Hidden for a storeless admin (no subscription to show). Reads "Admin"
			    on an admin's own store. */}
			{retailer && !collapsed ? (
				<div className="border-b border-border px-4 py-2">
					<TierPill
						subscription={retailer.subscription}
						foundingRank={retailer.foundingMemberRank}
						admin={adminBadge}
					/>
				</div>
			) : null}

			<nav className="flex flex-1 flex-col gap-1 p-2">
				{/* Seller nav — only when there's a store to operate (own or act-as).
				    The act-as session holds globally, so these need no per-link handling. */}
				{retailer ? (
					<>
						<SidebarLink
							to="/app"
							exact
							icon={Home}
							label="Home"
							collapsed={collapsed}
						/>
						<SidebarLink
							to="/app/products"
							icon={Package}
							label="Products"
							collapsed={collapsed}
						/>
						<SidebarLink
							to="/app/orders"
							icon={ShoppingBag}
							label="Orders"
							collapsed={collapsed}
							badge={newOrdersCount}
							// Land on exactly what the badge counted — but only while
							// there IS something new, so the link stays plain navigation
							// the rest of the time. Mirrors the bottom nav.
							search={
								newOrdersCount > 0 ? { bucket: "new" as const } : undefined
							}
						/>
						<SidebarLink
							to="/app/checkout"
							icon={QrCode}
							label="Counter"
							collapsed={collapsed}
						/>
						<SidebarLink
							to="/app/customers"
							icon={Users}
							label="Customers"
							collapsed={collapsed}
							// CRM is Pro+ — mark it in nav so the gate is never a surprise
							// (the route shows the upgrade wall). Act-as admins see through.
							pro={
								!retailer.actingAsAdmin &&
								!hasFeature(retailer.subscription, "crm")
							}
						/>
						<SidebarLink
							to="/app/insights"
							icon={LineChart}
							label="Insights"
							collapsed={collapsed}
							// Insights is Pro+ — mark it in nav so the gate is never a
							// surprise (the route shows the teaser). Act-as admins see through.
							pro={
								!retailer.actingAsAdmin &&
								!hasFeature(retailer.subscription, "insights")
							}
						/>
						<SidebarLink
							to="/app/settings"
							search={{ tab: "store" }}
							icon={Settings}
							label="Settings"
							collapsed={collapsed}
						/>
					</>
				) : null}
				{/* Admin group — visually separated + labelled so it's unmistakable from
				    the vendor nav while acting-as. Server `requireAdmin` is the real gate;
				    these links just save typing the URL. They END the act-as session
				    (leaving the vendor-operation view). */}
				{isAdmin ? (
					<div
						className={cn(
							"mt-2 flex flex-col gap-1 border-t border-border pt-3",
							retailer ? "" : "border-t-0 pt-0",
						)}
					>
						{!collapsed ? (
							<span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
								Admin
							</span>
						) : null}
						<SidebarLink
							to="/app/admin/sellers"
							onClick={exitActAs}
							icon={Store}
							label="All sellers"
							collapsed={collapsed}
						/>
						<SidebarLink
							to="/app/admin/billing"
							onClick={exitActAs}
							icon={ShieldCheck}
							label="Billing"
							collapsed={collapsed}
						/>
						<SidebarLink
							to="/app/admin/waba"
							onClick={exitActAs}
							icon={Siren}
							label="WABA Safety"
							collapsed={collapsed}
						/>
					</div>
				) : null}
			</nav>

			{/* `relative` so the collapse control can pin to this block's top-right
			    CORNER — the point where the footer's top border meets the sidebar's
			    right border. Anchoring to the footer rather than the aside means it
			    sits on that junction in both states and never drifts as the nav
			    list grows. */}
			<div className="relative flex flex-col gap-1 border-t border-border p-2">
				{/* Centred on the junction: `top-0 right-0` is that corner, and the
				    two 50% translates put the button's middle exactly on it.
				    Always visible rather than hover-revealed — this sidebar renders
				    from `lg` up, which includes iPad landscape at 1024px where there
				    is no hover at all. */}
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					className="absolute top-0 right-0 z-20 flex size-6 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:border-accent/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
				>
					{collapsed ? (
						<ChevronRight className="size-3.5" strokeWidth={2.5} />
					) : (
						<ChevronLeft className="size-3.5" strokeWidth={2.5} />
					)}
				</button>
				<div
					className={cn(
						"flex items-center gap-2 rounded-lg px-2 py-2",
						collapsed && "justify-center px-0",
					)}
				>
					<UserButton />
					{!collapsed && (userName || userEmail) ? (
						<div className="flex min-w-0 flex-col">
							{userName ? (
								<span className="truncate text-xs font-medium">{userName}</span>
							) : null}
							{userEmail ? (
								<span className="truncate text-[10px] text-muted-foreground">
									{userEmail}
								</span>
							) : null}
						</div>
					) : null}
				</div>
				{/* One meta line, not three stacked rows: "what changed" on the
				    left, "what am I running" on the right — the two questions this
				    corner of the chrome exists to answer (86eyqgxv9).
				    Collapsed, neither fits, so it degrades to the sparkle alone with
				    its unseen dot; the version drops out because nobody reads a
				    version off a 68px rail and expanding is one click. */}
				{collapsed ? (
					<div className="flex justify-center">
						<WhatsNewNavItem variant="icon" />
					</div>
				) : (
					<div className="flex items-center justify-between gap-2 px-2 py-0.5">
						<WhatsNewNavItem variant="meta" />
						<AppVersionRow compact />
					</div>
				)}
			</div>
		</aside>
	);
}

interface SidebarLinkProps {
	to: LinkProps["to"];
	icon: LucideIcon;
	label: string;
	collapsed: boolean;
	exact?: boolean;
	badge?: number;
	search?: LinkProps["search"];
	onClick?: MouseEventHandler<HTMLAnchorElement>;
	/** Feature is plan-locked for this seller — show the "Pro" chip. */
	pro?: boolean;
}

function SidebarLink({
	to,
	icon: Icon,
	label,
	collapsed,
	exact,
	badge,
	search,
	onClick,
	pro,
}: SidebarLinkProps) {
	const showBadge = typeof badge === "number" && badge > 0;

	return (
		<Link
			to={to}
			search={search}
			onClick={onClick}
			// includeSearch defaults to TRUE, so a link carrying `search` (Orders'
			// ?bucket=new, Settings' ?tab=store) would only read active on that
			// exact search — dark on other buckets/tabs and on child routes.
			// Active state is about WHERE the seller is, never which filter/tab.
			activeOptions={{ exact: exact ?? false, includeSearch: false }}
			title={collapsed ? label : undefined}
			className={cn(
				"group relative flex h-10 items-center rounded-lg text-sm transition-colors",
				collapsed ? "justify-center" : "gap-3 px-3",
			)}
			activeProps={{
				className: "bg-accent/12 text-foreground font-semibold",
			}}
			inactiveProps={{
				className:
					"text-muted-foreground hover:bg-accent/10 hover:text-foreground",
			}}
		>
			{({ isActive }) => (
				<>
					{isActive && !collapsed ? (
						<span
							aria-hidden
							className="absolute left-0 top-1/2 h-7 w-1.5 -translate-y-1/2 rounded-r-full bg-accent"
						/>
					) : null}
					<span className="relative shrink-0">
						<Icon
							className={cn(
								"size-5",
								isActive ? "stroke-accent" : "stroke-current",
							)}
							strokeWidth={isActive ? 2.5 : 1.75}
						/>
						{showBadge && collapsed ? (
							<span className="absolute -right-1 -top-1 flex h-2 w-2 rounded-full bg-orange-500 ring-2 ring-card" />
						) : null}
					</span>
					{!collapsed ? (
						<>
							<span className="flex-1">{label}</span>
							{pro ? <ProBadge /> : null}
							{showBadge ? <BadgePill count={badge} /> : null}
						</>
					) : null}
				</>
			)}
		</Link>
	);
}

function BadgePill({ count }: { count: number }): ReactNode {
	return (
		<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold leading-none text-white">
			{count > 99 ? "99+" : count}
		</span>
	);
}
