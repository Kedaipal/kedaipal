import { Scissors, Tag, TriangleAlert } from "lucide-react";
import { useId } from "react";
import {
	DEFAULT_PROMO_LABEL,
	MAX_PROMO_PAY_WINDOW_MINUTES,
	MIN_PROMO_PAY_WINDOW_MINUTES,
	PROMO_LABEL_MAX_CHARS,
	promoPriceFromPercent,
} from "../../../convex/lib/promo";
import { formatPrice, parsePriceInput } from "../../lib/format";
import { cn } from "../../lib/utils";
import { ProBadge } from "../app/pro-gate";
import { Input } from "../ui/input";
import { ToggleSwitch } from "../ui/toggle-switch";

/**
 * The Promotion block (z8r3fdcw72) — a lower price for a while that snaps back
 * by itself. Rendered by the full product form and, headerless, by the wizard's
 * Promotion step, the way `EventFields` serves both.
 *
 * Two questions, deliberately asked separately, because one "duration" control
 * reads as a start offset ("30 min" — from now, or lasting 30 min?): WHEN does
 * it start, and HOW LONG does it run. A computed sentence underneath says what
 * the two answers add up to, so the seller never has to work it out.
 *
 * Everything here is kept as the seller TYPED it (strings) and parsed at
 * submit — the house convention for money and number fields in this form.
 */

export type PromoDraft = {
	on: boolean;
	/** Badge wording; blank falls back to `DEFAULT_PROMO_LABEL` on display. */
	label: string;
	/** "now" = starts when they save; "schedule" = the drop fields below. */
	startMode: "now" | "schedule";
	/** "YYYY-MM-DD" / "HH:MM" — only read when `startMode` is "schedule". */
	startDate: string;
	startTime: string;
	/** How long it runs. `minutes` uses `durationMinutes`; `until` uses the
	 * end date/time pair; `open` is a plain discount with no countdown. */
	endMode: "minutes" | "until" | "open";
	durationMinutes: number;
	endDate: string;
	endTime: string;
	/** Flash extras, as typed. Blank = off. */
	unitCap: string;
	maxPerOrder: string;
	/** Minutes, or 0 for "no payment hold". */
	payWithinMinutes: number;
};

/** Duration presets. The `PREP_PRESETS` posture: a chip SETS the field and
 * tapping the live one clears it — a toggle, never a one-way door. */
export const PROMO_DURATION_PRESETS = [
	{ minutes: 30, label: "30 min" },
	{ minutes: 60, label: "1 hour" },
	{ minutes: 120, label: "2 hours" },
	{ minutes: 24 * 60, label: "1 day" },
] as const;

/** Payment-hold choices — the claim link's own rails (`CLAIM_WINDOW_CHOICES_
 * MINUTES`), which is what `MIN/MAX_PROMO_PAY_WINDOW_MINUTES` are bounded by. */
export const PROMO_PAY_WINDOW_CHOICES = [
	{ minutes: 0, label: "Off" },
	{ minutes: 15, label: "15 min" },
	{ minutes: 60, label: "1 hour" },
	{ minutes: 24 * 60, label: "24 h" },
] as const;

export const PROMO_PERCENT_PRESETS = [10, 20, 30, 50] as const;

export const EMPTY_PROMO_DRAFT: PromoDraft = {
	on: false,
	label: "",
	startMode: "now",
	startDate: "",
	startTime: "",
	endMode: "minutes",
	durationMinutes: 60,
	endDate: "",
	endTime: "",
	unitCap: "",
	maxPerOrder: "",
	payWithinMinutes: 0,
};

/** What `products.create` / `products.update` take. `null` CLEARS a stored
 * promotion — `undefined` means "no change", which would strand one that the
 * seller just switched off (the `eventSubmitValue` rule). */
export type PromoSubmitValue = {
	label?: string;
	startsAt?: number;
	endsAt?: number;
	unitCap?: number;
	maxPerOrder?: number;
	payWithinMinutes?: number;
} | null;

function epochFrom(date: string, time: string): number | undefined {
	if (date.trim().length === 0) return undefined;
	const at = new Date(`${date}T${time.trim() || "00:00"}`);
	const ms = at.getTime();
	return Number.isFinite(ms) ? ms : undefined;
}

