import { UserButton, useUser } from "@clerk/tanstack-react-start";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
	ChevronLeft,
	GalleryHorizontalEnd,
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
	Tag,
	Ticket,
	Users,
} from "lucide-react";
import {
	type MouseEventHandler,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import type { api } from "../../../convex/_generated/api";
import { useActAs } from "../../hooks/useActAs";
import { usePermission } from "../../hooks/usePermission";
import { useSidebarCollapsed } from "../../hooks/useSidebarCollapsed";
import { hasFeature } from "../../lib/subscription";
import { cn } from "../../lib/utils";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { AppVersionRow } from "./app-version-row";
import { TierPill } from "./tier-pill";
import { WhatsNewNavItem } from "./whats-new";

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
	// Team members (86exr91r4): hide sections this MEMBER can't read — the
	// nav shows their world; deep links still explain via RouteAreaGuard.
	const ordersPerm = usePermission("orders");
	const productsPerm = usePermission("products");
	const customersPerm = usePermission("customers");
	const vouchersPerm = usePermission("vouchers");
	const insightsPerm = usePermission("insights");

	const [collapsed, setCollapsed] = useSidebarCollapsed();
	// The collapsed preference arrives from localStorage in an effect, so the
	// first client paint may re-apply it. Transitions switch on one frame
	// later, or every full page load would play the collapse as a 200ms slide
	// instead of restoring it instantly.
	const [motionReady, setMotionReady] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() => setMotionReady(true));
		return () => cancelAnimationFrame(id);
	}, []);
	// One shared transition spec so the rail, labels, pill and chevron move as
	// one gesture. Gated behind prefers-reduced-motion (design-system rule).
	const motion = motionReady
		? "transition-[width,max-width,max-height,padding,opacity,transform,color,background-color] duration-200 motion-reduce:transition-none"
		: "";
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
				"sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card lg:flex print:hidden",
				collapsed ? "w-[68px]" : "w-60",
				motion,
			)}
			aria-label="Dashboard navigation"
		>
			<div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
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
					<div
						aria-hidden={collapsed || undefined}
						className={cn(
							"flex min-w-0 flex-col overflow-hidden",
							collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
							motion,
						)}
					>
						<span className="truncate text-sm font-semibold leading-tight">
							{retailer ? retailer.storeName : "Kedaipal"}
						</span>
						<span className="truncate font-mono text-[11px] text-muted-foreground">
							{retailer ? `/${retailer.slug}` : "Admin console"}
						</span>
					</div>
				</Link>
			</div>

			{/* Subscription tier pill — always-visible chrome (links to billing).
			    Hidden for a storeless admin (no subscription to show). Reads "Admin"
			    on an admin's own store. */}
			{retailer ? (
				// `inert`, not just hidden: the pill is a link (billing / admin
				// console), so a clipped, invisible copy would still be a Tab stop
				// with no visible focus — `inert` takes it out of the focus order
				// AND the accessibility tree in one attribute (PR #362 review).
				<div
					inert={collapsed}
					className={cn(
						"shrink-0 overflow-hidden border-b border-border px-4",
						collapsed ? "max-h-0 py-0 opacity-0" : "max-h-12 py-2 opacity-100",
						motion,
					)}
				>
					<TierPill
						subscription={retailer.subscription}
						foundingRank={retailer.foundingMemberRank}
						admin={adminBadge}
						unclaimed={retailer?.unclaimed === true}
					/>
				</div>
			) : null}

			{/* The ONE part of the rail that gives when the window is short: the
			    header, tier pill and footer are `shrink-0`, the link list takes
			    the squeeze and scrolls. Without this an admin's 14 links on a
			    laptop-height window flex-shrank everything else — the
			    overflow-hidden pill wrapper collapsed to a sliver and the footer
			    was pushed off-screen. `*:shrink-0` because each link is
			    overflow-hidden too, so it would squash to nothing rather than
			    scroll. The 68px rail hides its scrollbar: a classic (always-shown)
			    one would take ~15px and push every icon off-centre, and the
			    half-cut last row already says there's more. */}
			<nav
				className={cn(
					"flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2 *:shrink-0",
					collapsed ? "[scrollbar-width:none]" : "[scrollbar-width:thin]",
				)}
			>
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
							motion={motion}
						/>
						{productsPerm.canRead ? (
							<SidebarLink
								to="/app/products"
								icon={Package}
								label="Products"
								collapsed={collapsed}
								motion={motion}
							/>
						) : null}
						{/* Promotions (z8r3fducfd) — bulk sale prices. Right after
						    Products because it IS catalogue pricing (the `products`
						    area), and its own entry rather than a tab of Vouchers: a
						    sale price changes a product before checkout, a voucher is a
						    code redeemed at it. SETTING one is Pro, so the badge marks
						    the page — but the route is never walled: a downgraded store
						    must still be able to see and end the sales it set. */}
						{productsPerm.canRead ? (
							<SidebarLink
								to="/app/promotions"
								icon={Tag}
								label="Promotions"
								collapsed={collapsed}
								motion={motion}
								pro={
									!retailer.actingAsAdmin &&
									!hasFeature(retailer.subscription, "promo")
								}
							/>
						) : null}
						{ordersPerm.canRead ? (
							<SidebarLink
								to="/app/orders"
								icon={ShoppingBag}
								label="Orders"
								collapsed={collapsed}
								motion={motion}
								badge={newOrdersCount}
								// Land on exactly what the badge counted — but only while
								// there IS something new, so the link stays plain navigation
								// the rest of the time. Mirrors the bottom nav.
								search={
									newOrdersCount > 0 ? { bucket: ["new" as const] } : undefined
								}
							/>
						) : null}
						{ordersPerm.canWrite ? (
							<SidebarLink
								to="/app/checkout"
								icon={QrCode}
								label="Counter"
								collapsed={collapsed}
								motion={motion}
							/>
						) : null}
						{customersPerm.canRead ? (
							<SidebarLink
								to="/app/customers"
								icon={Users}
								label="Customers"
								collapsed={collapsed}
								motion={motion}
								// CRM is Pro+ — mark it in nav so the gate is never a surprise
								// (the route shows the upgrade wall). Act-as admins see through.
								pro={
									!retailer.actingAsAdmin &&
									!hasFeature(retailer.subscription, "crm")
								}
							/>
						) : null}
						{vouchersPerm.canRead ? (
							<SidebarLink
								to="/app/vouchers"
								icon={Ticket}
								label="Vouchers"
								collapsed={collapsed}
								motion={motion}
								// ISSUING is the Pro capability, so the badge marks the page
								// the way Customers and Insights do — but the route itself is
								// never walled: a downgraded store keeps the codes it already
								// sent, and has to be able to void them.
								pro={
									!retailer.actingAsAdmin &&
									!hasFeature(retailer.subscription, "vouchers")
								}
							/>
						) : null}
						{insightsPerm.canRead ? (
							<SidebarLink
								to="/app/insights"
								icon={LineChart}
								label="Insights"
								collapsed={collapsed}
								motion={motion}
								// Insights is Pro+ — mark it in nav so the gate is never a
								// surprise (the route shows the teaser). Act-as admins see through.
								pro={
									!retailer.actingAsAdmin &&
									!hasFeature(retailer.subscription, "insights")
								}
							/>
						) : null}
						<SidebarLink
							to="/app/settings"
							search={{ tab: "store" }}
							icon={Settings}
							label="Settings"
							collapsed={collapsed}
							motion={motion}
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
						<span
							aria-hidden={collapsed || undefined}
							className={cn(
								"overflow-hidden px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
								collapsed
									? "max-h-0 pb-0 opacity-0"
									: "max-h-5 pb-1 opacity-100",
								motion,
							)}
						>
							Admin
						</span>
						<SidebarLink
							to="/app/admin/sellers"
							onClick={exitActAs}
							icon={Store}
							label="All sellers"
							collapsed={collapsed}
							motion={motion}
						/>
						<SidebarLink
							to="/app/admin/billing"
							onClick={exitActAs}
							icon={ShieldCheck}
							label="Billing"
							collapsed={collapsed}
							motion={motion}
						/>
						<SidebarLink
							to="/app/admin/showcases"
							onClick={exitActAs}
							icon={GalleryHorizontalEnd}
							label="Showcases"
							collapsed={collapsed}
							motion={motion}
						/>
						<SidebarLink
							to="/app/admin/waba"
							onClick={exitActAs}
							icon={Siren}
							label="WABA Safety"
							collapsed={collapsed}
							motion={motion}
						/>
					</div>
				) : null}
			</nav>

			{/* `relative` so the collapse control can pin to this block's top-right
			    CORNER — the point where the footer's top border meets the sidebar's
			    right border. Anchoring to the footer rather than the aside means it
			    sits on that junction in both states and never drifts as the nav
			    list grows. */}
			<div className="relative flex shrink-0 flex-col gap-1 border-t border-border p-2">
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
					<ChevronLeft
						className={cn("size-3.5", collapsed && "rotate-180", motion)}
						strokeWidth={2.5}
					/>
				</button>
				<div
					className={cn(
						"flex items-center gap-2 rounded-lg py-2 pr-2",
						collapsed ? "pl-3" : "pl-2",
						motion,
					)}
				>
					<UserButton />
					{userName || userEmail ? (
						<div
							aria-hidden={collapsed || undefined}
							className={cn(
								"flex min-w-0 flex-col overflow-hidden",
								collapsed ? "max-w-0 opacity-0" : "max-w-44 opacity-100",
								motion,
							)}
						>
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
				{/* Both forms stay mounted and cross-fade, so this row glides with
				    the rest of the rail instead of snapping at the end. Whichever
				    form is hidden is `inert` — never a second, invisible button. */}
				<div className="flex items-center justify-between px-2 py-0.5">
					<div className="grid">
						<div
							inert={collapsed}
							className={cn(
								"overflow-hidden [grid-area:1/1]",
								collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
								motion,
							)}
						>
							<WhatsNewNavItem variant="meta" />
						</div>
						<div
							inert={!collapsed}
							className={cn(
								"flex [grid-area:1/1]",
								collapsed ? "opacity-100" : "opacity-0",
								motion,
							)}
						>
							<WhatsNewNavItem variant="icon" />
						</div>
					</div>
					<div
						inert={collapsed}
						className={cn(
							"overflow-hidden",
							collapsed ? "max-w-0 opacity-0" : "max-w-28 opacity-100",
							motion,
						)}
					>
						<AppVersionRow compact />
					</div>
				</div>
			</div>
		</aside>
	);
}

interface SidebarLinkProps {
	to: LinkProps["to"];
	icon: LucideIcon;
	label: string;
	collapsed: boolean;
	/** Shared transition classes from the parent — empty until motion is armed. */
	motion: string;
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
	motion,
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
				"group relative flex h-10 items-center gap-3 overflow-hidden rounded-lg text-sm",
				collapsed ? "pl-4" : "px-3",
				motion || "transition-colors",
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
					<span
						aria-hidden={collapsed || undefined}
						className={cn(
							"flex min-w-0 flex-1 items-center gap-3 whitespace-nowrap",
							collapsed ? "opacity-0" : "opacity-100",
							motion,
						)}
					>
						<span className="flex-1">{label}</span>
						{pro ? <ProBadge /> : null}
						{showBadge ? <BadgePill count={badge} /> : null}
					</span>
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
