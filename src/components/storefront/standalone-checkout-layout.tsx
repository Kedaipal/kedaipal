// The page skeleton shared by every STANDALONE checkout (`z8r3fdhh45`) — the
// ones that don't run on the cart because their product carries its own fixed
// fulfilment moment: a booking request (`?booking=`) and an event RSVP
// (`?rsvp=`).
//
// Lifted out of `booking-checkout-form.tsx`, where it was private, when the
// RSVP flow became the second caller. Two surfaces expressing the same idea
// use the same component — otherwise the app starts looking like two apps.

import type { ReactNode } from "react";
import { usePublishedHeight } from "../../hooks/usePublishedHeight";

/**
 * Sections left, sticky summary + CTA right on desktop; summary above the
 * sections and a FIXED bottom CTA bar on mobile (design-system rule #4 — the
 * route already reserves `--storefront-bar-h`, which the bar publishes by
 * measuring itself).
 */
export function StandaloneCheckoutLayout({
	children,
	summary,
	cta,
	serverError,
}: {
	children: ReactNode;
	summary: ReactNode;
	cta: ReactNode;
	serverError: string | null;
}) {
	const barRef = usePublishedHeight<HTMLDivElement>("--storefront-bar-h");
	const error = serverError ? (
		<p
			role="alert"
			className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			{serverError}
		</p>
	) : null;
	return (
		<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
			<div className="flex flex-1 flex-col gap-4 lg:order-1">
				{/* `gap-3` matches the desktop column: the summary slot may hold
				    more than the receipt card (the basket note below it), and a
				    fragment's children must space the same on both layouts. */}
				<div className="flex flex-col gap-3 lg:hidden">{summary}</div>
				{children}
				{error}
			</div>
			<div className="hidden lg:sticky lg:top-6 lg:order-2 lg:flex lg:w-96 lg:flex-col lg:gap-3">
				{summary}
				{cta}
			</div>
			{/* Mobile: the commitment bar floats fixed above the page footer. */}
			<div
				ref={barRef}
				className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden"
			>
				{cta}
			</div>
		</div>
	);
}

/**
 * The one-line reassurance a standalone checkout owes a buyer who already has
 * a cart going (`z8r3fdhh45`).
 *
 * A booking request and an RSVP deliberately ignore the cart — they are their
 * own order. Silence there reads as "my basket came along too" (or worse,
 * "my basket is gone"), so the page says which it is, in the summary column
 * where the buyer is checking what they're committing to. Renders nothing for
 * the empty cart, which is the common case.
 */
export function BasketKeptNote({
	itemCount,
	storeName,
}: {
	itemCount: number;
	storeName: string;
}) {
	if (itemCount <= 0) return null;
	return (
		<p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
			Your basket ({itemCount} {itemCount === 1 ? "item" : "items"}) is still at{" "}
			{storeName} — it isn&apos;t part of this, and it&apos;s waiting when you
			want to order it.
		</p>
	);
}
