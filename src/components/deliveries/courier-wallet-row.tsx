/**
 * ONE courier wallet, rendered the same everywhere (z8r3fdrgxc + z8r3fdx34j):
 * Home's Balances card, the Deliveries page, Settings → Integrations and the
 * EasyParcel card all draw this row — one idea, one control. The words come
 * from `presentWallet` (src/lib/courier-wallets.ts); the row only lays them
 * out and wires the three things a seller can do to a wallet:
 *  - Top up — always a hand-off to the courier (`CourierTopUpSheet`), because
 *    the money is theirs and Kedaipal can't move it;
 *  - set the "low alert" line (integrations write; read-only otherwise, said
 *    in place rather than a dead button);
 *  - Refresh, for a provider we can ASK (EasyParcel, Delyva). Lalamove
 *    pushes, so a refresh button there would do nothing.
 */

import { useMutation } from "convex/react";
import { ArrowUpRight, Clock, Pencil, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import type { CourierProviderId } from "../../../convex/lib/courierProviders";
import {
	defaultLowAlertMinor,
	LOW_ALERT_MAX_MINOR,
	LOW_ALERT_MIN_MINOR,
	WALLET_PROVIDERS,
} from "../../../convex/lib/courierWallet";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { usePermission } from "../../hooks/usePermission";
import { useAreaLock } from "../../hooks/useStoreLock";
import { useWalletRefresh } from "../../hooks/useWalletRefresh";
import {
	type CourierWalletView,
	LALAMOVE_BUSINESS_NOTE,
	presentWallet,
	walletAmount,
	walletLabel,
} from "../../lib/courier-wallets";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { TONE_ACCENT, type Tone } from "../../lib/tone";
import {
	awaitingTopUp,
	topUpWaitingLine,
	useTopUpTrip,
} from "../../lib/top-up-awaiting";
import { cn } from "../../lib/utils";
import { Glance } from "../settings/settings-primitives";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { DelyvaLogo } from "../ui/delyva-logo";
import { EasyparcelLogo } from "../ui/easyparcel-logo";
import { Input } from "../ui/input";
import { InputPrefixFrame } from "../ui/input-prefix-frame";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { CourierTopUpSheet } from "./courier-top-up-sheet";

/** The courier's own wordmark — official marks are never redrawn. */
export function CourierProviderMark({
	provider,
	heightClass = "h-4",
}: {
	provider: CourierProviderId;
	heightClass?: string;
}) {
	const name = WALLET_PROVIDERS[provider].name;
	if (provider === "delyva")
		return <DelyvaLogo heightClass={heightClass} alt={name} />;
	if (provider === "easyparcel")
		return <EasyparcelLogo heightClass={heightClass} alt={name} />;
	return (
		<AppImage
			src="/img/lalamove-logo.svg"
			alt={name}
			aspect={`${heightClass} w-auto`}
			fill={false}
			className="shrink-0"
		/>
	);
}

const FIGURE_TONE: Record<Tone, string> = {
	neutral: "text-foreground",
	success: TONE_ACCENT.success,
	warn: TONE_ACCENT.warn,
	info: TONE_ACCENT.info,
	danger: TONE_ACCENT.danger,
	pending: TONE_ACCENT.pending,
	progress: TONE_ACCENT.progress,
};

export function CourierWalletRow({
	view,
	retailerId,
	country,
	now,
	editable = true,
}: {
	view: CourierWalletView;
	retailerId: Id<"retailers">;
	country: Country;
	/** The render's clock (one per list, so rows agree). */
	now: number;
	/** Show the low-alert control. Home passes false: a glance, not settings. */
	editable?: boolean;
}) {
	const alertShown =
		editable && view.isTest !== true && view.state !== "unshared";
	const p = presentWallet(view, now, { alertShown });
	const [sheetOpen, setSheetOpen] = useState(false);
	const integrations = usePermission("integrations");
	// The alert line is a setting: a teammate without integrations write, or
	// a lapsed (view-only) store, sees it as a statement with the reason.
	const alertLock = useAreaLock("integrations");
	const model = WALLET_PROVIDERS[view.provider].model;
	// Every real wallet offers its top-up on every surface (Zaki, 31 Oct) —
	// filled when it needs money, quiet when it doesn't. Play money never.
	const showTopUp = !p.isTest;
	const name = WALLET_PROVIDERS[view.provider].name;
	const detailTone: Tone =
		p.tone === "danger" ? "danger" : p.tone === "warn" ? "warn" : "neutral";
	// The seller went to top up from this or another surface: say we're
	// waiting for it, until a newer balance lands (Arif, 24 Oct).
	const waiting = awaitingTopUp(useTopUpTrip(view.provider), view, now);

	return (
		<li
			className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
			data-testid={`courier-wallet-${view.provider}`}
			data-state={p.isTest ? "test" : view.state}
		>
			<div className="flex min-w-0 items-start gap-3">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span className="flex items-center gap-1.5">
							<CourierProviderMark provider={view.provider} />
							<span className="text-sm font-semibold text-foreground">
								wallet
							</span>
						</span>
						{p.isTest ? <Glance tone="warn">Test</Glance> : null}
						{!view.armed ? <Glance tone="grey">Booking off</Glance> : null}
					</div>
					<p className="text-xs leading-5">
						<span
							className={
								detailTone === "neutral"
									? "text-muted-foreground"
									: `font-medium ${TONE_ACCENT[detailTone]}`
							}
						>
							{p.detail}
						</span>
						{/* The alert line rides the detail line — a control of its own
						    row on every wallet doubled the list's height. */}
						{alertShown ? (
							<>
								<span aria-hidden className="text-muted-foreground">
									{" · "}
								</span>
								<LowAlertControl
									view={view}
									retailerId={retailerId}
									lockedReason={alertLock.readOnly ? alertLock.reason : null}
								/>
							</>
						) : null}
					</p>
					{waiting ? (
						<p
							className={`flex items-center gap-1.5 text-xs leading-5 font-medium ${TONE_ACCENT.info}`}
							data-testid="wallet-awaiting-top-up"
						>
							<Clock aria-hidden className="size-3.5 shrink-0" />
							{topUpWaitingLine(view)}
						</p>
					) : null}
					{p.needsTopUp && view.provider === "lalamove" ? (
						<p className="text-xs leading-5 text-muted-foreground">
							{LALAMOVE_BUSINESS_NOTE}
						</p>
					) : null}
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1.5">
					<span
						className={cn(
							"pt-0.5 text-right text-sm font-semibold",
							p.figureIsAmount
								? "font-mono tabular-nums"
								: "text-xs font-medium",
							// A word carries the state's colour too — "Too low" is as
							// urgent as RM 0.00; only a neutral word ("Not shared")
							// stays quiet.
							p.stale || (!p.figureIsAmount && p.tone === "neutral")
								? "text-muted-foreground"
								: FIGURE_TONE[p.tone],
						)}
					>
						{p.figure}
					</span>
					{showTopUp || (model === "pull" && integrations.canRead) ? (
						<div className="flex items-center gap-1">
							{model === "pull" && integrations.canRead ? (
								<RefreshWalletButton provider={view.provider} name={name} />
							) : null}
							{showTopUp ? (
								<button
									type="button"
									aria-label={`Top up ${name}`}
									onClick={() => setSheetOpen(true)}
									className={cn(
										// 32px drawn, 44px to tap: the overlay is the target.
										"relative inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold outline-none transition-colors after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-3 focus-visible:ring-ring/50",
										p.needsTopUp
											? "bg-accent text-accent-foreground hover:bg-accent/90"
											: "border border-border text-foreground hover:bg-muted",
									)}
								>
									Top up
									<ArrowUpRight aria-hidden className="size-3.5" />
								</button>
							) : null}
						</div>
					) : null}
				</div>
			</div>

			<CourierTopUpSheet
				open={sheetOpen}
				onOpenChange={setSheetOpen}
				view={view}
				country={country}
				now={now}
				retailerId={retailerId}
			/>
		</li>
	);
}

/** The wallets that answer when asked (EasyParcel, Delyva) — the ones a
 * refresh can move. An icon beside Top up, named for screen readers; spins
 * while asking. */
function RefreshWalletButton({
	provider,
	name,
}: {
	provider: CourierProviderId;
	name: string;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const refresh = useWalletRefresh(provider);
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			aria-label={busy ? `Checking ${name}…` : `Refresh ${name} balance`}
			title="Ask for the latest balance"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					const result = await refresh({ retailerId: actAsRetailerId });
					if (!result.ok) toast.error(result.message);
				} catch (err) {
					toast.error(convexErrorMessage(err));
				} finally {
					setBusy(false);
				}
			}}
			className="relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
		>
			<RefreshCw
				aria-hidden
				className={cn("size-3.5", busy && "animate-spin")}
			/>
		</button>
	);
}

