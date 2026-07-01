import { UserButton, useUser } from "@clerk/tanstack-react-start";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
	ChevronLeft,
	ChevronRight,
	Home,
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
import { useActAs } from "../../hooks/useActAs";
import { useSidebarCollapsed } from "../../hooks/useSidebarCollapsed";
import { cn } from "../../lib/utils";
import { TierPill } from "./tier-pill";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

interface SidebarProps {
	// Null when a Kedaipal admin has no store of their own — the dashboard chrome
	// still renders (admin links + user menu), just without the seller sections.
	retailer: Retailer | null;
	actionableCount: number;
	isAdmin?: boolean;
}

export function Sidebar({ retailer, actionableCount, isAdmin }: SidebarProps) {
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
				"sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card lg:flex",
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
					<img src="/logo.svg" alt="Kedaipal" className="h-8 w-auto shrink-0" />
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
			    Hidden for a storeless admin (no subscription to show). */}
			{retailer && !collapsed ? (
				<div className="border-b border-border px-4 py-2">
					<TierPill
						subscription={retailer.subscription}
						foundingRank={retailer.foundingMemberRank}
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
							badge={actionableCount}
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

			<div className="flex flex-col gap-1 border-t border-border p-2">
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
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					className={cn(
						"flex h-9 items-center rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground",
						collapsed ? "justify-center" : "gap-2 px-3",
					)}
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
				>
					{collapsed ? (
						<ChevronRight className="size-4" />
					) : (
						<>
							<ChevronLeft className="size-4 shrink-0" />
							<span>Collapse</span>
						</>
					)}
				</button>
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
}: SidebarLinkProps) {
	const showBadge = typeof badge === "number" && badge > 0;

	return (
		<Link
			to={to}
			search={search}
			onClick={onClick}
			activeOptions={exact ? { exact: true } : undefined}
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
