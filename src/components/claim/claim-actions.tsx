import { useMutation } from "convex/react";
import { Copy, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	CLAIM_MAX_SENDS,
	type ClaimSendOutcome,
	claimResendState,
	claimResendVisible,
} from "../../../convex/lib/orderClaims";
import { formatCountdown } from "../../lib/countdown";
import { convexErrorMessage } from "../../lib/format";
import { storefrontOrigin } from "../../lib/storefront-url";
import { cn } from "../../lib/utils";

/**
 * The pieces a claim link needs wherever it is shown (86eyq0epn) — the copy
 * button, the conditional retry, and the "why it didn't land" note.
 *
 * They live here rather than in `send-claim.tsx` because there are now two
 * surfaces: the "Waiting on buyers" list on the counter landing, and the
 * locked `WaitingOnBuyerScreen` a seller lands on when they open a checkout
 * whose link is still out. Both must offer the same remedies and say the same
 * thing about a failed send — one author, no drift.
 */

/** The buyer-facing claim URL — same origin rules as the storefront link. */
export function claimUrl(token: string): string {
	return `${storefrontOrigin()}/claim/${token}`;
}

export async function copyClaimLink(token: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(claimUrl(token));
		toast.success("Link copied — paste it into any chat");
	} catch {
		toast.error("Couldn't copy — long-press the link to copy it manually");
	}
}

/** Shared 1s tick (one interval per surface, however many rows it holds). */
export function useClaimNow(enabled: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [enabled]);
	return now;
}

const ACTION_CLASS =
	"tap-target flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted";

/**
 * Always offered, on every surface: the link works even when WhatsApp didn't,
 * and pasting it costs nothing.
 */
export function ClaimCopyLinkButton({
	token,
	className,
}: {
	token: string;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={() => copyClaimLink(token)}
			className={cn(ACTION_CLASS, className)}
		>
			<Copy className="size-3.5" aria-hidden />
			Copy link
		</button>
	);
}

/**
 * Renders NOTHING unless the last send actually failed in a way a retry could
 * fix (`claimResendVisible`). Short label on purpose — the note beside it
 * already names WhatsApp and the remedy.
 */
export function ClaimRetryButton({
	claim,
	now,
	stillOpen,
	className,
}: {
	claim: {
		claimId: Id<"orderClaims">;
		sentCount: number;
		lastSentAt: number;
		lastSendOutcome?: ClaimSendOutcome;
	};
	now: number;
	stillOpen: boolean;
	className?: string;
}) {
	const resendClaim = useMutation(api.orderClaims.resendClaim);
	if (!stillOpen || !claimResendVisible(claim.lastSendOutcome)) return null;
	const resend = claimResendState(claim, now);
	const label = !resend.canResend
		? resend.reason === "max_sends"
			? `Sent ${CLAIM_MAX_SENDS}×`
			: `Retry in ${formatCountdown((resend.nextAt ?? now) - now)}`
		: "Retry";
	return (
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
			className={cn(
				ACTION_CLASS,
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
		>
			<Send className="size-3.5" aria-hidden />
			{label}
		</button>
	);
}

/**
 * Why the WhatsApp didn't land, and what to do instead. Renders nothing on a
 * clean send. Each arm names the seller's ACTUAL next move — a single generic
 * "failed" hid the only one the buyer can fix (replying START).
 */
export function ClaimSendNotice({
	outcome,
}: {
	outcome: ClaimSendOutcome | undefined;
}) {
	if (outcome === undefined || outcome === "sent") return null;
	if (outcome === "unavailable")
		return (
			<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
				WhatsApp sending isn&apos;t switched on yet — copy the link and send it
				to them yourself. The link and its countdown work normally.
			</p>
		);
	const amber =
		"rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
	if (outcome === "opted_out")
		return (
			<p className={amber}>
				This buyer has opted out of WhatsApp messages from Kedaipal, so we
				couldn&apos;t send it. They can reply{" "}
				<span className="font-semibold">START</span> to our number to turn them
				back on — or just copy the link across yourself. The link and its
				countdown work normally.
			</p>
		);
	if (outcome === "blocked")
		return (
			<p className={amber}>
				WhatsApp sending is paused right now (a sending limit or a safety pause
				on our side) — copy the link and send it yourself. The link and its
				countdown work normally.
			</p>
		);
	return (
		<p className={amber}>
			The WhatsApp message couldn&apos;t be delivered — copy the link and send it
			to them yourself. The link (and its deadline) still works.
		</p>
	);
}
