import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";

/** Store logo when set, else the store initial on the brand navy tile. */
export function StoreAvatar({
	retailer,
	className,
}: {
	retailer: { logoUrl?: string; storeName: string };
	className?: string;
}) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground font-heading text-[15px] font-extrabold text-background",
				className,
			)}
			aria-hidden="true"
		>
			<AppImage
				src={retailer.logoUrl}
				alt=""
				aspect="size-full"
				fallback={
					<span className="flex size-full items-center justify-center">
						{retailer.storeName.charAt(0).toUpperCase()}
					</span>
				}
			/>
		</span>
	);
}

/** Greeting keyed to the seller's local clock (MYT in practice). */
export function timeGreeting(now: Date = new Date()): string {
	const h = now.getHours();
	if (h < 12) return "Good morning";
	if (h < 18) return "Good afternoon";
	return "Good evening";
}

export function formatTodayLong(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-MY", {
		weekday: "long",
		day: "numeric",
		month: "long",
	}).format(now);
}

/**
 * The greeting (z8r3fdrgzj) — the date above, the store's own name highlighted
 * in mint below. The name carries the highlight because the page belongs to the
 * seller's store, not to Kedaipal.
 */
export function HomeGreeting({
	retailer,
}: {
	retailer: { logoUrl?: string; storeName: string };
}) {
	return (
		<header className="flex items-center gap-3">
			<StoreAvatar
				retailer={retailer}
				className="size-12 rounded-2xl text-lg lg:size-14 lg:text-xl"
			/>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-[13px] font-medium text-muted-foreground">
					{formatTodayLong()}
				</span>
				{/* Wraps rather than truncates: at narrow widths this was clipping
				    the store's OWN name ("Good evening, Kuih L…"), which is the one
				    word on the page that belongs to the seller. */}
				<h1 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight lg:text-2xl">
					{timeGreeting()},{" "}
					<span className="kp-highlight">{retailer.storeName}</span>
				</h1>
			</div>
		</header>
	);
}
