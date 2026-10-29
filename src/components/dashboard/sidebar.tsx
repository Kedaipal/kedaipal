import { UserButton, useUser } from "@clerk/tanstack-react-start";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
	ArrowUpRight,
	ChevronLeft,
	Clapperboard,
	GalleryHorizontalEnd,
	Home,
	LineChart,
	type LucideIcon,
	Package,
	QrCode,
	Settings,
	ShieldCheck,
	ShoppingBag,
	Signpost,
	Siren,
	Store,
	Tag,
	Ticket,
	Truck,
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
import { BLOG_VIDEOS_URL } from "../../lib/admin-sites";
import { hasFeature } from "../../lib/subscription";
import { cn } from "../../lib/utils";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { ThemeToggle } from "../ui/theme-toggle";
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
	// Holds the "videos" admin area (an admin, or a blog editor who is not one) —
	// shows the "Blog videos" shortcut out to admin.kedaipal.com/videos.
	blogVideos?: boolean;
	// True when an admin is viewing their OWN store — the tier pill reads "Admin"
	// instead of the store's trial/plan state. False while acting-as a seller.
	adminBadge?: boolean;
}

export function Sidebar({
	retailer,
	newOrdersCount,
	isAdmin,
	blogVideos,
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

	// 216px expanded (z8r3fdwc19; was 240). Every nav label is one short word,
	// so the old width was mostly empty row. The binding constraint is the foot's
	// meta line — "What's new" + dot beside the version pill — which needs 178px
	// for a two-digit release (`2026.12.12`): 208px clipped it by a pixel, 216
	// leaves ~6px. Store names truncate a little sooner; the full name is the
	// storefront's job, not the rail's. Fixed, not resizable: a ten-link nav
	// has two useful widths, and collapse already gives the second one.
	return (
		<aside
			className={cn(
				"sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card lg:flex print:hidden",
				collapsed ? "w-[68px]" : "w-54",
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
			    one would take ~15px and push every icon off-centre. "There's
			    more" is the scroll shadow instead, in both states — a macOS
			    overlay scrollbar is invisible until used, and a half-cut row
			    says nothing when the cut lands on a gap (PR #372 review). */}
			<nav
				className={cn(
					"flex min-h-0 flex-1 scroll-shadow-y flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2 *:shrink-0",
					collapsed ? "scrollbar-none" : "[scrollbar-width:thin]",
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
						{/* Deliveries (86eye9xd4, 6A) sits right under Orders: it is
						    the same orders, followed out the door. */}
						{ordersPerm.canRead ? (
							<SidebarLink
								to="/app/deliveries"
								icon={Truck}
								label="Deliveries"
								collapsed={collapsed}
								motion={motion}
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
				    (leaving the vendor-operation view).
				    A blog editor who is NOT an admin sees the group with only the
				    "Blog videos" row: the in-app console stays admin-only. */}
				{isAdmin || blogVideos ? (
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
						{isAdmin ? (
							<>
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
								{/* Kedaipal's own spend, beside Billing (money in) and never
								    inside it (86eye3eyp). */}
								<SidebarLink
									to="/app/admin/acquisition"
									onClick={exitActAs}
									icon={Signpost}
									label="Acquisition"
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
							</>
						) : null}
						{/* Last: it is the one row that LEAVES the app (its own site on
						    admin.kedaipal.com, signed in with this same account). */}
						{blogVideos ? (
							<SidebarExternalLink
								href={BLOG_VIDEOS_URL}
								icon={Clapperboard}
								label="Blog videos"
								hint="Opens admin.kedaipal.com"
								collapsed={collapsed}
								motion={motion}
							/>
						) : null}
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
				{/* Quick theme flip, the same control the mobile header carries —
				    icon only, like every other theme control in the app (z8r3fdwc19;
				    the "Dark mode" word beside it was dropped). The three-way picker
				    (match device) stays in Settings → App → Appearance.

				    It has TWO homes, cross-faded like the What's-new row below, with
				    the hidden one `inert`:
				    - expanded: the right end of the profile row. A lone icon on a row
				      of its own reads as an unlabelled nav item; beside the profile
				      is where a utility control belongs (ClickUp, Linear).
				    - collapsed: its own row above the avatar, because the 68px rail
				      has no room beside it.
				    ONE ICON COLUMN in the collapsed form: every glyph in the rail
				    centres 26px in. The 44px disc would centre its glyph 8px further
				    right under the row's padding (it shipped that way once — Zaki,
				    21 Oct 2026), so `-ml-2` pulls it back onto the column. */}
				<div
					inert={!collapsed}
					className={cn(
						"flex items-center overflow-hidden rounded-lg pr-2 pl-3",
						collapsed ? "max-h-14 py-1 opacity-100" : "max-h-0 py-0 opacity-0",
						motion,
					)}
				>
					<ThemeToggle variant="ghost" className="-ml-2" />
				</div>
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
								"flex min-w-0 flex-1 flex-col overflow-hidden",
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
					{/* The expanded home. `-my-2` keeps the row at the avatar's
					    height, and `-mr-4` lands the glyph's right edge on the version
					    pill's below — one right-hand edge for the foot — while giving
					    the name every pixel it can; `p-0.5` inside the clip
					    leaves room for the disc's focus ring. */}
					<div
						inert={collapsed}
						className={cn(
							"-my-2 ml-auto shrink-0 overflow-hidden",
							// Collapsed, the margin and padding go too: at zero width they
							// would still push the rail 20px wider than its 68px.
							collapsed
								? "mr-0 max-w-0 p-0 opacity-0"
								: "-mr-4 max-w-12 p-0.5 opacity-100",
							motion,
						)}
					>
						<ThemeToggle variant="ghost" />
					</div>
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
					{/* `items-center`: both forms share one cell and the icon form is the
					    taller, so without it the text form sat at the cell's top edge
					    while the version pill sat on the row's centre line. */}
					<div className="grid items-center">
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

/**
 * A sidebar row that leaves the app (a sibling site on admin.kedaipal.com). Same
 * look as `SidebarLink`, never "active", and an ↗ so it doesn't pass for an
 * in-app page.
 */
function SidebarExternalLink({
	href,
	icon: Icon,
	label,
	hint,
	collapsed,
	motion,
}: {
	href: string;
	icon: LucideIcon;
	label: string;
	hint: string;
	collapsed: boolean;
	motion: string;
}) {
	return (
		<a
			href={href}
			title={collapsed ? `${label} — ${hint}` : hint}
			className={cn(
				"group relative flex h-10 items-center gap-3 overflow-hidden rounded-lg text-sm text-muted-foreground hover:bg-accent/10 hover:text-foreground",
				collapsed ? "pl-4" : "px-3",
				motion || "transition-colors",
			)}
		>
			<span className="relative shrink-0">
				<Icon className="size-5 stroke-current" strokeWidth={1.75} />
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
				<ArrowUpRight className="size-4 shrink-0" strokeWidth={1.75} />
			</span>
		</a>
	);
}

function BadgePill({ count }: { count: number }): ReactNode {
	return (
		<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold leading-none text-white">
			{count > 99 ? "99+" : count}
		</span>
	);
}
