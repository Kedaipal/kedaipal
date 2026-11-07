/**
 * A courier's logo in a courier-picker row (z8r3fe11x3), from Delyva's CDN
 * — never a brand asset bundled in the repo (they are the courier's to
 * change). The box is the same size with or without a logo: a load error or
 * a quote with no path falls back to the company's initials in place, so a
 * list never jumps when one image fails, and the card renders the same
 * offline and on a cold cache.
 */

import { useState } from "react";
import { cn } from "../../lib/utils";

/** Two-letter mark for a courier with no logo. */
export function courierInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "??";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

export function CourierLogo({
	logoUrl,
	name,
	className,
}: {
	/** Absolute CDN URL, or undefined when the quote carried no path. */
	logoUrl?: string;
	/** The company name — the initials come from it, and it is the alt. */
	name: string;
	className?: string;
}) {
	// The URL that failed, not a flag: a new URL then gets a fresh try on its
	// own, with no effect to reset a stale failure.
	const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
	const failed = logoUrl !== undefined && failedUrl === logoUrl;
	const box = cn(
		"flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] @md:size-12",
		className,
	);
	if (!logoUrl || failed) {
		return (
			<span
				className={cn(
					box,
					"bg-primary text-xs font-bold text-primary-foreground",
				)}
				role="img"
				aria-label={name}
				data-logo="initials"
			>
				{courierInitials(name)}
			</span>
		);
	}
	return (
		// dark-ok: courier logos are drawn for a white ground — a navy plate
		// behind J&T's red or Ninja Van's black mark reads as a smudge.
		<span className={cn(box, "border border-border bg-white p-1")}>
			<img
				src={logoUrl}
				alt={name}
				loading="lazy"
				decoding="async"
				className="size-full object-contain"
				onError={() => setFailedUrl(logoUrl)}
			/>
		</span>
	);
}
