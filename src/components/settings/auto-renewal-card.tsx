import { useAction, useMutation } from "convex/react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
import type { SubscriptionView } from "../../lib/subscription";
import { ConfirmDialog } from "../ui/confirm-dialog";

/**
 * Settings → Billing: the auto-renewal card (86eyb6z4r). Four states —
 * off (pitch + turn on), setup pending (finish / cancel), on (method + next
 * charge + always-available turn off), failing (name the problem, point at
 * the fixes). Turning it OFF is never gated: charges are merchant-initiated
 * by Kedaipal, so clearing local state alone guarantees no further charge.
 * The parent renders this only when the gateway is configured.
 */
export function AutoRenewalCard({
	sub,
	methods,
	returnFromSetup,
	onReturnHandled,
}: {
	sub: SubscriptionView;
	/** Tokenisable methods for the store's billing currency ("card",
	 * "touch_n_go"). Display only — HitPay's page is the truth. */
	methods: string[];
	/** True when the URL carries ?autorenew=return (back from HitPay). */
	returnFromSetup: boolean;
	onReturnHandled: () => void;
}) {
	const startSetup = useAction(api.subscriptionPayments.startAutoRenewSetup);
	const finishSetup = useAction(api.subscriptionPayments.finishAutoRenewSetup);
	const cancelAutoRenew = useMutation(api.subscriptionPayments.cancelAutoRenew);
	const [busy, setBusy] = useState(false);
	const [confirmingOff, setConfirmingOff] = useState(false);

	// Back from HitPay's authorisation page: reconcile once (the webhook may
	// have already recorded the attach — then this just confirms instantly).
	const reconciled = useRef(false);
	useEffect(() => {
		if (!returnFromSetup || reconciled.current) return;
		reconciled.current = true;
		void (async () => {
			try {
				const result = await finishSetup({});
				if (result.attached) {
					toast.success("Auto-renewal is on", {
						description: "Your renewals will be charged automatically.",
					});
				} else {
					toast.info("Auto-renewal setup wasn't finished", {
						description: "You can resume it below any time.",
					});
				}
			} catch {
				// The webhook path may still land it; the card re-renders reactively.
			} finally {
				onReturnHandled();
			}
		})();
	}, [returnFromSetup, finishSetup, onReturnHandled]);

	const methodNames = methods
		.map((m) => (m === "touch_n_go" ? "Touch 'n Go" : "card"))
		.join(" or ");

	const turnOn = async () => {
		setBusy(true);
		try {
			const { url } = await startSetup({});
			window.location.assign(url);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setBusy(false);
		}
	};

	const turnOff = async () => {
		try {
			await cancelAutoRenew({});
			toast.success("Auto-renewal is off", {
				description:
					"Future renewals come as an invoice you pay yourself — online or by bank transfer.",
			});
		} catch {
			toast.error("Couldn't turn off auto-renewal — try again.");
		}
	};

	const on = sub.autoRenew !== undefined;
	const failing = sub.autoRenew?.failing === true;

	return (
		<section
			className={`flex flex-col gap-3 rounded-2xl border p-5 lg:p-6 ${
				failing
					? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
					: "border-input bg-background"
			}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-start gap-3">
					{failing ? (
						<AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
					) : (
						<RefreshCw className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					)}
					<div>
						<p className="text-sm font-medium">Auto-renewal</p>
						{on ? (
							failing ? (
								<p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
									We couldn't charge your {sub.autoRenew?.methodLabel}. We'll
									retry automatically — or pay the invoice above now, or turn
									auto-renewal off and set it up again with a different method.
								</p>
							) : (
								<p className="mt-1 text-xs text-muted-foreground">
									On, using {sub.autoRenew?.methodLabel}.
									{sub.autoRenew?.nextChargeAt
										? ` Next charge on ${formatShortDate(sub.autoRenew.nextChargeAt)} — you'll get a heads-up email first, and a receipt after.`
										: " You'll get a heads-up email before each charge, and a receipt after."}
								</p>
							)
						) : sub.autoRenewSetupPending ? (
							<p className="mt-1 text-xs text-muted-foreground">
								Setup started but no payment method saved yet — finish it to
								switch renewals to automatic.
							</p>
						) : (
							<p className="mt-1 text-xs text-muted-foreground">
								Save a {methodNames} once and every renewal charges itself — no
								invoices to chase, no risk of your store pausing. Turn it off
								any time.
							</p>
						)}
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-2 sm:flex-row">
				{on ? (
					<button
						type="button"
						onClick={() => setConfirmingOff(true)}
						className="inline-flex h-10 w-fit items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						Turn off auto-renewal
					</button>
				) : (
					<>
						<button
							type="button"
							onClick={turnOn}
							disabled={busy}
							className="inline-flex h-10 w-fit items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
						>
							{busy
								? "Opening secure setup…"
								: sub.autoRenewSetupPending
									? "Finish setting up"
									: "Turn on auto-renewal"}
						</button>
						{sub.autoRenewSetupPending ? (
							<button
								type="button"
								onClick={turnOff}
								className="inline-flex h-10 w-fit items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
							>
								Cancel setup
							</button>
						) : null}
					</>
				)}
			</div>
			{!on && !sub.autoRenewSetupPending ? (
				<p className="text-[11px] text-muted-foreground">
					You'll authorise it once on HitPay's secure page — Kedaipal never
					sees or stores your card or wallet details.
				</p>
			) : null}

			<ConfirmDialog
				open={confirmingOff}
				onOpenChange={setConfirmingOff}
				title="Turn off auto-renewal?"
				description="Your saved payment method is removed and nothing will be charged automatically again. Future renewals arrive as an invoice you pay yourself — online or by bank transfer."
				confirmLabel="Turn off"
				onConfirm={turnOff}
			/>
		</section>
	);
}
