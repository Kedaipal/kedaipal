import { UserButton } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { TierPill } from "./tier-pill";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

interface MobileHeaderProps {
	retailer: Retailer;
}

export function MobileHeader({ retailer }: MobileHeaderProps) {
	return (
		<header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-3 backdrop-blur lg:hidden">
			<div className="flex min-w-0 flex-1 items-center gap-2.5">
				<img src="/logo.svg" alt="Kedaipal" className="h-8 w-auto shrink-0" />
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
							compact
							className="py-0 text-[9px]"
						/>
					</div>
				</div>
			</div>
			<div className="shrink-0">
				<UserButton />
			</div>
		</header>
	);
}
