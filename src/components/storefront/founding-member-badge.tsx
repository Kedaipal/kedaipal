import { useState } from "react";
import { AppImage } from "../ui/app-image";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "../ui/popover";

/**
 * Public storefront badge shown on kedaipal.com/<slug> for a Founding Member.
 * Reads the denormalized `isFoundingMember` flag (public-safe). Subscription
 * state is never exposed to shoppers. See docs/manual-subscription.md.
 *
 * Visual: Kris's "Plain" badge artwork (speech-bubble emblem with a mint star).
 * Two colour variants ship so the emblem always contrasts with the storefront
 * header — the navy badge is the default for light backgrounds, and the mint
 * badge swaps in under `.dark`. The emblem rides WITHOUT a text label since the
 * UI-polish pass (z8r3fdegb5): the badge is a button whose popover names it
 * ("Founding Member #N") and says who issued it — a hover tooltip alone
 * wouldn't surface on mobile, but a tap-to-open popover does, and the trigger's
 * aria-label carries the meaning for screen readers. See ClickUp 86exrhptc.
 *
 * `onCover`: when the header sits on a seller's cover image, the badge uses the
 * mint emblem (which reads on the dark scrim regardless of theme) so it can't
 * wash out on a dark cover — the bug the theme-only variants left behind. See
 * StorefrontHeader + ClickUp 86eycww5z.
 *
 * `size`: 28px in the store-home hero, 18px beside the store name in the
 * compact subpage app bar.
 */
export function FoundingMemberBadge({
	rank,
	onCover = false,
	size = "default",
}: {
	rank?: number;
	onCover?: boolean;
	size?: "default" | "sm";
}) {
	const [open, setOpen] = useState(false);
	const label = `Founding Member${rank ? ` #${rank}` : ""}`;
	const emblem = size === "sm" ? "h-[18px] w-auto" : "h-7 w-auto";
	// Only a real hover pointer opens on enter — on touch, pointerenter fires
	// right before the tap's click, and the click would toggle it straight
	// back closed.
	const hoverOpen = (pointerType: string, next: boolean) => {
		if (pointerType === "mouse") setOpen(next);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					// The emblem is 18–28px; the negative-margin padding grows the
					// hit area toward 44px without shifting the row's layout.
					className="-m-1.5 inline-flex shrink-0 rounded-full p-1.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
					aria-label={`${label} — what's this?`}
					onPointerEnter={(e) => hoverOpen(e.pointerType, true)}
					onPointerLeave={(e) => hoverOpen(e.pointerType, false)}
				>
					{onCover ? (
						// Mint emblem reads against the header scrim regardless of theme.
						<AppImage
							src="/img/badges/founding-badge-mint.png"
							alt=""
							aspect={emblem}
							fill={false}
							priority
						/>
					) : (
						<>
							{/* Navy on light, mint on dark — always reads against the header. */}
							<AppImage
								src="/img/badges/founding-badge-navy.png"
								alt=""
								aspect={emblem}
								className="dark:hidden"
								fill={false}
								priority
							/>
							<AppImage
								src="/img/badges/founding-badge-mint.png"
								alt=""
								aspect={emblem}
								className="hidden dark:block"
								fill={false}
								priority
							/>
						</>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-64" align="start">
				<PopoverHeader>
					<PopoverTitle>{label}</PopoverTitle>
					<PopoverDescription>
						One of Kedaipal's first sellers. This badge is issued by Kedaipal,
						not self-declared.
					</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	);
}
