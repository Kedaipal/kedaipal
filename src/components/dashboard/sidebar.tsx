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
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import type { api } from "../../../convex/_generated/api";
import { useSidebarCollapsed } from "../../hooks/useSidebarCollapsed";
import { cn } from "../../lib/utils";
import { TierPill } from "./tier-pill";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

interface SidebarProps {
	retailer: Retailer;
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
				<Link to="/app" className="flex items-center gap-2.5 min-w-0">
					<img src="/logo.svg" alt="Kedaipal" className="h-8 w-auto shrink-0" />
					{!collapsed ? (
						<div className="flex min-w-0 flex-col">
							<span className="truncate text-sm font-semibold leading-tight">
								{retailer.storeName}
							</span>
							<span className="truncate font-mono text-[11px] text-muted-foreground">
								/{retailer.slug}
							</span>
						</div>
					) : null}
				</Link>
			</div>

			{/* Subscription tier pill — always-visible chrome (links to billing). */}
			{!collapsed ? (
				<div className="border-b border-border px-4 py-2">
					<TierPill
						subscription={retailer.subscription}
						foundingRank={retailer.foundingMemberRank}
					/>
				</div>
			) : null}

			<nav className="flex flex-1 flex-col gap-1 p-2">
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
				{/* Admin-only — server `requireAdmin` is the real gate; this link is
				    just convenience so admins don't type the URL. */}
				{isAdmin ? (
					<>
						<SidebarLink
							to="/app/admin/billing"
							icon={ShieldCheck}
							label="Admin"
							collapsed={collapsed}
						/>
						<SidebarLink
							to="/app/admin/waba"
							icon={Siren}
							label="WABA Safety"
							collapsed={collapsed}
						/>
					</>
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
}

function SidebarLink({
	to,
	icon: Icon,
	label,
	collapsed,
	exact,
	badge,
	search,
}: SidebarLinkProps) {
	const showBadge = typeof badge === "number" && badge > 0;

	return (
		<Link
			to={to}
			search={search}
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
