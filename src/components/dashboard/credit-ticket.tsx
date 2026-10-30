/**
 * The always-on credits ticket (z8r3fdx34j, Zaki 31 Oct): the profile menu's
 * torn-receipt stub, torn down to its number, so the balance is on every page
 * without opening anything. One component, three sizes:
 *
 *  - `rail`      — the expanded sidebar's top band: the stub's headline and
 *                  its row of dots, with the PLAN pill riding the top tear
 *                  (Zaki, 31 Oct — one object for "your plan and what's
 *                  left on it", ~28px of rail back for the nav);
 *  - `collapsed` — the 68px rail: the figure and the one word it counts;
 *  - `phone`     — beside the plan pill in the phone header, torn left and
 *                  right: "254 left".
 *
 * Healthy is the plain ink; low is amber with a LOW stamp, orders waiting red
 * with a WAITING stamp — the stamp so the state never rests on colour alone.
 * On the rail the stamp sits on the BOTTOM tear, beside the dots it is about:
 * the top tear belongs to the plan, whose label can run long ("FOUNDING #3"
 * + "PRO", "FREE · 12D LEFT") and must never collide with it.
 * The whole ticket opens Settings → Billing, like the stub it's torn from;
 * the reset date and Top up stay in the menu. Words come from `creditStub`
 * (src/lib/credit-stub.ts); this file only draws them.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type CreditStub, STUB_DOTS } from "../../lib/credit-stub";
import { cn } from "../../lib/utils";
import { STUB_DOT, STUB_INK } from "./credit-stub-tones";

export function CreditTicket({
	stub,
	variant,
	plan,
}: {
	stub: CreditStub;
	variant: "rail" | "collapsed" | "phone";
	/** Rail only: the plan pill, laid on the top tear. A sibling of the
	 * ticket's link, never inside it — the pill is a link of its own. */
	plan?: ReactNode;
}) {
	const { ticket } = stub;
	if (!ticket) return null;
	const link = {
		to: "/app/settings" as const,
		search: { tab: "billing" as const },
		"aria-label": ticket.label,
		"data-testid": "credit-ticket",
		"data-variant": variant,
		"data-tone": stub.tone,
	};

	if (variant === "phone") {
		// 18px drawn, 44px to tap: the padding is the target, the negative
		// margin keeps the header's height.
		return (
			<Link
				{...link}
				className={cn(
					"-my-[13px] inline-flex shrink-0 items-center rounded-sm py-[13px] font-mono outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
					STUB_INK[stub.tone],
				)}
			>
				<span className="kp-credit-ticket-side inline-flex h-[18px]">
					<span className="border-y-[1.5px] border-[var(--stub-edge)] px-1.5 text-[11px] leading-[15px] font-bold whitespace-nowrap tabular-nums">
						{ticket.short}
					</span>
				</span>
			</Link>
		);
	}

	if (variant === "collapsed") {
		return (
			<Link
				{...link}
				title={stub.headline}
				className={cn(
					"kp-credit-ticket mx-auto block w-11 rounded-sm font-mono outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
					STUB_INK[stub.tone],
				)}
			>
				<span className="flex flex-col items-center gap-0.5 border-x-[1.5px] border-[var(--stub-edge)] pt-[7px] pb-2 hover:bg-muted/40">
					<span className="text-sm leading-none font-bold tabular-nums">
						{ticket.figure}
					</span>
					<span className="text-[8.5px] leading-none font-bold tracking-[0.12em] uppercase">
						{ticket.word}
					</span>
				</span>
			</Link>
		);
	}

	return (
		<div className="relative">
			{plan ? (
				// The tear runs right up to the pill's own border. The card-coloured
				// backing is the pill's exact shape, so a translucent pill (trial,
				// unclaimed) never shows the teeth through it.
				<div
					data-testid="credit-ticket-plan"
					className="absolute -top-1 left-2.5 z-10 flex max-w-[calc(100%-1.25rem)] rounded-full bg-card"
				>
					{plan}
				</div>
			) : null}
			<Link
				{...link}
				className={cn(
					"kp-credit-ticket block rounded-sm font-mono outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
					STUB_INK[stub.tone],
				)}
			>
				{ticket.stamp ? (
					<span
						aria-hidden
						data-testid="credit-ticket-stamp"
						className="pointer-events-none absolute right-2.5 -bottom-1 z-10 -rotate-[5deg] rounded-[4px] border-[1.5px] border-current bg-card px-1 text-[8px] leading-[13px] font-extrabold tracking-[0.14em] uppercase"
					>
						{ticket.stamp}
					</span>
				) : null}
				<span
					className={cn(
						"flex flex-col items-center gap-[7px] border-x-[1.5px] border-[var(--stub-edge)] px-2 pb-2.5 hover:bg-muted/40",
						plan ? "pt-3" : "pt-[9px]",
					)}
				>
					<span className="text-[15px] leading-tight font-bold tracking-tight whitespace-nowrap tabular-nums">
						{stub.headline}
					</span>
					<span aria-hidden className="flex gap-[3px]">
						{Array.from({ length: STUB_DOTS }, (_, i) => (
							<i
								// biome-ignore lint/suspicious/noArrayIndexKey: fixed perforation, never reordered
								key={i}
								className={cn(
									"block size-[5px] shrink-0 rounded-full",
									i < stub.filled
										? STUB_DOT[stub.tone]
										: "shadow-[inset_0_0_0_1px_var(--stub-edge)]",
								)}
							/>
						))}
					</span>
				</span>
			</Link>
		</div>
	);
}
