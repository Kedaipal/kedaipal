import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Check,
	ChevronRight,
	Clock,
	Copy,
	Link2,
	Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	CLAIM_MAX_SENDS,
	claimResendState,
	claimResendVisible,
} from "../../../convex/lib/orderClaims";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { MASK_PII } from "../../lib/analytics-privacy";
import { formatCountdown, formatClaimCountdown } from "../../lib/countdown";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { storefrontOrigin } from "../../lib/storefront-url";

/**
 * Seller side of claim links (86eyq0epn, docs/claim-links.md) — the
 * "Waiting on buyers" panel on the counter landing: live countdown per open
 * claim, Resend (cooldown-gated, disabled-with-reason), Cancel, Copy link
 * (the always-available fallback when a WhatsApp send is blocked), plus
 * recently completed / expired outcomes.
 *
 * The send CONTROLS are not here. They used to live in a modal
 * (`SendClaimDialog`), which the counter panel redesign retired: the payment
 * window and origin chips belong beside the cart they describe, not behind a
 * dialog the seller has to open to discover them. They now render inline in
 * `app.checkout.tsx` under the "Send to buyer" mode.
 */

/** The buyer-facing claim URL — same origin rules as the storefront link. */
export function claimUrl(token: string): string {
	return `${storefrontOrigin()}/claim/${token}`;
}

async function copyClaimLink(token: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(claimUrl(token));
		toast.success("Link copied — paste it into any chat");
	} catch {
		toast.error("Couldn't copy — long-press the link to copy it manually");
	}
}

// ---------------------------------------------------------------------------
// Claims panel — "Waiting on buyers" on the counter landing
// ---------------------------------------------------------------------------

/** Shared 1s tick for the whole panel (one interval, however many rows). */
function useNow(enabled: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [enabled]);
	return now;
}

