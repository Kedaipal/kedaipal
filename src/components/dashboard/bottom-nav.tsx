import { Link, type LinkProps } from "@tanstack/react-router";
import {
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
import { cn } from "../../lib/utils";

interface BottomNavProps {
	actionableCount: number;
	// A storeless admin has no seller store to manage — show the admin tabs
	// (Sellers / Billing / WABA) instead of the seller nav.
	adminOnly?: boolean;
}

type Tab = {
	to: LinkProps["to"];
	label: string;
	icon: LucideIcon;
	exact?: boolean;
	badge?: number;
	search?: LinkProps["search"];
};

export function BottomNav({ actionableCount, adminOnly }: BottomNavProps) {
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
				{ to: "/app/products", label: "Products", icon: Package },
				{
					to: "/app/orders",
					label: "Orders",
					icon: ShoppingBag,
					badge: actionableCount,
				},
				{ to: "/app/checkout", label: "Counter", icon: QrCode },
				{ to: "/app/customers", label: "Customers", icon: Users },
				// No tab param — mobile lands on the grouped settings index.
				{ to: "/app/settings", label: "Settings", icon: Settings },
			];

	return (
		<nav className="sticky bottom-0 border-t border-border bg-background pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden print:hidden">
			<div className="flex items-center justify-around">
				{tabs.map((tab) => (
					<NavTab key={tab.label} tab={tab} />
				))}
			</div>
		</nav>
	);
}

function NavTab({ tab }: { tab: Tab }) {
	const { to, label, icon: Icon, exact, badge, search } = tab;
	const showBadge = typeof badge === "number" && badge > 0;
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
				<>
					{/* Active tab gets a mint pill behind the icon — a text-colour-only
					    active state is easy to miss on a 6-tab bar. */}
					<span
						className={cn(
							"relative rounded-full px-3.5 py-0.5 transition-colors",
							isActive && "bg-accent/15",
						)}
					>
						<Icon
							className={cn(
								"size-5",
								isActive ? "stroke-accent-emphasis" : "stroke-muted-foreground",
							)}
							strokeWidth={isActive ? 2.5 : 1.75}
						/>
						{showBadge ? (
							<span className="absolute -right-0.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold leading-none text-white">
								{badge > 99 ? "99+" : badge}
							</span>
						) : null}
					</span>
					<span
						className={cn(
							isActive
								? "font-bold text-foreground"
								: "font-medium text-muted-foreground",
						)}
					>
						{label}
					</span>
				</>
			)}
		</Link>
	);
}
