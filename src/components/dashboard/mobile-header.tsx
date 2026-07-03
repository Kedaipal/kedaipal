import { UserButton } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef } from "react";
import type { api } from "../../../convex/_generated/api";
import { TierPill } from "./tier-pill";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

interface MobileHeaderProps {
	// Null when a Kedaipal admin has no store of their own — show admin chrome.
	retailer: Retailer | null;
	// True when an admin is viewing their OWN store — the tier pill reads "Admin".
	adminBadge?: boolean;
}

export function MobileHeader({ retailer, adminBadge }: MobileHeaderProps) {
	// This header is `sticky top-0`, and its height varies (tier pill, store name
	// wrapping). Publish the measured height as `--app-header-h` so any other
	// sticky element on the page (e.g. the counter catalog's product header) can
	// pin itself just BELOW it instead of hardcoding a fragile pixel offset.
	// display:none at `lg` reports 0 — fine, those consumers go static on desktop.
	const headerRef = useRef<HTMLElement>(null);
	useEffect(() => {
		const el = headerRef.current;
		if (!el) return;
		const publish = () =>
			document.documentElement.style.setProperty(
				"--app-header-h",
				`${el.offsetHeight}px`,
			);
		publish();
		const ro = new ResizeObserver(publish);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	return (
		<header
			ref={headerRef}
			className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-3 backdrop-blur lg:hidden"
		>
			<div className="flex min-w-0 flex-1 items-center gap-2.5">
				<img src="/logo.svg" alt="Kedaipal" className="h-8 w-auto shrink-0" />
				{retailer ? (
					<div className="flex min-w-0 flex-col gap-0.5">
						<Link
							to="/app"
							className="truncate font-semibold leading-tight text-sm"
						>
							{retailer.storeName}
						</Link>
						<div className="flex min-w-0 flex-col items-start gap-1">
							<span className="max-w-full truncate font-mono text-xs text-muted-foreground">
								kedaipal.com/{retailer.slug}
							</span>
							<TierPill
								subscription={retailer.subscription}
								foundingRank={retailer.foundingMemberRank}
								admin={adminBadge}
								compact
								className="py-0 text-[9px]"
							/>
						</div>
					</div>
				) : (
					<Link
						to="/app/admin/sellers"
						className="flex min-w-0 flex-col gap-0.5"
					>
						<span className="truncate font-semibold leading-tight text-sm">
							Kedaipal
						</span>
						<span className="truncate font-mono text-xs text-muted-foreground">
							Admin console
						</span>
					</Link>
				)}
			</div>
			<div className="shrink-0">
				<UserButton />
			</div>
		</header>
	);
}