export function ClaimsPanel({
	onResume,
}: {
	/** Open the claim's counter session (expired rows → "Send a fresh link"). */
	onResume: (sessionId: string) => void;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const claims = useQuery(
		convexQuery(api.orderClaims.listClaims, { retailerId: actAsRetailerId }),
	).data;
	const resendClaim = useMutation(api.orderClaims.resendClaim);
	const cancelClaim = useMutation(api.orderClaims.cancelClaim);
	const openClaims = useMemo(
		() => (claims ?? []).filter((c) => c.status === "open"),
		[claims],
	);
	const settledClaims = useMemo(
		() => (claims ?? []).filter((c) => c.status !== "open"),
		[claims],
	);
	const now = useNow(openClaims.length > 0);

	// Nothing sent yet: render nothing — the feature announces itself from the
	// build screen's "Send to buyer" button, not an empty panel.
	if (!claims || claims.length === 0) return null;

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="font-heading text-base font-bold">Waiting on buyers</h2>
				{openClaims.length > 0 ? (
					<span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent-emphasis">
						{openClaims.length} open
					</span>
				) : null}
			</div>

			<div className="flex flex-col gap-3">
				{openClaims.map((claim) => {
					const remaining = claim.expiresAt - now;
					// The row is judged live so it flips to the settled style the
					// second the clock runs out, before the server sweep.
					const stillOpen = remaining > 0;
					const resend = claimResendState(claim, now);
					// Sending isn't set up on this deployment: a Resend would fail the
					// same way, so Copy link carries the flow.
					const sendUnavailable = claim.lastSendOutcome === "unavailable";
					const optedOut = claim.lastSendOutcome === "opted_out";
					// Resend is a RETRY, not a nudge — it only appears when the last
					// send didn't reach the buyer AND a retry can plausibly work. See
					// claimResendVisible for why (every send is billed).
					const showResend =
						stillOpen && claimResendVisible(claim.lastSendOutcome);
					// Short labels on purpose: three controls share one row on a phone,
					// and the amber note directly below already names WhatsApp and the
					// remedy — the button doesn't have to carry the whole sentence.
					const resendLabel = !resend.canResend
						? resend.reason === "max_sends"
							? `Sent ${CLAIM_MAX_SENDS}×`
							: `Retry in ${formatCountdown((resend.nextAt ?? now) - now)}`
						: "Retry";
					return (
						<div
							key={claim.claimId}
							className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
						>
							{/* One row on desktop, two on mobile. The actions carry
							    `w-full sm:w-auto`, so they wrap under the name on a phone
							    (where full-width taps are right) and collapse to their
							    natural width beside it on a wide screen — instead of three
							    buttons stretched across 900px (Zaki, 27 Aug). */}
							<div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
								{/* Tappable: an open claim has no order yet, so the useful
								    destination is the counter session it was sent from —
								    where the seller can see the cart and re-send (which
								    supersedes this claim) if something was wrong. */}
								<button
									type="button"
									onClick={() => onResume(claim.sessionId)}
									className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg p-1 text-left transition-colors hover:bg-muted/60"
									aria-label={`Open ${claim.buyerName}'s checkout`}
								>
									<span className="min-w-0 flex-1">
										<span
											className="block truncate text-sm font-semibold"
											{...MASK_PII}
										>
											{claim.buyerName}
										</span>
										<span className="block text-xs text-muted-foreground">
											{claim.itemCount} item{claim.itemCount === 1 ? "" : "s"} ·{" "}
											{formatPrice(claim.itemsTotal, claim.currency)}
										</span>
									</span>
									<ChevronRight
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden
									/>
								</button>
								<span
									className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${
										stillOpen
											? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
											: "bg-muted text-muted-foreground"
									}`}
								>
									<Clock className="size-3" aria-hidden />
									{stillOpen ? formatClaimCountdown(remaining) : "Expired"}
								</span>
								<div className="flex w-full shrink-0 gap-2 sm:w-auto">
									<button
										type="button"
										onClick={() => copyClaimLink(claim.token)}
										className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted sm:flex-none"
									>
										<Copy className="size-3.5" aria-hidden />
										Copy link
									</button>
									{showResend ? (
										<button
											type="button"
											disabled={!resend.canResend}
											title={
												!resend.canResend
													? resend.reason === "max_sends"
														? `Sent ${CLAIM_MAX_SENDS} times already — copy the link and message them directly`
														: "A moment between retries keeps this from spamming the buyer"
													: undefined
											}
											onClick={async () => {
												try {
													await resendClaim({ claimId: claim.claimId });
													toast.success("Link re-sent on WhatsApp");
												} catch (err) {
													toast.error(convexErrorMessage(err));
												}
											}}
											className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
										>
											<Send className="size-3.5" aria-hidden />
											{resendLabel}
										</button>
									) : null}
									<button
										type="button"
										onClick={async () => {
											try {
												await cancelClaim({ claimId: claim.claimId });
												toast.success("Link released");
											} catch (err) {
												toast.error(convexErrorMessage(err));
											}
										}}
										className="tap-target flex shrink-0 items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
									>
										Cancel
									</button>
								</div>
							</div>
							{sendUnavailable ? (
								<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
									WhatsApp sending isn&apos;t switched on yet — copy the link
									and send it to them yourself. The link and its countdown
									work normally.
								</p>
							) : optedOut ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
									This buyer has opted out of WhatsApp messages from Kedaipal,
									so we couldn&apos;t send it. They can reply{" "}
									<span className="font-semibold">START</span> to our number to
									turn them back on — or just copy the link across yourself.
									The link and its countdown work normally.
								</p>
							) : claim.lastSendOutcome === "blocked" ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
									WhatsApp sending is paused right now (a sending limit or a
									safety pause on our side) — copy the link and send it
									yourself. The link and its countdown work normally.
								</p>
							) : claim.lastSendOutcome === "failed" ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
									The WhatsApp message couldn&apos;t be delivered — copy the
									link and send it to them yourself. The link (and its
									deadline) still works.
								</p>
							) : null}
						</div>
					);
				})}

				{settledClaims.map((claim) => (
					<div
						key={claim.claimId}
						className={`flex items-center gap-3 rounded-2xl border p-4 ${
							claim.status === "completed"
								? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
								: "border-dashed border-border bg-card"
						}`}
					>
						{claim.status === "completed" ? (
							<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
								<Check className="size-4" aria-hidden />
							</span>
						) : (
							<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
								<Link2 className="size-4" aria-hidden />
							</span>
						)}
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold" {...MASK_PII}>
								{claim.buyerName}
							</p>
							<p className="text-xs text-muted-foreground">
								{claim.status === "completed"
									? `Completed${claim.orderShortId ? ` · ${claim.orderShortId}` : ""}`
									: claim.status === "expired"
										? "Expired · nothing charged"
										: "Cancelled"}
								{" · "}
								{formatPrice(claim.itemsTotal, claim.currency)}
							</p>
						</div>
						{claim.status === "completed" && claim.orderShortId ? (
							<Link
								to="/app/orders/$shortId"
								params={{ shortId: claim.orderShortId }}
								className="text-xs font-semibold text-accent-emphasis hover:underline"
							>
								View order
							</Link>
						) : claim.status === "expired" ? (
							<button
								type="button"
								onClick={() => onResume(claim.sessionId)}
								className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
							>
								Send a fresh link
							</button>
						) : null}
					</div>
				))}
			</div>
		</section>
	);
}
