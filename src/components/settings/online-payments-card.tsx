/**
 * Online payments (HitPay) connect card — Settings → Payments (86eyb6z3a).
 *
 * BYO model, the Lalamove credential card's sibling: the seller opens their
 * OWN HitPay account, pastes the API key + salt from HitPay's API Keys page,
 * and buyers get a "Pay now" hosted checkout on their order pages that
 * auto-confirms payment. The card front-loads the three things a seller must
 * understand BEFORE connecting (payout timing, fees, business-registry
 * eligibility) as short bullets — no wall of text. Disconnect + pause are
 * never plan-gated (downgrade never traps); connecting is Pro.
 *
 * Everything country-shaped — which rails are pitched, the registry a seller
 * must hold, and the "not instant like a direct …" comparison — is keyed off
 * the store's country (SG-lite, 86eyph341). Malaysia's copy is unchanged.
 */

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Country } from "../../../convex/lib/country";
import { convexErrorMessage } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
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
	/** The account's probed enabled rails; `methodsCheckedAt` with NO list =
	 * the probe ran and HitPay rejected the key. */
	paymentMethods?: string[];
	methodsCheckedAt?: number;
};

type HitpayPatch = {
	hitpay: { enabled: boolean; apiKey?: string; salt?: string } | null;
};

export function OnlinePaymentsCard({
	hitpay,
	canUse,
	country,
	onSave,
}: {
	hitpay: HitpaySummary | undefined;
	/** Client mirror of PLAN_FEATURES.onlinePayments (server is the lock). */
	canUse: boolean;
	/** Store country — picks the pitched rails + the eligibility/settlement copy. */
	country: Country;
	onSave: (patch: HitpayPatch) => Promise<unknown>;
}) {
	const copy = COUNTRY_COPY[country];
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
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2.5">
					{/* Official HitPay mark (light-background variant of the checkout
					    header's own asset) — the Lalamove-logo precedent. */}
					<AppImage
						src="/img/hitpay-logo.svg"
						alt="HitPay"
						aspect="size-7"
						fill={false}
						className="shrink-0"
					/>
					<h2 className="font-heading text-lg font-bold">Online payments</h2>
					{!canUse ? <ProBadge /> : null}
				</div>
				<p className="text-sm text-muted-foreground">
					Let buyers pay online through your own HitPay account. Your bank
					&amp; QR details above stay as the manual fallback.
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
						{/* The account's ACTUAL rails (probed truth) — never a promise.
						    checkedAt-with-no-list = HitPay rejected the key. */}
						{hitpay?.paymentMethods?.length ? (
							<div className="flex flex-col gap-1.5">
								<p className="text-xs font-medium text-muted-foreground">
									Buyers can pay with
								</p>
								<MethodLogos codes={hitpay.paymentMethods} />
								<p className="text-[11px] text-muted-foreground">
									Turn methods on or off in your HitPay dashboard — this list
									follows it.
								</p>
							</div>
						) : hitpay?.methodsCheckedAt ? (
							<p className="text-xs font-medium text-amber-700">
								HitPay rejected this API key — double-check it (Replace keys
								below), or buyers' payments will fail.
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								Checking which payment methods your HitPay account has
								enabled…
							</p>
						)}
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
								{/* Pausing is never gated; RESUMING is enabling, so a
								    downgraded seller gets disabled-with-reason instead of a
								    button that fails server-side (house style). */}
								<Button
									type="button"
									variant={hitpay?.enabled ? "outline" : "default"}
									className="h-11"
									isLoading={saving}
									disabled={!hitpay?.enabled && !canUse}
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
					{!editingKeys && !hitpay?.enabled && !canUse ? (
						<p className="text-xs text-muted-foreground">
							Resuming online payments needs Pro — upgrade in Settings →
							Billing. Your keys are kept meanwhile.
						</p>
					) : null}
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
					{/* Capability pitch — explicitly captioned so it never reads as a
					    promise: buyers only see what the seller enables in HitPay. */}
					<div className="flex flex-col gap-1.5">
						<MethodLogos codes={copy.pitchCodes} />
						<p className="text-[11px] text-muted-foreground">
							…and more. You pick which methods to switch on in your HitPay
							dashboard — buyers only ever see the ones you've enabled.
						</p>
					</div>

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
							instant like a direct {copy.instantRail} transfer).
						</Bullet>
						<Bullet>
							HitPay charges a small fee per payment ({copy.feeHint}).{" "}
							<strong>Kedaipal takes nothing.</strong>
						</Bullet>
						<Bullet>
							You'll need a <strong>{copy.registry}</strong> — HitPay approves
							new accounts in 1–3 days.
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
								— add your logo and brand colour there (Settings → Checkout
								Customisation); buyers see them on the payment page.
							</li>
							<li>
								In the HitPay dashboard, open{" "}
								<span className="font-medium">Settings → API Keys</span>.
							</li>
							<li>Paste the API key and the salt (side by side there) below.</li>
						</ol>
						{/* Lalamove-guide precedent: a print-ready walkthrough for
						    sellers who want every screen spelled out (86eyjmhby). */}
						<a
							href="/guides/hitpay-setup.html"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1 self-start text-xs font-medium text-accent hover:underline"
						>
							Full step-by-step guide (print-ready){" "}
							<ExternalLink className="size-3" />
						</a>
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

