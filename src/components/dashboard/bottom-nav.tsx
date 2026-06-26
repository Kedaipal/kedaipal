import { Link } from "@tanstack/react-router";
import {
	Home,
	Package,
	QrCode,
	Settings,
	ShoppingBag,
	Users,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface BottomNavProps {
	actionableCount: number;
}

export function BottomNav({ actionableCount }: BottomNavProps) {
	return (
		<nav className="sticky bottom-0 border-t border-border bg-background pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
			<div className="flex items-center justify-around">
				<Link
					to="/app"
					activeOptions={{ exact: true }}
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
				>
					{({ isActive }) => (
						<>
							<Home
								className={cn(
									"size-5",
									isActive ? "stroke-accent" : "stroke-muted-foreground",
								)}
								strokeWidth={isActive ? 2.5 : 1.75}
							/>
							<span
								className={cn(
									"font-medium",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
							>
								Home
							</span>
						</>
					)}
				</Link>
				<Link
					to="/app/products"
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
				>
					{({ isActive }) => (
						<>
							<Package
								className={cn(
									"size-5",
									isActive ? "stroke-accent" : "stroke-muted-foreground",
								)}
								strokeWidth={isActive ? 2.5 : 1.75}
							/>
							<span
								className={cn(
									"font-medium",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
							>
								Products
							</span>
						</>
					)}
				</Link>
				<Link
					to="/app/orders"
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					className="relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
				>
					{({ isActive }) => (
						<>
							<span className="relative">
								<ShoppingBag
									className={cn(
										"size-5",
										isActive ? "stroke-accent" : "stroke-muted-foreground",
									)}
									strokeWidth={isActive ? 2.5 : 1.75}
								/>
								{actionableCount > 0 ? (
									<span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold leading-none text-white">
										{actionableCount > 99 ? "99+" : actionableCount}
									</span>
								) : null}
							</span>
							<span
								className={cn(
									"font-medium",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
							>
								Orders
							</span>
						</>
					)}
				</Link>
				<Link
					to="/app/checkout"
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
				>
					{({ isActive }) => (
						<>
							<QrCode
								className={cn(
									"size-5",
									isActive ? "stroke-accent" : "stroke-muted-foreground",
								)}
								strokeWidth={isActive ? 2.5 : 1.75}
							/>
							<span
								className={cn(
									"font-medium",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
							>
								Counter
							</span>
						</>
					)}
				</Link>
				<Link
					to="/app/customers"
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
				>
					{({ isActive }) => (
						<>
							<Users
								className={cn(
									"size-5",
									isActive ? "stroke-accent" : "stroke-muted-foreground",
								)}
								strokeWidth={isActive ? 2.5 : 1.75}
							/>
							<span
								className={cn(
									"font-medium",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
							>
								Customers
							</span>
						</>
					)}
				</Link>
				<Link
					to="/app/settings"
					search={{ tab: "store" }}
					activeProps={{ className: "text-foreground" }}
					inactiveProps={{ className: "text-muted-foreground" }}
					className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]"
				>
					{({ isActive }) => (
						<>
							<Settings
								className={cn(
									"size-5",
									isActive ? "stroke-accent" : "stroke-muted-foreground",
								)}
								strokeWidth={isActive ? 2.5 : 1.75}
							/>
							<span
								className={cn(
									"font-medium",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
							>
								Settings
							</span>
						</>
					)}
				</Link>
			</div>
		</nav>
	);
}
