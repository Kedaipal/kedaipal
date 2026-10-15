import { useState } from "react";
import { toast } from "sonner";
import { convexErrorMessage } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { ModeRow, ModeRowGroup } from "../ui/mode-row";
import type { HitpaySummary } from "./online-payments-card";
import {
	Card,
	Glance,
	HelperBullets,
	SectionHeading,
	SourceLabel,
} from "./settings-primitives";

/**
 * Settings → Payments → "How buyers pay" (86eye9xd4, 8A). One door, chosen
 * here: manual transfer (the seller's bank + QR details and the "I've paid"
 * check) or HitPay online (a hosted page that confirms the order itself).
 * HitPay on is exclusive — buyers stop seeing the manual details on any order
 * HitPay can take, so every payment reconciles itself. The choice is the
 * HitPay connection's `enabled` switch; credentials stay in Integrations and
 * the manual methods stay saved either way, so switching back is one tap.
 */
export function HowBuyersPayCard({
	hitpay,
	canUse,
	manualCount,
	onSave,
	onOpenIntegrations,
}: {
	hitpay: HitpaySummary | undefined;
	/** Client mirror of PLAN_FEATURES.onlinePayments (the server is the lock). */
	canUse: boolean;
	/** Saved bank + QR methods — what the manual door has to show. */
	manualCount: number;
	onSave: (patch: { hitpay: { enabled: boolean } }) => Promise<unknown>;
	onOpenIntegrations: () => void;
}) {
	const [saving, setSaving] = useState(false);
	const connected = hitpay?.hasCredentials === true;
	const online = connected && hitpay?.enabled === true;
	// Turning HitPay OFF is never plan-locked (a downgrade never traps a store
	// on a door it can't pay for); turning it on is Pro.
	const onlineLockedReason = !connected
		? "Connect your HitPay account under Integrations first."
		: !canUse && !online
			? "Online payments are a Pro feature — upgrade under Billing."
			: null;

	async function choose(enabled: boolean) {
		if (enabled === online || saving) return;
		setSaving(true);
		try {
			await onSave({ hitpay: { enabled } });
			toast.success(
				enabled
					? "Buyers now pay with HitPay — your bank and QR details are hidden"
					: "Buyers now pay by manual transfer",
				{
					action: {
						label: "Undo",
						onClick: () => {
							void onSave({ hitpay: { enabled: !enabled } }).catch((err) =>
								toast.error(convexErrorMessage(err)),
							);
						},
					},
				},
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<SectionHeading
				title="How buyers pay"
				description="The one way buyers pay you for an order."
				glance={
					online ? (
						<Glance>HitPay online</Glance>
					) : (
						<Glance tone="grey">Manual transfer</Glance>
					)
				}
			/>
			<ModeRowGroup label="How buyers pay" className="gap-2.5">
				<SourceLabel source="builtin" />
				<ModeRow
					active={!online}
					disabled={saving}
					onSelect={() => void choose(false)}
					title="Manual transfer"
					description="Your bank and QR details, with the “I've paid” check"
				/>
				<SourceLabel source="partner">your HitPay account</SourceLabel>
				<ModeRow
					partner
					active={online}
					disabled={saving || onlineLockedReason !== null}
					onSelect={() => void choose(true)}
					title="HitPay online"
					description="Buyers pay on a hosted page and the order confirms itself"
					badge={!canUse ? <ProBadge /> : undefined}
				/>
			</ModeRowGroup>
			{onlineLockedReason ? (
				<p className="text-xs text-muted-foreground">
					{onlineLockedReason}{" "}
					{!connected ? (
						<button
							type="button"
							onClick={onOpenIntegrations}
							className="-my-2 py-2 font-semibold text-accent-emphasis hover:underline"
						>
							Open Integrations
						</button>
					) : null}
				</p>
			) : null}
			{online ? (
				<HelperBullets
					variant="check"
					items={[
						"Payments confirm themselves — no more screenshot checking",
						"Your bank and QR details stay saved, so switching back is instant",
						"An order too small for HitPay still shows your manual details",
					]}
				/>
			) : connected ? null : manualCount === 0 ? (
				<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
					Buyers have nothing to pay with yet — add a bank account or QR below.
				</p>
			) : null}
		</Card>
	);
}

/**
 * The HitPay account, as seen from Payments: its state in a chip and a link
 * to where its keys live. Connection, keys and disconnect stay in Integrations
 * — one home for every third-party account (2 Sep IA rework).
 */
export function HitpayAccountCard({
	hitpay,
	onOpenIntegrations,
}: {
	hitpay: HitpaySummary | undefined;
	onOpenIntegrations: () => void;
}) {
	const connected = hitpay?.hasCredentials === true;
	return (
		<Card>
			<SectionHeading
				title="HitPay account"
				description={
					<>
						{connected
							? "Keys and connection live under "
							: "Connect your own HitPay account to let buyers pay online, under "}
						<button
							type="button"
							onClick={onOpenIntegrations}
							className="-my-2 py-2 font-semibold text-accent-emphasis hover:underline"
						>
							Integrations ›
						</button>
					</>
				}
				glance={
					connected ? (
						hitpay?.mode === "sandbox" ? (
							<Glance tone="warn">Test keys</Glance>
						) : (
							<Glance>Connected</Glance>
						)
					) : (
						<Glance tone="grey">Not connected</Glance>
					)
				}
			/>
		</Card>
	);
}
