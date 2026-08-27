import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Check, Clock, Copy, Link2, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { sourceLabel } from "../../../convex/lib/attribution";
import {
	CLAIM_SOURCE_CHOICES,
	CLAIM_WINDOW_CHOICES_MINUTES,
	claimResendState,
	DEFAULT_CLAIM_WINDOW_MINUTES,
	describeClaimWindow,
} from "../../../convex/lib/orderClaims";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { MASK_PII } from "../../lib/analytics-privacy";
import { formatCountdown, formatClaimCountdown } from "../../lib/countdown";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { storefrontOrigin } from "../../lib/storefront-url";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/**
 * Seller side of claim links (86eyq0epn, docs/claim-links.md):
 *  - SendClaimDialog — the "Send to buyer to complete" confirm on the counter
 *    build screen: pick the payment window (chips; remembered as the store
 *    default), see what the buyer fills in, send.
 *  - ClaimsPanel — "Waiting on buyers" on the counter landing: live countdown
 *    per open claim, Resend (cooldown-gated, disabled-with-reason), Cancel,
 *    Copy link (the always-available fallback when the WhatsApp send fails),
 *    plus recently completed / expired outcomes.
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

interface SendClaimItem {
	variantId: Id<"productVariants">;
	quantity: number;
	unitPrice?: number;
}

export function SendClaimDialog({
	open,
	onOpenChange,
	sessionId,
	buyerName,
	itemCount,
	itemsTotal,
	currency,
	defaultWindowMinutes,
	defaultSource,
	items,
	onSent,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessionId: Id<"counterCheckoutSessions">;
	buyerName: string | undefined;
	itemCount: number;
	itemsTotal: number;
	currency: string;
	/** The store's remembered default (retailers.claimLinkWindowMinutes). */
	defaultWindowMinutes: number | undefined;
	/** The store's remembered origin (retailers.claimLinkSource). */
	defaultSource: string | undefined;
	items: SendClaimItem[];
	/** Called after a successful send — the caller returns to the list. */
	onSent: () => void;
}) {
	const sendClaim = useMutation(api.orderClaims.sendClaim);
	const [windowMinutes, setWindowMinutes] = useState(
		defaultWindowMinutes ?? DEFAULT_CLAIM_WINDOW_MINUTES,
	);
	const [source, setSource] = useState<string | undefined>(defaultSource);
	const [sending, setSending] = useState(false);
	// Re-seed the chip whenever the dialog opens (the remembered default may
	// have changed since mount).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-open only.
	useEffect(() => {
		if (open) {
			setWindowMinutes(defaultWindowMinutes ?? DEFAULT_CLAIM_WINDOW_MINUTES);
			setSource(defaultSource);
		}
	}, [open]);

	const who = buyerName ?? "the buyer";

	async function handleSend() {
		setSending(true);
		try {
			const result = await sendClaim({
				sessionId,
				items,
				windowMinutes,
				attributionSource: source,
			});
			toast.success(
				`WhatsApp link sent to ${who} — you'll see the order the moment they complete it.`,
			);
			// Belt-and-braces: put the link on the clipboard path one tap away by
			// showing a follow-up toast with a copy action (the WABA send outcome
			// lands on the claims list either way).
			void result;
			onSent();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSending(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Send to <span {...MASK_PII}>{who}</span> to complete
					</DialogTitle>
					<DialogDescription>
						{itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
						{formatPrice(itemsTotal, currency)} — price locked at what you
						keyed.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						They fill in
					</p>
					<div className="flex flex-wrap gap-1.5">
						{["Delivery or pickup", "Date & time", "Payment"].map((chip) => (
							<span
								key={chip}
								className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium"
							>
								{chip}
							</span>
						))}
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<p className="text-sm font-semibold">Give them how long?</p>
					<div className="flex gap-2">
						{CLAIM_WINDOW_CHOICES_MINUTES.map((minutes) => {
							const active = windowMinutes === minutes;
							return (
								<button
									key={minutes}
									type="button"
									aria-pressed={active}
									onClick={() => setWindowMinutes(minutes)}
									className={`tap-target flex-1 rounded-xl border-2 px-2 py-2.5 text-sm font-semibold transition-colors ${
										active
											? "border-accent bg-accent/10 text-accent-emphasis"
											: "border-border bg-card text-muted-foreground hover:border-accent/40"
									}`}
								>
									{describeClaimWindow(minutes)
										.replace(" minutes", " min")
										.replace(" hours", " hours")}
								</button>
							);
						})}
					</div>
					<p className="text-xs leading-relaxed text-muted-foreground">
						This is how long they have to <em>complete</em> the order — then
						at least 15 minutes to pay (nobody can open a banking app in one
						minute). An order still unpaid when time&apos;s up is cancelled
						automatically, so your stock comes back. Resending never resets
						the clock.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<p className="text-sm font-semibold">Where&apos;s this order from?</p>
					<div className="flex flex-wrap gap-2">
						{CLAIM_SOURCE_CHOICES.map((tag) => {
							const active = source === tag;
							return (
								<button
									key={tag}
									type="button"
									aria-pressed={active}
									onClick={() => setSource(active ? undefined : tag)}
									className={`tap-target rounded-full border-2 px-3.5 py-1.5 text-xs font-semibold transition-colors ${
										active
											? "border-accent bg-accent/10 text-accent-emphasis"
											: "border-border bg-card text-muted-foreground hover:border-accent/40"
									}`}
								>
									{sourceLabel(tag)}
								</button>
							);
						})}
					</div>
					<p className="text-xs leading-relaxed text-muted-foreground">
						Counts this sale against that channel in Insights. Tap again to
						clear it. We&apos;ll remember both choices for your next send —
						set them once at the top of a live.
					</p>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={sending}
					>
						Back
					</Button>
					<Button type="button" onClick={handleSend} disabled={sending}>
						<Send className="size-4" aria-hidden />
						{sending ? "Sending…" : "Send WhatsApp link"}
					</Button>
				</DialogFooter>
				<p className="text-center text-[11px] text-muted-foreground">
					If WhatsApp can&apos;t deliver it, you&apos;ll get a copyable link on
					the counter page to send yourself.
				</p>
			</DialogContent>
		</Dialog>
	);
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
					const resendLabel = !resend.canResend
						? resend.reason === "max_sends"
							? "Sent 3× — message them directly"
							: `Resend in ${formatCountdown((resend.nextAt ?? now) - now)}`
						: claim.lastSendOutcome === "failed"
							? "Retry WhatsApp"
							: "Resend";
					return (
						<div
							key={claim.claimId}
							className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
						>
							<div className="flex items-center gap-3">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-semibold" {...MASK_PII}>
										{claim.buyerName}
									</p>
									<p className="text-xs text-muted-foreground">
										{claim.itemCount} item{claim.itemCount === 1 ? "" : "s"} ·{" "}
										{formatPrice(claim.itemsTotal, claim.currency)}
									</p>
								</div>
								<span
									className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${
										stillOpen
											? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
											: "bg-muted text-muted-foreground"
									}`}
								>
									<Clock className="size-3" aria-hidden />
									{stillOpen ? formatClaimCountdown(remaining) : "Expired"}
								</span>
							</div>
							{claim.lastSendOutcome === "failed" ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
									The WhatsApp message couldn&apos;t be delivered — copy the
									link and send it to them yourself. The link (and its
									deadline) still works.
								</p>
							) : null}
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => copyClaimLink(claim.token)}
									className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
								>
									<Copy className="size-3.5" aria-hidden />
									Copy link
								</button>
								<button
									type="button"
									disabled={!stillOpen || !resend.canResend}
									title={
										!resend.canResend && resend.reason === "cooldown"
											? "A moment between resends keeps this from spamming the buyer"
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
									className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
								>
									<Send className="size-3.5" aria-hidden />
									{resendLabel}
								</button>
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
									className="tap-target flex items-center justify-center rounded-xl border border-border px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/5"
								>
									Cancel
								</button>
							</div>
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