/**
 * "Alert at RM 30" — the line under which this wallet reads low, Home flags
 * it and the owner gets one email. Editable in place with integrations write;
 * otherwise the same words, as a statement.
 */
function LowAlertControl({
	view,
	retailerId,
	lockedReason,
}: {
	view: CourierWalletView;
	retailerId: Id<"retailers">;
	/** Why this reader can't change it, or null when they can. */
	lockedReason: string | null;
}) {
	const label = `Alert at ${walletAmount(view.lowAlertMinor, view.currency)}`;
	const [open, setOpen] = useState(false);
	if (lockedReason)
		return (
			<span className="text-muted-foreground" title={lockedReason}>
				{label}
			</span>
		);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{/* Inline in the detail line. The invisible ::after extends the
				    tap target to 44px tall without growing the line box (padding
				    on an inline control would). */}
				<button
					type="button"
					className="relative inline whitespace-nowrap font-medium text-muted-foreground underline decoration-dotted underline-offset-2 after:absolute after:-inset-y-3.5 after:inset-x-0 after:content-[''] hover:text-foreground"
					aria-label={`${label} — change the low alert for your ${walletLabel(view)}`}
				>
					{label}
					<Pencil aria-hidden className="ml-1 inline size-3 align-[-1px]" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-4">
				<LowAlertForm
					view={view}
					retailerId={retailerId}
					onDone={() => setOpen(false)}
				/>
			</PopoverContent>
		</Popover>
	);
}