/** Official method marks from HitPay's own gateway plugin, keyed by the API
 * codes their account probe returns. "card" fans out to Visa+Mastercard. */
const METHOD_ICONS: Record<string, Array<{ src: string; alt: string }>> = {
	touch_n_go: [{ src: "/img/payment/touchngo.svg", alt: "Touch 'n Go eWallet" }],
	duitnow: [{ src: "/img/payment/duitnow.svg", alt: "DuitNow QR" }],
	fpx: [{ src: "/img/payment/fpx.svg", alt: "FPX online banking" }],
	card: [
		{ src: "/img/payment/visa.svg", alt: "Visa" },
		{ src: "/img/payment/master.svg", alt: "Mastercard" },
	],
	grabpay: [{ src: "/img/payment/grabpay.svg", alt: "GrabPay" }],
	grabpay_direct: [{ src: "/img/payment/grabpay.svg", alt: "GrabPay" }],
	shopee_pay: [{ src: "/img/payment/shopeepay.svg", alt: "ShopeePay" }],
	boost: [{ src: "/img/payment/boost.svg", alt: "Boost" }],
	// NOTE: no `paynow_online` entry on purpose. `public/img/payment/paynow.svg`
	// is a base64 PNG in an <svg> shell (the recurring defect audited in
	// docs/landing-funnel.md) — rendering it beside the genuine vectors gives
	// the ransom-note row the brand rules warn about. PayNow falls through to
	// the wordmark chip below, the same call the landing strip made.
};

/** Wordmark chips for rails we have no brand-approved vector for — the
 * ShopeePay precedent. Without this the fallback prints the raw API code
 * ("paynow online"), which is not how the rail is spelled anywhere. */
const METHOD_CHIP_LABELS: Record<string, string> = {
	paynow_online: "PayNow",
	paynow: "PayNow",
};

/**
 * What the pitch shows before any account is connected — HitPay's capability
 * in that market, explicitly captioned as "what you enable is what buyers
 * see". Note these are HitPay's own API codes, NOT the order-method enum: NETS
 * is hand-pickable on an SG order (a terminal at the counter) but isn't a rail
 * we mint, so it never appears here.
 */
const PITCH_CODES: Record<Country, string[]> = {
	MY: ["touch_n_go", "duitnow", "fpx", "card"],
	SG: ["paynow_online", "card", "grabpay"],
};

/** Country-shaped strings for the pre-connect pitch. Exhaustive `Record` so a
 * third country is a compile error, never a silent Malaysia fallback. */
const COUNTRY_COPY: Record<
	Country,
	{
		pitchCodes: string[];
		/** The rail a seller compares payout speed against ("not instant like a
		 * direct … transfer") — the way THEY normally get paid today. */
		instantRail: string;
		/** Deliberately structural, not a quoted rate we'd have to keep true:
		 * QR/bank rails are the cheapest at every PSP, cards the dearest. */
		feeHint: string;
		registry: string;
	}
> = {
	MY: {
		pitchCodes: PITCH_CODES.MY,
		instantRail: "DuitNow",
		feeHint: "from ~1.2% for DuitNow QR",
		registry: "SSM-registered business",
	},
	SG: {
		pitchCodes: PITCH_CODES.SG,
		instantRail: "PayNow",
		feeHint: "lowest on PayNow, higher on cards",
		registry: "UEN — an ACRA-registered business",
	},
};

/**
 * Method chips. With `codes` (the connected account's probed list) it renders
 * ONLY those rails — never a promise the seller hasn't enabled; codes without
 * an icon render as small text chips so nothing silently disappears.
 */
function MethodLogos({ codes }: { codes: string[] }) {
	const seen = new Set<string>();
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{codes.map((code) => {
				const icons = METHOD_ICONS[code.toLowerCase()];
				if (!icons) {
					return (
						<span
							key={code}
							className="flex h-7 items-center rounded-md border border-border bg-white px-2 text-[10px] font-medium text-muted-foreground"
						>
							{METHOD_CHIP_LABELS[code.toLowerCase()] ??
								code.replace(/_/g, " ")}
						</span>
					);
				}
				return icons.map((m) => {
					if (seen.has(m.src)) return null;
					seen.add(m.src);
					return (
						<span
							key={m.src}
							className="flex h-7 w-11 items-center justify-center rounded-md border border-border bg-white px-1.5"
						>
							<AppImage
								src={m.src}
								alt={m.alt}
								aspect="h-4 w-auto"
								fill={false}
							/>
						</span>
					);
				});
			})}
		</div>
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
