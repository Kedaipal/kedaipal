import { UserButton } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

interface MobileHeaderProps {
	retailer: Retailer;
}

export function MobileHeader({ retailer }: MobileHeaderProps) {
	return (
		<header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-3 backdrop-blur lg:hidden">
			<div className="flex items-center gap-2.5">
				<img src="/logo.svg" alt="Kedaipal" className="h-8 w-auto" />
				<div className="flex flex-col">
					<Link to="/app" className="font-semibold leading-tight text-sm">
						{retailer.storeName}
					</Link>
					<span className="font-mono text-xs text-muted-foreground">
						kedaipal.com/{retailer.slug}
					</span>
				</div>
			</div>
			<UserButton />
		</header>
	);
}