function LowAlertForm({
	view,
	retailerId,
	onDone,
}: {
	view: CourierWalletView;
	retailerId: Id<"retailers">;
	onDone: () => void;
}) {
	const setLowAlert = useMutation(api.courierWallets.setLowAlert);
	const fallback = defaultLowAlertMinor(view.currency);
	const [value, setValue] = useState(String(view.lowAlertMinor / 100));
	const [saving, setSaving] = useState(false);
	const minor = Math.round(Number(value) * 100);
	const valid =
		value.trim() !== "" &&
		Number.isFinite(minor) &&
		minor >= LOW_ALERT_MIN_MINOR &&
		minor <= LOW_ALERT_MAX_MINOR;
	const symbol = formatPrice(0, view.currency).replace(/[\d.,\s ]/g, "");

	async function save(next: number | null) {
		setSaving(true);
		try {
			await setLowAlert({
				retailerId,
				provider: view.provider,
				lowAlertMinor: next,
			});
			toast.success(
				`${walletLabel(view)} alert set to ${walletAmount(next ?? fallback, view.currency)}`,
			);
			onDone();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function onSubmit(e: FormEvent) {
		e.preventDefault();
		if (valid) void save(minor);
	}

	return (
		<form className="flex flex-col gap-3" onSubmit={onSubmit}>
			<div className="flex flex-col gap-1">
				<label
					htmlFor={`low-alert-${view.provider}`}
					className="text-sm font-semibold text-foreground"
				>
					Low alert for your {walletLabel(view)}
				</label>
				<p className="text-xs leading-5 text-muted-foreground">
					Under this, Home and Deliveries flag the wallet and the store owner
					gets one email — again only after it's been topped up.
				</p>
			</div>
			<InputPrefixFrame prefix={symbol} invalid={!valid}>
				<Input
					id={`low-alert-${view.provider}`}
					variant="bare"
					inputMode="decimal"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					aria-invalid={!valid}
				/>
			</InputPrefixFrame>
			{!valid ? (
				<p className={cn("text-xs", TONE_ACCENT.danger)}>
					Pick an amount between{" "}
					{formatPrice(LOW_ALERT_MIN_MINOR, view.currency)} and{" "}
					{formatPrice(LOW_ALERT_MAX_MINOR, view.currency)}.
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2">
				{view.lowAlertCustom ? (
					<Button
						type="button"
						variant="ghost"
						className="tap-target"
						disabled={saving}
						onClick={() => void save(null)}
					>
						Reset to {walletAmount(fallback, view.currency)}
					</Button>
				) : null}
				<Button
					type="submit"
					className="tap-target"
					disabled={!valid || saving}
					isLoading={saving}
				>
					Save alert
				</Button>
			</div>
		</form>
	);
}
