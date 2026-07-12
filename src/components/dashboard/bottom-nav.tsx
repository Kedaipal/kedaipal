import { Link, type LinkProps, useLocation } from "@tanstack/react-router";
import {
	ChevronRight,
	Home,
	LayoutGrid,
	LineChart,
	type LucideIcon,
	Package,
	Printer,
	QrCode,
	Settings,
	ShieldCheck,
	ShoppingBag,
	Siren,
	Store,
	Users,
} from "lucide-react";
import { Dialog as MorePrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

export interface BottomNavProps {
	actionableCount: number;
	// A storeless admin has no seller store to manage — show the admin tabs
	// (Sellers / Billing / WABA) instead of the seller nav.
	adminOnly?: boolean;
	// CRM is plan-locked for this seller (Starter) — mark the Customers row with
	// a "Pro" chip so the upgrade wall behind it is never a surprise.
	crmLocked?: boolean;
	// Insights is plan-locked (Starter) — same treatment on the Insights tab.
	insightsLocked?: boolean;
}

type Tab = {
	to: LinkProps["to"];
	label: string;
	icon: LucideIcon;
	exact?: boolean;
	badge?: number;
	search?: LinkProps["search"];
	pro?: boolean;
};

/**
 * Management surfaces that live under the More sheet rather than holding a
 * primary tab. The bar is reserved for the seller's DAILY loop (home glance,
 * orders, counter, insights); everything here is setup/occasional work, one
 * predictable tap away. New low-frequency surfaces (e.g. Broadcast) join this
 * list instead of fighting for a 7th tab. See docs/app-redesign.md.
 */
const MORE_ROUTES = [
	"/app/products",
	"/app/customers",
	"/app/settings",
	"/app/poster",
] as const;

export function BottomNav({
	actionableCount,
	adminOnly,
	crmLocked,
	insightsLocked,
}: BottomNavProps) {
	const [moreOpen, setMoreOpen] = useState(false);
	const { pathname } = useLocation();
	// The More tab reads active while the sheet is up OR while the seller is on
	// any of its child pages — otherwise landing on /app/products would leave the
	// whole bar unlit and the seller disoriented.
	const onMoreRoute = MORE_ROUTES.some((r) => pathname.startsWith(r));

	// Publish the bar's measured height (mirrors --app-header-h in
	// mobile-header.tsx) so the More panel can float just ABOVE the bar instead
	// of hardcoding a fragile pixel offset. Safe-area padding varies per device.
	const navRef = useRef<HTMLElement>(null);
	useEffect(() => {
		const el = navRef.current;
		if (!el) return;
		const publish = () =>
			document.documentElement.style.setProperty(
				"--app-bottomnav-h",
				`${el.offsetHeight}px`,
			);
		publish();
		const ro = new ResizeObserver(publish);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// The act-as session is held globally (see useActAs), so seller tabs keep the
	// admin inside the vendor store automatically — no per-tab handling needed.
	const tabs: Tab[] = adminOnly
		? [
				{ to: "/app/admin/sellers", label: "Sellers", icon: Store },
				{ to: "/app/admin/billing", label: "Billing", icon: ShieldCheck },
				{ to: "/app/admin/waba", label: "WABA", icon: Siren },
			]
		: [
				{ to: "/app", label: "Home", icon: Home, exact: true },
				{
					to: "/app/orders",
					label: "Orders",
					icon: ShoppingBag,
					badge: actionableCount,
				},
				{ to: "/app/checkout", label: "Counter", icon: QrCode },
				{
					to: "/app/insights",
					label: "Insights",
					icon: LineChart,
					pro: insightsLocked,
				},
			];

	return (
		<nav
			ref={navRef}
			className="sticky bottom-0 border-t border-border bg-background pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden print:hidden"
		>
			<div className="flex items-center justify-around">
				{tabs.map((tab) => (
					<NavTab key={tab.label} tab={tab} />
				))}
				{!adminOnly ? (
					<MoreTab
						open={moreOpen}
						onOpenChange={setMoreOpen}
						active={moreOpen || onMoreRoute}
						crmLocked={crmLocked}
					/>
				) : null}
			</div>
		</nav>
	);
}

function NavTab({ tab }: { tab: Tab }) {
	const { to, label, icon: Icon, exact, badge, search, pro } = tab;
	return (
		<Link
			to={to}
			search={search}
			activeOptions={exact ? { exact: true } : undefined}
			activeProps={{ className: "text-foreground" }}
			inactiveProps={{ className: "text-muted-foreground" }}
			className="relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
		>
			{({ isActive }) => (
				<TabFace
					icon={Icon}
					label={label}
					active={isActive}
					badge={badge}
					pro={pro}
				/>
			)}
		</Link>
	);
}

/** The shared visual body of a tab — used by both the Link tabs and the More
 * button so the two can never drift apart. */
function TabFace({
	icon: Icon,
	label,
	active,
	badge,
	pro,
}: {
	icon: LucideIcon;
	label: string;
	active: boolean;
	badge?: number;
	pro?: boolean;
}) {
	const showBadge = typeof badge === "number" && badge > 0;
	return (
		<>
			{/* Active tab gets a mint pill behind the icon — a text-colour-only
			    active state is easy to miss on the bar. */}
			<span
				className={cn(
					"relative rounded-full px-3.5 py-0.5 transition-colors",
					active && "bg-accent/15",
				)}
			>
				<Icon
					className={cn(
						"size-5",
						active ? "stroke-accent-emphasis" : "stroke-muted-foreground",
					)}
					strokeWidth={active ? 2.5 : 1.75}
				/>
				{showBadge ? (
					<span className="absolute -right-0.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold leading-none text-white">
						{badge > 99 ? "99+" : badge}
					</span>
				) : null}
				{pro ? (
					<span className="absolute -right-3.5 -top-1.5 rounded-full bg-accent/15 px-1 py-px text-[8px] font-bold uppercase leading-none text-accent">
						Pro
					</span>
				) : null}
			</span>
			<span
				className={cn(
					active
						? "font-bold text-foreground"
						: "font-medium text-muted-foreground",
				)}
			>
				{label}
			</span>
		</>
	);
}

/**
 * The More tab + its floating panel. Built on radix Dialog (focus trap, Esc,
 * aria-modal, scrim tap-to-close) — the panel floats just above the bar
 * (anchored via --app-bottomnav-h) so the seller keeps their bearings instead
 * of losing the whole screen to a modal.
 */
function MoreTab({
	open,
	onOpenChange,
	active,
	crmLocked,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	active: boolean;
	crmLocked?: boolean;
}) {
	const close = () => onOpenChange(false);
	return (
		<MorePrimitive.Root open={open} onOpenChange={onOpenChange}>
			<MorePrimitive.Trigger asChild>
				<button
					type="button"
					className={cn(
						"relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]",
						active ? "text-foreground" : "text-muted-foreground",
					)}
				>
					<TabFace icon={LayoutGrid} label="More" active={active} />
				</button>
			</MorePrimitive.Trigger>
			<MorePrimitive.Portal>
				<MorePrimitive.Overlay className="fixed inset-0 z-40 bg-black/30 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
				<MorePrimitive.Content
					aria-describedby={undefined}
					className="fixed inset-x-3 z-50 flex flex-col gap-1 rounded-2xl border border-border bg-popover p-2 shadow-lg outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-2"
					style={{ bottom: "calc(var(--app-bottomnav-h, 4.75rem) + 0.5rem)" }}
				>
					<MorePrimitive.Title className="sr-only">More</MorePrimitive.Title>
					<MoreRow
						to="/app/products"
						icon={Package}
						label="Products"
						sub="Catalog, stock & variants"
						onNavigate={close}
					/>
					<MoreRow
						to="/app/customers"
						icon={Users}
						label="Customers"
						sub="Buyer history & notes"
						pro={crmLocked}
						onNavigate={close}
					/>
					<MoreRow
						to="/app/poster"
						icon={Printer}
						label="Store poster"
						sub="Print your QR poster"
						onNavigate={close}
					/>
					{/* No tab param — mobile lands on the grouped settings index. */}
					<MoreRow
						to="/app/settings"
						icon={Settings}
						label="Settings"
						sub="Store, selling & billing"
						onNavigate={close}
					/>
				</MorePrimitive.Content>
			</MorePrimitive.Portal>
		</MorePrimitive.Root>
	);
}

function MoreRow({
	to,
	icon: Icon,
	label,
	sub,
	pro,
	onNavigate,
}: {
	to: LinkProps["to"];
	icon: LucideIcon;
	label: string;
	sub: string;
	pro?: boolean;
	onNavigate: () => void;
}) {
	return (
		<Link
			to={to}
			onClick={onNavigate}
			className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
				<Icon className="size-5" strokeWidth={1.75} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex items-center gap-1.5 text-sm font-semibold">
					{label}
					{pro ? (
						<span className="rounded-full bg-accent/15 px-1.5 py-px text-[8px] font-bold uppercase leading-none text-accent">
							Pro
						</span>
					) : null}
				</span>
				<span className="truncate text-xs text-muted-foreground">{sub}</span>
			</span>
			<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
		</Link>
	);
}
