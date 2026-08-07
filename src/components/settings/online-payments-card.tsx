/**
 * Online payments (HitPay) connect card — Settings → Payments (86eyb6z3a).
 *
 * BYO model, the Lalamove credential card's sibling: the seller opens their
 * OWN HitPay account, pastes the API key + salt from HitPay's API Keys page,
 * and buyers get a "Pay now" hosted checkout on their order pages that
 * auto-confirms payment. The card front-loads the three things a seller must
 * understand BEFORE connecting (payout timing, fees, SSM eligibility) as
 * short bullets — no wall of text. Disconnect + pause are never plan-gated
 * (downgrade never traps); connecting is Pro.
 */

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { convexErrorMessage } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";

/** Secret-free connection summary — mirrors retailers.HitpaySummary. */
type HitpaySummary = {
	enabled: boolean;
	hasCredentials: boolean;
	mode?: "sandbox" | "production";
	apiKeyHint?: string;
	connectedAt?: number;
};

type HitpayPatch = {
	hitpay: { enabled: boolean; apiKey?: string; salt?: string } | null;
};

export function OnlinePaymentsCard({
	hitpay,
	canUse,
	onSave,
}: {
	hitpay: HitpaySummary | undefined;
	/** Client mirror of PLAN_FEATURES.onlinePayments (server is the lock). */
	canUse: boolean;
	onSave: (patch: HitpayPatch) => Promise<unknown>;
}) {
	const [apiKey, setApiKey] = useState("");
	const [salt, setSalt] = useState("");
	const [editingKeys, setEditingKeys] = useState(false);
	const [saving, setSaving] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

	const connected = hitpay?.hasCredentials === true;
	const locked = !canUse && !connected;
	const typedBothKeys = apiKey.trim().length > 0 && salt.trim().length > 0;

	async function save(patch: HitpayPatch, successMessage: string) {
		setSaving(true);
		try {
			await onSave(patch);
			toast.success(successMessage);
			setApiKey("");
			setSalt("");
			setEditingKeys(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<h2 className="font-heading text-lg font-bold">Online payments</h2>
					{!canUse ? <ProBadge /> : null}
				</div>
				<p className="text-sm text-muted-foreground">
					Let buyers pay by Touch 'n Go, DuitNow QR, FPX or card — powered by
					your own HitPay account. Your bank &amp; QR details below stay as the
					manual fallback.
				</p>
			</div>

			{connected ? (
				<>
					{/* Connected status */}
					<div className="flex flex-col gap-2 rounded-xl border border-input p-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="text-sm">
								Connected — key ending{" "}
								<span className="font-mono">…{hitpay?.apiKeyHint}</span>
							</span>
							<div className="flex items-center gap-2">
								{hitpay?.mode === "sandbox" ? (
									<span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
										Test mode
									</span>
								) : null}
								<span
									className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
										hitpay?.enabled
											? "bg-emerald-100 text-emerald-800"
											: "bg-muted text-muted-foreground"
									}`}
								>
									{hitpay?.enabled ? "On" : "Paused"}
								</span>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							{hitpay?.enabled
								? "Buyers see a Pay now button on their order page. Payments confirm the order automatically and you're notified on WhatsApp-side as usual."
								: "Paused — buyers don't see Pay now right now. Your keys are kept, so resuming is one tap."}
						</p>
						{hitpay?.mode === "sandbox" ? (
							<p className="text-xs text-amber-700">
								This is a HitPay <strong>sandbox</strong> key — payments are
								simulated, no real money moves. Swap in your live key before
								telling buyers.
							</p>
						) : null}
					</div>

					{editingKeys ? (
						<KeyInputs
							apiKey={apiKey}
							salt={salt}
							disabled={false}
							onApiKey={setApiKey}
							onSalt={setSalt}
						/>
					) : null}

					<div className="flex flex-wrap items-center gap-2">
						{editingKeys ? (
							<>
								<Button
									type="button"
									onClick={() =>
										save(
											{
												hitpay: {
													enabled: hitpay?.enabled ?? true,
													apiKey: apiKey.trim(),
													salt: salt.trim(),
												},
											},
											"HitPay keys updated",
										)
									}
									isLoading={saving}
									disabled={!typedBothKeys || saving}
									className="h-11"
								>
									Save new keys
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									onClick={() => {
										setEditingKeys(false);
										setApiKey("");
										setSalt("");
									}}
								>
									Keep the stored keys
								</Button>
							</>
						) : (
							<>
								<Button
									type="button"
									variant={hitpay?.enabled ? "outline" : "default"}
									className="h-11"
									isLoading={saving}
									onClick={() =>
										save(
											{ hitpay: { enabled: !(hitpay?.enabled ?? false) } },
											hitpay?.enabled
												? "Online payments paused"
												: "Online payments on — buyers now see Pay now",
										)
									}
								>
									{hitpay?.enabled ? "Pause" : "Resume"}
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									onClick={() => setEditingKeys(true)}
								>
									Replace keys
								</Button>
								<button
									type="button"
									onClick={() => setConfirmingDisconnect(true)}
									className="ml-auto text-sm font-medium text-destructive hover:underline"
								>
									Disconnect
								</button>
							</>
						)}
					</div>
					<ConfirmDialog
						open={confirmingDisconnect}
						onOpenChange={setConfirmingDisconnect}
						title="Disconnect HitPay?"
						description="Buyers lose the Pay now button and go back to your manual bank/QR details. A payment made on an already-open checkout link after this won't auto-confirm — check your HitPay dashboard and mark it received by hand."
						confirmLabel="Disconnect"
						destructive
						onConfirm={() =>
							save({ hitpay: null }, "HitPay disconnected")
						}
					/>
				</>
			) : (
				<>
					{/* What connecting means — the three things to understand first,
					    kept to one line each (Zaki: bullets, not paragraphs). */}
					<ul className="flex flex-col gap-1.5 text-sm">
						<Bullet>
							Buyers tap <strong>Pay now</strong> and pay in their own bank or
							wallet app — no more QR screenshots.
						</Bullet>
						<Bullet>
							The order marks itself <strong>paid automatically</strong> — no
							more checking transfer screenshots.
						</Bullet>
						<Bullet>
							Money reaches your bank in <strong>2–3 working days</strong> (not
							instant like a direct DuitNow transfer).
						</Bullet>
						<Bullet>
							HitPay charges a small fee per payment (from ~1.2% for DuitNow
							QR). <strong>Kedaipal takes nothing.</strong>
						</Bullet>
						<Bullet>
							You'll need an <strong>SSM-registered business</strong> — HitPay
							approves new accounts in 1–3 days.
						</Bullet>
					</ul>

					{/* 3-step connect */}
					<div className="flex flex-col gap-2 rounded-xl border border-input bg-muted/30 p-3 text-sm">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							How to connect
						</p>
						<ol className="flex list-decimal flex-col gap-1 pl-5">
							<li>
								Create a free business account at{" "}
								<a
									href="https://hitpayapp.com"
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
								>
									hitpayapp.com <ExternalLink className="size-3" />
								</a>{" "}
								and add your logo there (buyers see it at checkout).
							</li>
							<li>
								In the HitPay dashboard, open{" "}
								<span className="font-medium">Settings → API Keys</span>.
							</li>
							<li>Paste the API key and the salt (side by side there) below.</li>
						</ol>
					</div>

					<KeyInputs
						apiKey={apiKey}
						salt={salt}
						disabled={locked}
						onApiKey={setApiKey}
						onSalt={setSalt}
					/>

					<div className="flex flex-col gap-2">
						<Button
							type="button"
							onClick={() =>
								save(
									{
										hitpay: {
											enabled: true,
											apiKey: apiKey.trim(),
											salt: salt.trim(),
										},
									},
									"HitPay connected — buyers now see Pay now on their orders",
								)
							}
							isLoading={saving}
							disabled={locked || !typedBothKeys || saving}
							className="h-11 self-start"
						>
							Connect HitPay
						</Button>
						{locked ? (
							<p className="text-xs text-muted-foreground">
								Online payments is a Pro feature — upgrade in Settings →
								Billing to connect. (Disconnecting is never locked.)
							</p>
						) : !typedBothKeys ? (
							<p className="text-xs text-muted-foreground">
								Paste both values to connect — they're shown together on
								HitPay's API Keys page.
							</p>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}

function Bullet({ children }: { children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-2">
			<span aria-hidden className="mt-0.5 text-accent">
				✓
			</span>
			<span>{children}</span>
		</li>
	);
}

/** Same anti-autofill posture as the Lalamove key inputs: plain text with a
 * CSS mask on the salt, never type="password", so Chrome doesn't offer saved
 * logins into a credentials-for-another-service form. */
function KeyInputs({
	apiKey,
	salt,
	disabled,
	onApiKey,
	onSalt,
}: {
	apiKey: string;
	salt: string;
	disabled: boolean;
	onApiKey: (v: string) => void;
	onSalt: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Input
				type="text"
				name="hitpay-api-key"
				autoComplete="off"
				data-1p-ignore
				data-lpignore="true"
				data-form-type="other"
				value={apiKey}
				disabled={disabled}
				onChange={(e) => onApiKey(e.target.value)}
				placeholder="API key"
				className="h-11 font-mono text-sm"
			/>
			<Input
				type="text"
				name="hitpay-salt"
				autoComplete="off"
				data-1p-ignore
				data-lpignore="true"
				data-form-type="other"
				value={salt}
				disabled={disabled}
				onChange={(e) => onSalt(e.target.value)}
				placeholder="Salt"
				className="h-11 font-mono text-sm"
				style={
					salt.length > 0
						? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
						: undefined
				}
			/>
		</div>
	);
}