function positiveInt(raw: string): number | undefined {
	const t = raw.trim();
	if (t.length === 0) return undefined;
	const n = Number.parseInt(t, 10);
	return Number.isInteger(n) && n > 0 && String(n) === t ? n : undefined;
}

/** Seed from a saved product (or the empty draft when it has no promotion). */
export function promoDraftFrom(
	promo:
		| {
				label?: string;
				startsAt?: number;
				endsAt?: number;
				unitCap?: number;
				maxPerOrder?: number;
				payWithinMinutes?: number;
		  }
		| undefined,
): PromoDraft {
	if (!promo) return { ...EMPTY_PROMO_DRAFT };
	const ymd = (ms: number) => {
		const d = new Date(ms);
		const pad = (n: number) => String(n).padStart(2, "0");
		return {
			date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
			time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
		};
	};
	const start = promo.startsAt !== undefined ? ymd(promo.startsAt) : undefined;
	const end = promo.endsAt !== undefined ? ymd(promo.endsAt) : undefined;
	return {
		on: true,
		label: promo.label ?? "",
		// A stored start is always re-shown as a scheduled one: "now" has
		// already happened by the time anyone re-opens the form, and offering
		// to re-start it silently would move a running sale.
		startMode: promo.startsAt !== undefined ? "schedule" : "now",
		startDate: start?.date ?? "",
		startTime: start?.time ?? "",
		endMode: promo.endsAt !== undefined ? "until" : "open",
		durationMinutes: 60,
		endDate: end?.date ?? "",
		endTime: end?.time ?? "",
		unitCap: promo.unitCap !== undefined ? String(promo.unitCap) : "",
		maxPerOrder:
			promo.maxPerOrder !== undefined ? String(promo.maxPerOrder) : "",
		payWithinMinutes: promo.payWithinMinutes ?? 0,
	};
}

export function promoSubmitValue(
	draft: PromoDraft,
	now: number,
	opts?: { flashAllowed?: boolean },
): PromoSubmitValue {
	if (!draft.on) return null;
	const startsAt =
		draft.startMode === "schedule"
			? epochFrom(draft.startDate, draft.startTime)
			: undefined;
	const endsAt =
		draft.endMode === "until"
			? epochFrom(draft.endDate, draft.endTime)
			: draft.endMode === "minutes"
				? (startsAt ?? now) + draft.durationMinutes * 60_000
				: undefined;
	const flash = opts?.flashAllowed !== false;
	return {
		label: draft.label.trim() || undefined,
		startsAt,
		endsAt,
		unitCap: flash ? positiveInt(draft.unitCap) : undefined,
		maxPerOrder: flash ? positiveInt(draft.maxPerOrder) : undefined,
		payWithinMinutes:
			flash && draft.payWithinMinutes > 0 ? draft.payWithinMinutes : undefined,
	};
}

/** Mirrors `sanitizePromo` so the form never offers a Save the server refuses. */
export function promoDraftIssue(
	draft: PromoDraft,
	now: number,
): string | undefined {
	if (!draft.on) return undefined;
	if (draft.label.trim().length > PROMO_LABEL_MAX_CHARS)
		return `Keep the promo label to ${PROMO_LABEL_MAX_CHARS} characters.`;
	const value = promoSubmitValue(draft, now);
	if (!value) return undefined;
	if (draft.startMode === "schedule" && value.startsAt === undefined)
		return "Pick the date and time the promotion starts.";
	if (draft.endMode === "until" && value.endsAt === undefined)
		return "Pick the date and time the promotion ends.";
	if (
		value.startsAt !== undefined &&
		value.endsAt !== undefined &&
		value.endsAt <= value.startsAt
	)
		return "The promotion must end after it starts.";
	if (value.endsAt !== undefined && value.endsAt <= now)
		return "That end time has already passed.";
	if (draft.unitCap.trim().length > 0 && value.unitCap === undefined)
		return "The unit cap must be a whole number above zero.";
	if (draft.maxPerOrder.trim().length > 0 && value.maxPerOrder === undefined)
		return "Max per order must be a whole number above zero.";
	if (
		draft.payWithinMinutes > 0 &&
		(draft.payWithinMinutes < MIN_PROMO_PAY_WINDOW_MINUTES ||
			draft.payWithinMinutes > MAX_PROMO_PAY_WINDOW_MINUTES)
	)
		return "The payment window must be between 5 minutes and 7 days.";
	return undefined;
}

export function promoDraftValid(draft: PromoDraft, now: number): boolean {
	return promoDraftIssue(draft, now) === undefined;
}

/** The sentence under the two pickers — what the answers ADD UP TO, so a
 * duration chip can never be misread as "starts in 30 minutes". */
export function promoWindowSentence(draft: PromoDraft, now: number): string {
	if (!draft.on) return "";
	const value = promoSubmitValue(draft, now);
	if (!value) return "";
	const when = (ms: number) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "numeric",
			minute: "2-digit",
		});
	const from =
		value.startsAt === undefined
			? "Runs from the moment you save"
			: `Runs from ${when(value.startsAt)}`;
	if (value.endsAt === undefined)
		return `${from} until you turn it off — a plain discount, no countdown.`;
	return `${from} until ${when(value.endsAt)}.`;
}

/** One sellable line the promotion can price. */
export type PromoRow = {
	key: string;
	label: string;
	/** List price as typed (major units). */
	price: string;
	/** Sale price as typed (major units); "" = this line is not on promo. */
	promoPrice: string;
};

export function PromoFields({
	draft,
	onChange,
	rows,
	onPromoPrices,
	currency,
	locked,
	flashAllowed = true,
	flashBlockedReason,
	creditBalance,
	noToggle,
	now,
}: {
	draft: PromoDraft;
	onChange: (next: PromoDraft) => void;
	rows: PromoRow[];
	/** Takes a BATCH, always — keyed by row. Quick fill writes every row in
	 * one call, so a parent that merges per call can't collapse N updates
	 * into one row (it did: "30% off" discounted only the last choice).
	 * A single field passes a one-entry record. */
	onPromoPrices: (next: Record<string, string>) => void;
	currency: string;
	locked?: boolean;
	/** False on booking/event listings — capacity and seats already cap them,
	 * which `assertFlashFieldsAllowed` enforces server-side. */
	flashAllowed?: boolean;
	flashBlockedReason?: string;
	creditBalance?: number;
	noToggle?: boolean;
	now: number;
}) {
	const fieldId = useId();
	const set = (patch: Partial<PromoDraft>) => onChange({ ...draft, ...patch });
	const open = draft.on || noToggle === true;
	const issue = promoDraftIssue(draft, now);
	const cap = positiveInt(draft.unitCap);
	const creditsShort =
		cap !== undefined && creditBalance !== undefined && cap > creditBalance;

	const applyPercent = (percent: number) => {
		const next: Record<string, string> = {};
		for (const row of rows) {
			const list = parsePriceInput(row.price);
			if (list === null) continue;
			const sale = promoPriceFromPercent(Math.round(list * 100), percent);
			next[row.key] = sale === null ? "" : (sale / 100).toFixed(2);
		}
		onPromoPrices(next);
	};

	const chip = (active: boolean) =>
		cn(
			"tap-target box-border rounded-full border-2 px-3.5 text-sm font-semibold transition-colors",
			active
				? "border-accent bg-accent/10 text-accent-emphasis"
				: "border-border bg-background text-muted-foreground hover:border-accent/40",
		);

	return (
		<div className="flex flex-col gap-4">
			{noToggle ? null : (
				<div className="flex items-start justify-between gap-4">
					<div>
						<h4 className="flex items-center gap-2 text-sm font-semibold">
							Run a promotion {locked ? <ProBadge /> : null}
						</h4>
						<p className="mt-1 text-xs text-muted-foreground">
							{locked
								? "Promotions are part of the Pro plan. Upgrade in Settings → Billing to run sale prices."
								: "A lower price for a while — it snaps back by itself when the promotion ends."}
						</p>
					</div>
					<ToggleSwitch
						on={draft.on}
						onChange={(on) => set({ on })}
						disabled={locked}
						label="Run a promotion on this product"
					/>
				</div>
			)}

			{open ? (
				<div
					className={cn(
						"flex flex-col gap-5",
						noToggle ? null : "border-t border-border pt-4",
					)}
				>
					{/* Sale price per sellable line. */}
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs font-semibold">Quick fill</span>
							{PROMO_PERCENT_PRESETS.map((percent) => (
								<button
									key={percent}
									type="button"
									onClick={() => applyPercent(percent)}
									className={chip(false)}
								>
									{percent}% off
								</button>
							))}
						</div>
						<div className="flex flex-col gap-2">
							{rows.map((row) => {
								const list = parsePriceInput(row.price);
								const sale = parsePriceInput(row.promoPrice);
								// The SAME rule `buildSubmitVariants` gates the save on, and
								// the only place it is ever SAID. The submit-time copy was
								// written and then rendered by nobody, so Save and Continue
								// were silent no-ops: the button did nothing, forever, with
								// the reason nowhere on screen (found by hand-testing).
								// Shown live while typing, not just on submit.
								const saleIssue =
									row.promoPrice.trim().length === 0
										? undefined
										: sale === null || list === null || sale <= 0
											? "Numbers only — e.g. 31.50."
											: sale >= list
												? "Must be below the normal price."
												: undefined;
								const errorId = `${fieldId}-${row.key}-err`;
								return (
									<div key={row.key} className="flex flex-col gap-1">
										<div className="flex items-center justify-between gap-3">
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">
													{row.label}
												</p>
												<p className="text-xs text-muted-foreground line-through">
													{list === null
														? "—"
														: formatPrice(Math.round(list * 100), currency)}
												</p>
											</div>
											<Input
												aria-label={`Sale price for ${row.label}`}
												aria-describedby={saleIssue ? errorId : undefined}
												variant="field"
												inputMode="decimal"
												placeholder="0.00"
												isError={saleIssue !== undefined}
												className="w-28 text-right"
												value={row.promoPrice}
												onChange={(e) =>
													onPromoPrices({ [row.key]: e.target.value })
												}
											/>
										</div>
										{saleIssue ? (
											<p
												id={errorId}
												className="text-right text-xs font-medium text-destructive"
											>
												{saleIssue}
											</p>
										) : null}
									</div>
								);
							})}
						</div>
						<p className="text-xs text-muted-foreground">
							Quick fill rounds to the nearest 5 sen. Leave a line blank to keep
							it at its normal price; a sale price must be below it.
						</p>
					</div>

					{/* Badge wording. */}
					<div className="flex flex-col gap-1.5">
						<label htmlFor="promo-label" className="text-xs font-semibold">
							Label{" "}
							<span className="font-normal text-muted-foreground">
								(shown on the badge)
							</span>
						</label>
						<Input
							id="promo-label"
							variant="field"
							className="w-56"
							maxLength={PROMO_LABEL_MAX_CHARS}
							placeholder={DEFAULT_PROMO_LABEL}
							value={draft.label}
							onChange={(e) => set({ label: e.target.value })}
						/>
					</div>

					{/* WHEN it starts — asked separately from how long it runs. */}
					<div className="flex flex-col gap-2">
						<span className="text-xs font-semibold">When does it start?</span>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => set({ startMode: "now" })}
								className={chip(draft.startMode === "now")}
							>
								Now
							</button>
							<button
								type="button"
								onClick={() => set({ startMode: "schedule" })}
								className={chip(draft.startMode === "schedule")}
							>
								Schedule a start…
							</button>
						</div>
						{draft.startMode === "schedule" ? (
							<div className="flex flex-wrap gap-2">
								<Input
									aria-label="Promotion start date"
									type="date"
									variant="field"
									className="w-44"
									value={draft.startDate}
									onChange={(e) => set({ startDate: e.target.value })}
								/>
								<Input
									aria-label="Promotion start time"
									type="time"
									variant="field"
									className="w-36"
									value={draft.startTime}
									onChange={(e) => set({ startTime: e.target.value })}
								/>
							</div>
						) : null}
					</div>

					{/* HOW LONG it runs. */}
					<div className="flex flex-col gap-2">
						<span className="text-xs font-semibold">How long does it run?</span>
						<div className="flex flex-wrap gap-2">
							{PROMO_DURATION_PRESETS.map((preset) => (
								<button
									key={preset.minutes}
									type="button"
									onClick={() =>
										set({
											endMode: "minutes",
											durationMinutes: preset.minutes,
										})
									}
									className={chip(
										draft.endMode === "minutes" &&
											draft.durationMinutes === preset.minutes,
									)}
								>
									For {preset.label}
								</button>
							))}
							<button
								type="button"
								onClick={() => set({ endMode: "until" })}
								className={chip(draft.endMode === "until")}
							>
								Until a date…
							</button>
							<button
								type="button"
								onClick={() => set({ endMode: "open" })}
								className={chip(draft.endMode === "open")}
							>
								No end date
							</button>
						</div>
						{draft.endMode === "until" ? (
							<div className="flex flex-wrap gap-2">
								<Input
									aria-label="Promotion end date"
									type="date"
									variant="field"
									className="w-44"
									value={draft.endDate}
									onChange={(e) => set({ endDate: e.target.value })}
								/>
								<Input
									aria-label="Promotion end time"
									type="time"
									variant="field"
									className="w-36"
									value={draft.endTime}
									onChange={(e) => set({ endTime: e.target.value })}
								/>
							</div>
						) : null}
						<p className="flex items-center gap-2 rounded-lg bg-accent/8 px-3 py-2 text-xs font-medium text-accent-emphasis">
							<Scissors
								className="size-3.5 shrink-0 -scale-x-100"
								aria-hidden
							/>
							{promoWindowSentence(draft, now)}
						</p>
						<p className="text-xs text-muted-foreground">
							A timed promotion shows a live countdown on your storefront. "No
							end date" is a plain discount — badge and strike-through, no
							timer.
						</p>
					</div>

					{/* Flash extras. */}
					{flashAllowed ? (
						<div className="flex flex-col gap-3 border-t border-border pt-4">
							<div className="flex items-center gap-2">
								<Tag className="size-3.5" aria-hidden />
								<span className="text-sm font-semibold">Flash sale extras</span>
								<span className="text-xs text-muted-foreground">optional</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<label htmlFor="promo-cap" className="text-sm">
									Only the first <b>N</b> units at this price
								</label>
								<Input
									id="promo-cap"
									variant="field"
									inputMode="numeric"
									className="w-24 text-right"
									placeholder="—"
									value={draft.unitCap}
									onChange={(e) => set({ unitCap: e.target.value })}
								/>
							</div>
							<div className="flex items-center justify-between gap-3">
								<label htmlFor="promo-max" className="text-sm">
									Max per order
								</label>
								<Input
									id="promo-max"
									variant="field"
									inputMode="numeric"
									className="w-24 text-right"
									placeholder="—"
									value={draft.maxPerOrder}
									onChange={(e) => set({ maxPerOrder: e.target.value })}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<span className="text-sm">Buyers must pay within</span>
								<div className="flex flex-wrap gap-2">
									{PROMO_PAY_WINDOW_CHOICES.map((choice) => (
										<button
											key={choice.minutes}
											type="button"
											onClick={() => set({ payWithinMinutes: choice.minutes })}
											className={chip(
												draft.payWithinMinutes === choice.minutes,
											)}
										>
											{choice.label}
										</button>
									))}
								</div>
								<p className="text-xs text-muted-foreground">
									Unpaid orders cancel themselves and release their units back
									to the sale.
								</p>
							</div>
							{creditsShort ? (
								<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
									<TriangleAlert
										className="mt-0.5 size-3.5 shrink-0"
										aria-hidden
									/>
									<span>
										This sale can take up to {cap} orders — you have{" "}
										{creditBalance} credits. Top up in Settings → Billing so a
										busy sale doesn't lock your dashboard.
									</span>
								</p>
							) : null}
						</div>
					) : flashBlockedReason ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							{flashBlockedReason}
						</p>
					) : null}

					{issue ? (
						<p className="text-xs font-medium text-destructive">{issue}</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
