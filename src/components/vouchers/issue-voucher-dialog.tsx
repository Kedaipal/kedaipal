import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { AlertTriangle, Check, Loader2, Lock, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	composeFulfilmentMoment,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	minSpendError,
	perBuyerLimitError,
	SHARED_CODE_MAX,
	SHARED_CODE_MIN,
	SHARED_PERCENT_CAUTION,
	SHARED_USES_MAX,
	sharedCodeError,
	sharedLimitsError,
	sharedStartError,
	suggestSharedCodes,
	VOUCHER_BATCH_MAX,
	VOUCHER_NOTE_MAX,
	type VoucherStatus,
	type VoucherUsage,
	voucherValueError,
} from "../../../convex/lib/vouchers";
import { useDebounce } from "../../hooks/useDebounce";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import { DatePicker } from "../ui/date-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { InputPrefixFrame } from "../ui/input-prefix-frame";
import { ModeButton } from "../ui/mode-button";
import { TimePicker } from "../ui/time-picker";
import { LimitRow } from "./limit-row";

/**
 * Issue one voucher, a run of them, or one SHARED code (`z8r3fdr617`,
 * `z8r3fducfm`).
 *
 * The form makes the decisions that matter obvious — who can use it, what it
 * is worth, how long it lasts, how many — and refuses nothing the server would
 * accept: every check is the SHARED helper the server runs
 * (`voucherValueError`, `sharedCodeError`, `sharedLimitsError`), so the
 * disabled-with-reason button and the server's refusal can never disagree. The
 * one rule the client can't run alone — is this word already running? — is
 * asked live, through the same lookup the redemption door uses.
 *
 * "Who can use it" leads, because it changes the shape of everything below:
 * a single-use voucher is minted and counted; a shared code is NAMED and
 * bounded. Both are `ModeButton` pairs rather than a mode-less field, because
 * each is genuinely a pick-one. The shared code's two bounds are NOT a pick-
 * one — a cap, an end time, or both — so they are two switches, and the copy
 * says what happens when both are on ("whichever comes first").
 *
 * Deliberate copy, each line answering something a seller would otherwise have
 * to discover the hard way: a voucher is single-use (said here, not learned
 * when the second buyer is turned away), a shared code cannot run unbounded
 * (said here, not when the 500th stranger uses it), and the discount comes off
 * the ITEMS, never delivery — the guard rail most likely to surprise whoever
 * just gave away "RM50 off".
 */
export function IssueVoucherDialog({
	open,
	onClose,
	retailerId,
	currency,
	onIssued,
}: {
	open: boolean;
	onClose: () => void;
	retailerId: Id<"retailers">;
	currency: string;
	/** Hands back the freshly minted run so the page can open the share sheet
	 * on a single voucher — issuing and sending are one errand. */
	onIssued: (vouchers: Array<{ code: string; status: VoucherStatus }>) => void;
}) {
	const createVoucher = useMutation(api.vouchers.create);
	const [usage, setUsage] = useState<VoucherUsage>("single");
	const [kind, setKind] = useState<"fixed" | "percent">("fixed");
	const [amount, setAmount] = useState("");
	const [percent, setPercent] = useState("10");
	const [expires, setExpires] = useState(false);
	const [expiryYmd, setExpiryYmd] = useState("");
	const [note, setNote] = useState("");
	const [count, setCount] = useState("1");
	// Shared-code state (`z8r3fducfm`).
	const [sharedCode, setSharedCode] = useState("");
	const [suggestionSeed, setSuggestionSeed] = useState(0);
	const [capOn, setCapOn] = useState(true);
	const [cap, setCap] = useState("50");
	const [endOn, setEndOn] = useState(false);
	const [endYmd, setEndYmd] = useState("");
	const [endHhmm, setEndHhmm] = useState("23:59");
	// v2 (`z8r3fdz0pw`). The per-buyer limit is ON by default for a shared
	// code: without it a public code is reusable by one buyer until the cap,
	// which is the abuse case the limit exists for — the safe answer is the
	// one a seller gets without reading anything.
	const [startLater, setStartLater] = useState(false);
	const [startYmd, setStartYmd] = useState("");
	const [startHhmm, setStartHhmm] = useState("09:00");
	const [perBuyerOn, setPerBuyerOn] = useState(true);
	const [perBuyer, setPerBuyer] = useState("1");
	const [minSpendOn, setMinSpendOn] = useState(false);
	const [minSpendText, setMinSpendText] = useState("");
	const [maxDiscOn, setMaxDiscOn] = useState(false);
	const [maxDiscText, setMaxDiscText] = useState("");
	const [saving, setSaving] = useState(false);

	function reset() {
		setUsage("single");
		setKind("fixed");
		setAmount("");
		setPercent("10");
		setExpires(false);
		setExpiryYmd("");
		setNote("");
		setCount("1");
		setSharedCode("");
		setCapOn(true);
		setCap("50");
		setEndOn(false);
		setEndYmd("");
		setEndHhmm("23:59");
		setStartLater(false);
		setStartYmd("");
		setStartHhmm("09:00");
		setPerBuyerOn(true);
		setPerBuyer("1");
		setMinSpendOn(false);
		setMinSpendText("");
		setMaxDiscOn(false);
		setMaxDiscText("");
	}

	const shared = usage === "shared";

	// Minor units. An empty field is "nothing entered yet" — invalid, but it
	// must not shout at someone who hasn't typed anything.
	const parsed =
		kind === "fixed"
			? Math.round(Number.parseFloat(amount.replace(/,/g, "")) * 100)
			: Number.parseInt(percent, 10);
	const value = Number.isFinite(parsed) ? parsed : 0;
	const touched =
		kind === "fixed" ? amount.trim() !== "" : percent.trim() !== "";
	// The per-order cap only exists on a percentage — a fixed amount is its
	// own cap — so switching to "An amount" drops it rather than hiding a
	// value the server would refuse (`z8r3fdz0pw`).
	const maxDiscount =
		kind === "percent" && maxDiscOn ? sen(maxDiscText) : undefined;
	const valueError = touched ? voucherValueError({ kind, value }) : null;
	// The cap's own sentence, under the cap — judged by the same helper with
	// the cap in, once the value itself is fine.
	const maxDiscError =
		maxDiscount !== undefined && valueError === null
			? voucherValueError({ kind, value: touched ? value : 1, maxDiscount })
			: null;
	const minSpend = minSpendOn ? sen(minSpendText) : undefined;
	const spendError = minSpendOn ? minSpendError(minSpend) : null;
	// Arif's 50% ceiling, decided as a CAUTION and not a refusal (docs/
	// vouchers.md "The percent ceiling"): "first 10 orders free" is a real
	// promotion, and the bounds — not the percentage — are what limit a
	// public code. The line names those bounds.
	const caution =
		usage === "shared" &&
		kind === "percent" &&
		value >= SHARED_PERCENT_CAUTION &&
		valueError === null &&
		!maxDiscOn
			? perBuyerOn
				? `${value}% off for anyone with the word. Consider capping it per order, so one big basket can't take most of it.`
				: `${value}% off for anyone with the word, as many times as they like. Consider a per-buyer limit or a cap per order.`
			: null;

	const howMany = Number.parseInt(count, 10);
	const countError =
		!Number.isInteger(howMany) || howMany < 1
			? "Enter how many to create"
			: howMany > VOUCHER_BATCH_MAX
				? `${VOUCHER_BATCH_MAX} at a time, max`
				: null;

	const expiryError =
		expires && expiryYmd === "" ? "Pick an expiry date" : null;

	// ── Shared code: the word ──────────────────────────────────────────────
	// Untouched is "nothing typed yet", not an error to shout about.
	const codeTouched = sharedCode.trim() !== "";
	const codeError = codeTouched ? sharedCodeError(sharedCode) : null;
	// The live uniqueness check — the ONE rule the client can't run alone.
	// Debounced so a seller mid-word isn't asking the server per keystroke,
	// and skipped until the word could be a code at all.
	const debouncedCode = useDebounce(sharedCode.trim().toUpperCase(), 300);
	const askAvailability =
		shared && codeTouched && codeError === null && debouncedCode !== "";
	const availability = useQuery(
		convexQuery(
			api.vouchers.sharedCodeAvailable,
			askAvailability ? { retailerId, code: debouncedCode } : "skip",
		),
	).data;
	// Only trust an answer about the word currently in the box.
	const availabilityCurrent =
		availability !== undefined &&
		availability.code === sharedCode.trim().toUpperCase();
	const taken = availabilityCurrent && availability.available === false;
	// The word the ANSWER is about — equal to the box whenever
	// `availabilityCurrent`, so the line can never name a word mid-debounce.
	const answeredCode = availabilityCurrent ? availability.code : null;
	// Suggestions follow the value ("SAVE20" for 20%), reshuffled on demand.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the seed exists only to force a reshuffle
	const suggestions = useMemo(
		() => suggestSharedCodes({ kind, value }),
		[kind, value, suggestionSeed],
	);

	// ── Shared code: the bounds ────────────────────────────────────────────
	const capNumber = Number.parseInt(cap, 10);
	const endsAt =
		endOn && endYmd !== ""
			? composeFulfilmentMoment(
					mytMidnightFromYmd(endYmd),
					timeMinutesFromHhmm(endHhmm),
				)
			: undefined;
	const startsAt =
		startLater && startYmd !== ""
			? composeFulfilmentMoment(
					mytMidnightFromYmd(startYmd),
					timeMinutesFromHhmm(startHhmm),
				)
			: undefined;
	const perBuyerNumber = Number.parseInt(perBuyer, 10);
	const limitsError = shared
		? sharedLimitsError(
				{
					maxRedemptions: capOn ? capNumber : undefined,
					// A switched-on end with no date yet is "unfinished", and the
					// shared helper's "pick when it ends" is the right sentence.
					endsAt: endOn ? (endsAt ?? Number.NaN) : undefined,
				},
				Date.now(),
			)
		: null;
	// Split from the bounds' check so each sentence sits under the control
	// it is about; the server runs them as one (`sharedLimitsError`).
	const startError =
		shared && startLater
			? sharedStartError(
					startsAt ?? Number.NaN,
					endOn ? endsAt : undefined,
					Date.now(),
				)
			: null;
	const perBuyerError =
		shared && perBuyerOn
			? perBuyerLimitError(perBuyerNumber, capOn ? capNumber : undefined)
			: null;

	const blocked = !touched
		? "Enter what the voucher is worth"
		: valueError !== null
			? valueError
			: maxDiscError !== null
				? maxDiscError
				: shared
					? !codeTouched
						? "Name the code, or pick a suggestion"
						: (codeError ??
							(taken ? `${answeredCode} is already taken` : null) ??
							startError ??
							limitsError ??
							perBuyerError ??
							spendError)
					: (countError ?? expiryError ?? spendError);

	async function submit() {
		if (blocked !== null) return;
		setSaving(true);
		try {
			const { vouchers } = await createVoucher(
				shared
					? {
							retailerId,
							usage: "shared",
							kind,
							value,
							code: sharedCode.trim().toUpperCase(),
							maxRedemptions: capOn ? capNumber : undefined,
							endsAt,
							startsAt,
							perBuyerLimit: perBuyerOn ? perBuyerNumber : undefined,
							minSpend,
							maxDiscount,
							note: note.trim() || undefined,
						}
					: {
							retailerId,
							kind,
							value,
							expiresAt:
								expires && expiryYmd !== ""
									? mytMidnightFromYmd(expiryYmd)
									: undefined,
							note: note.trim() || undefined,
							count: howMany > 1 ? howMany : undefined,
							minSpend,
							maxDiscount,
						},
			);
			toast.success(
				shared
					? startsAt !== undefined
						? `${vouchers[0].code} is set up — it starts working at the time you picked`
						: `${vouchers[0].code} is live — share it anywhere`
					: vouchers.length === 1
						? `Voucher ${vouchers[0].code} created`
						: `${vouchers.length} vouchers created`,
			);
			reset();
			onIssued(vouchers);
			onClose();
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Couldn't create the voucher",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o && !saving) {
					reset();
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New voucher</DialogTitle>
					<DialogDescription>
						{shared
							? "One code everyone can use — on a poster, in a story, in your group chat. The discount comes off the items — never delivery or a deposit."
							: "Each code works once, on one order. The discount comes off the items — never delivery or a deposit."}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-5">
					{/* Leads because it reshapes the form: a single-use voucher is
					    minted and counted, a shared code is named and bounded. */}
					<Field>
						<FieldLabel>Who can use it</FieldLabel>
						<div className="grid grid-cols-2 gap-2">
							<ModeButton
								active={!shared}
								onClick={() => setUsage("single")}
								title="One buyer"
								subtitle="A unique code, used once"
							/>
							<ModeButton
								active={shared}
								onClick={() => setUsage("shared")}
								title="Everyone"
								subtitle="A code you name, used many times"
							/>
						</div>
					</Field>

					<Field>
						<FieldLabel htmlFor="voucher-worth">What it takes off</FieldLabel>
						<div className="grid grid-cols-2 gap-2">
							<ModeButton
								active={kind === "fixed"}
								onClick={() => setKind("fixed")}
								title="An amount"
								subtitle={`${currencySymbol(currency)} off the order`}
							/>
							<ModeButton
								active={kind === "percent"}
								onClick={() => setKind("percent")}
								title="A percentage"
								subtitle="% off the items"
							/>
						</div>
						{/* Both modes wear the SAME plate frame at the SAME width, so
						    switching between them doesn't move the field or the
						    helper line under it. Keep BOTH helper lines to ONE line at
						    this dialog width: they differ per mode, so a two-line one
						    makes the dialog jump height on a mode switch — and at
						    783px of room it then clipped the Create button on open. The percentage plate sits on
						    the RIGHT (a percent follows its number; a currency
						    precedes it), which also stops "%" reading as a stray
						    glyph before an empty field.

						    Sized to its content, not to the dialog: a price and a
						    percentage are both SHORT quantities, and a full-bleed box
						    strands the unit an inch from its number — the "How many"
						    field below already sets the house shape for a numeric
						    answer. */}
						{kind === "fixed" ? (
							<InputPrefixFrame
								prefix={currencySymbol(currency)}
								invalid={valueError !== null}
								className={VALUE_FIELD_WIDTH}
							>
								<Input
									id="voucher-worth"
									variant="bare"
									inputMode="decimal"
									placeholder="10.00"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									isError={valueError !== null}
								/>
							</InputPrefixFrame>
						) : (
							<InputPrefixFrame
								prefix="%"
								side="end"
								invalid={valueError !== null}
								className={VALUE_FIELD_WIDTH}
							>
								<Input
									id="voucher-worth"
									variant="bare"
									inputMode="numeric"
									placeholder="10"
									value={percent}
									onChange={(e) => setPercent(e.target.value)}
									isError={valueError !== null}
								/>
							</InputPrefixFrame>
						)}
						{valueError ? (
							<p role="alert" className="text-xs font-medium text-destructive">
								{valueError}
							</p>
						) : (
							<FieldDescription>
								{kind === "fixed"
									? `Capped at the item total — ${formatPrice(5000, currency)} off a ${formatPrice(3000, currency)} basket takes ${formatPrice(3000, currency)}.`
									: "Taken off the item total, after any promo prices."}
							</FieldDescription>
						)}
						{/* Part of the TERMS, so it lives with the value it bounds
						    rather than among the entry rules below: it shapes the
						    figure on every order, and is frozen with it. A fixed
						    amount is already its own cap, so it is offered on a
						    percentage only. */}
						{kind === "percent" ? (
							<LimitRow
								on={maxDiscOn}
								onChange={setMaxDiscOn}
								title="Cap the discount"
								subtitle="The most it takes off one order."
							>
								<InputPrefixFrame
									prefix={currencySymbol(currency)}
									invalid={maxDiscError !== null && maxDiscText.trim() !== ""}
									className={VALUE_FIELD_WIDTH}
								>
									<Input
										aria-label="Most it takes off one order"
										variant="bare"
										inputMode="decimal"
										placeholder="20.00"
										value={maxDiscText}
										onChange={(e) => setMaxDiscText(e.target.value)}
										isError={maxDiscError !== null && maxDiscText.trim() !== ""}
									/>
								</InputPrefixFrame>
								{maxDiscError !== null && maxDiscText.trim() !== "" ? (
									<p
										role="alert"
										className="text-xs font-medium text-destructive"
									>
										{maxDiscError}
									</p>
								) : (
									<p className="text-xs text-muted-foreground">
										{maxDiscount !== undefined &&
										maxDiscError === null &&
										value > 0
											? `${value}% off, up to ${formatPrice(maxDiscount, currency)}. A basket over ${formatPrice(Math.ceil((maxDiscount * 100) / value), currency)} gets the full ${formatPrice(maxDiscount, currency)}.`
											: "Buyers see the cap next to the code."}
									</p>
								)}
							</LimitRow>
						) : null}
						{caution ? (
							<p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
								<AlertTriangle
									className="mt-px size-3.5 shrink-0"
									aria-hidden
								/>
								{caution}
							</p>
						) : null}
					</Field>

					{shared ? (
						<>
							{/* The word. Suggested, never imposed: the chips give a
							    seller who has no code in mind something to tap, and the
							    availability line answers the one question the form
							    can't answer offline. */}
							<Field>
								<FieldLabel htmlFor="voucher-shared-code">The code</FieldLabel>
								<Input
									id="voucher-shared-code"
									variant="field"
									autoCapitalize="characters"
									autoComplete="off"
									spellCheck={false}
									maxLength={SHARED_CODE_MAX}
									placeholder="SALE345"
									value={sharedCode}
									onChange={(e) => setSharedCode(e.target.value.toUpperCase())}
									isError={codeError !== null || taken}
									className="max-w-60 font-mono uppercase tracking-wider"
								/>
								<div className="flex flex-wrap items-center gap-1.5">
									{suggestions.map((s) => (
										<button
											key={s}
											type="button"
											onClick={() => setSharedCode(s)}
											className={`tap-target rounded-full border px-2.5 font-mono text-xs font-semibold tracking-wider transition-colors ${
												sharedCode === s
													? "border-accent bg-accent/10 text-accent-emphasis"
													: "border-border text-foreground hover:border-accent/50"
											}`}
										>
											{s}
										</button>
									))}
									<button
										type="button"
										onClick={() => setSuggestionSeed((n) => n + 1)}
										className="tap-target flex items-center gap-1 rounded-full px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
										aria-label="More suggestions"
									>
										<RefreshCw className="size-3.5" aria-hidden />
										More
									</button>
								</div>
								{codeError ? (
									<p
										role="alert"
										className="text-xs font-medium text-destructive"
									>
										{codeError}
									</p>
								) : taken ? (
									<p
										role="alert"
										className="text-xs font-medium text-destructive"
									>
										{answeredCode} is already running — void it or let it end
										before reusing the word.
									</p>
								) : availabilityCurrent && availability.available ? (
									<p className="flex items-center gap-1 text-xs font-medium text-accent-emphasis">
										<Check className="size-3.5" aria-hidden />
										{answeredCode} is free
									</p>
								) : null}
								{/* Always on, under whatever the word's status is: a seller
								    picking VIP50 for "my regulars" needs to know a shared
								    word is a public word — anyone who has it, or guesses
								    it, can use it. The bounds are what limit it. */}
								<FieldDescription>
									{SHARED_CODE_MIN}–{SHARED_CODE_MAX} letters and numbers,
									capitals don't matter. It isn't secret: anyone who has the
									word, or guesses it, can use it.
								</FieldDescription>
							</Field>

							{/* When it STARTS — a pick-one, like the single-use expiry
							    (`z8r3fdz0pw`). Before the bounds, because that is the
							    order a sale runs in. */}
							<Field>
								<FieldLabel>When it starts</FieldLabel>
								<div className="grid grid-cols-2 gap-2">
									<ModeButton
										active={!startLater}
										onClick={() => setStartLater(false)}
										title="Right away"
										subtitle="Works as soon as it's created"
									/>
									<ModeButton
										active={startLater}
										onClick={() => {
											setStartLater(true);
											if (startYmd === "")
												setStartYmd(
													ymdFromEpoch(todayMytMidnight() + 86_400_000),
												);
										}}
										title="Later…"
										subtitle="Set it up ahead"
									/>
								</div>
								{startLater ? (
									<>
										<div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
											<DatePicker
												id="voucher-start-date"
												label="First day"
												value={startYmd}
												onChange={setStartYmd}
												min={ymdFromEpoch(todayMytMidnight())}
												isError={startError !== null}
											/>
											<TimePicker
												aria-label="Start time"
												value={startHhmm}
												onChange={setStartHhmm}
											/>
										</div>
										{startError ? (
											<p
												role="alert"
												className="text-xs font-medium text-destructive"
											>
												{startError}
											</p>
										) : (
											<FieldDescription>
												Until then it shows as Scheduled, and a buyer who types
												it early is told when it starts.
											</FieldDescription>
										)}
									</>
								) : null}
							</Field>

							{/* The bounds. Two switches, not a pick-one: a cap, an end
							    time, or both, and at least one — a public code with no
							    bound is a liability, and the reason sits on the button. */}
							<Field>
								<FieldLabel>When it stops working</FieldLabel>
								<div className="flex flex-col gap-2">
									<LimitRow
										on={capOn}
										onChange={setCapOn}
										title="Limit how many orders can use it"
										subtitle="First come, first served."
									>
										<div className="flex items-center gap-3">
											<Input
												id="voucher-cap"
												aria-label="How many orders"
												variant="field"
												inputMode="numeric"
												value={cap}
												onChange={(e) => setCap(e.target.value)}
												isError={
													capOn &&
													(!Number.isInteger(capNumber) ||
														capNumber < 1 ||
														capNumber > SHARED_USES_MAX)
												}
												className="max-w-28"
											/>
											<span className="text-sm text-muted-foreground">
												orders in total
											</span>
										</div>
									</LimitRow>
									<LimitRow
										on={endOn}
										onChange={(on) => {
											setEndOn(on);
											// Default to the end of today — "today only" is the
											// common sale — rather than an empty date that reads
											// as unfinished.
											if (on && endYmd === "")
												setEndYmd(ymdFromEpoch(todayMytMidnight()));
										}}
										title="End at a set time"
										subtitle="In your store's time."
									>
										<div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-2">
											<DatePicker
												id="voucher-end-date"
												label="Last day"
												value={endYmd}
												onChange={setEndYmd}
												min={ymdFromEpoch(todayMytMidnight())}
											/>
											<TimePicker
												aria-label="End time"
												value={endHhmm}
												onChange={setEndHhmm}
											/>
										</div>
									</LimitRow>
								</div>
								{limitsError && (capOn || endOn) ? (
									<p
										role="alert"
										className="text-xs font-medium text-destructive"
									>
										{limitsError}
									</p>
								) : (
									<FieldDescription>
										{capOn && endOn
											? "Whichever comes first ends it — buyers after that are told the code has run out or ended."
											: capOn
												? "Once that many orders have used it, the next buyer is told it has run out."
												: endOn
													? "After that moment, buyers are told the code has ended."
													: "Pick at least one — a shared code can't run forever."}
									</FieldDescription>
								)}
							</Field>
						</>
					) : (
						<>
							<Field>
								<FieldLabel>Expiry</FieldLabel>
								<div className="grid grid-cols-2 gap-2">
									<ModeButton
										active={!expires}
										onClick={() => setExpires(false)}
										title="Never expires"
										subtitle="Works until used or voided"
									/>
									<ModeButton
										active={expires}
										onClick={() => setExpires(true)}
										title="Expires on…"
										subtitle="Last day it works"
									/>
								</div>
								{expires ? (
									<>
										<DatePicker
											id="voucher-expiry"
											label="Last day"
											value={expiryYmd}
											onChange={setExpiryYmd}
											min={ymdFromEpoch(todayMytMidnight())}
											isError={expiryError !== null}
										/>
										<FieldDescription>
											Works all through that day, in your store's time.
										</FieldDescription>
									</>
								) : null}
							</Field>

							<Field>
								<FieldLabel htmlFor="voucher-count">How many</FieldLabel>
								<Input
									id="voucher-count"
									variant="field"
									inputMode="numeric"
									value={count}
									onChange={(e) => setCount(e.target.value)}
									isError={countError !== null}
									className="max-w-28"
								/>
								{countError ? (
									<p
										role="alert"
										className="text-xs font-medium text-destructive"
									>
										{countError}
									</p>
								) : (
									<FieldDescription>
										{howMany > 1
											? `${howMany} separate codes, each good for one order. You can share or void the whole run together.`
											: "One code, for one order."}
									</FieldDescription>
								)}
							</Field>
						</>
					)}

					{/* WHO QUALIFIES — the entry rules (`z8r3fdz0pw`), judged once
					    when an order uses the code. Their own group, apart from
					    the value (what it takes off) and the bounds (when the code
					    stops for everyone): these are about one buyer and one
					    basket. The per-buyer limit only means something for a
					    code many people share. */}
					<Field>
						<FieldLabel>Who qualifies</FieldLabel>
						<div className="flex flex-col gap-2">
							{shared ? (
								<LimitRow
									on={perBuyerOn}
									onChange={setPerBuyerOn}
									title="Limit per buyer"
									subtitle="Counted by WhatsApp number."
								>
									<div className="flex items-center gap-3">
										<Input
											aria-label="Orders per buyer"
											variant="field"
											inputMode="numeric"
											value={perBuyer}
											onChange={(e) => setPerBuyer(e.target.value)}
											isError={perBuyerError !== null}
											className="max-w-20"
										/>
										<span className="text-sm text-muted-foreground">
											{perBuyerNumber === 1 ? "order" : "orders"} per buyer
										</span>
									</div>
									{perBuyerError ? (
										<p
											role="alert"
											className="text-xs font-medium text-destructive"
										>
											{perBuyerError}
										</p>
									) : (
										<p className="text-xs text-muted-foreground">
											Checked against the buyer's WhatsApp number at checkout. A
											counter sale with no number counts toward the total only.
										</p>
									)}
								</LimitRow>
							) : null}
							<LimitRow
								on={minSpendOn}
								onChange={setMinSpendOn}
								title="Minimum spend"
								subtitle="On the items, before any discount."
							>
								<InputPrefixFrame
									prefix={currencySymbol(currency)}
									invalid={spendError !== null}
									className={VALUE_FIELD_WIDTH}
								>
									<Input
										aria-label="Least a buyer spends on items"
										variant="bare"
										inputMode="decimal"
										placeholder="50.00"
										value={minSpendText}
										onChange={(e) => setMinSpendText(e.target.value)}
										isError={spendError !== null}
									/>
								</InputPrefixFrame>
								{spendError ? (
									<p
										role="alert"
										className="text-xs font-medium text-destructive"
									>
										{spendError}
									</p>
								) : (
									<p className="text-xs text-muted-foreground">
										Checked once, when the order is placed. A buyer below it is
										told how much more to add.
									</p>
								)}
							</LimitRow>
						</div>
						{shared && !perBuyerOn ? (
							<FieldDescription>
								With no per-buyer limit, one buyer can use it again and again
								until it stops working.
							</FieldDescription>
						) : null}
					</Field>

					{/* For a RUN this is the batch's name: the list groups a batch
					    under it, so it is the handle the seller gets the whole run
					    back by. Still optional — an unnamed run falls back to its
					    size and date — but asked for here, where the run exists,
					    rather than only as a rename afterwards. A single voucher
					    keeps the quieter "label"; a shared code has its WORD as the
					    handle, so the label is purely a private note. */}
					<Field>
						<FieldLabel htmlFor="voucher-note">
							{!shared && howMany > 1 ? "Batch name" : "Label"}{" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
						</FieldLabel>
						<Input
							id="voucher-note"
							variant="field"
							maxLength={VOUCHER_NOTE_MAX}
							placeholder={
								shared
									? "Merdeka weekend"
									: howMany > 1
										? "Raya market stack"
										: "Raya giveaway"
							}
							value={note}
							onChange={(e) => setNote(e.target.value)}
						/>
						<FieldDescription>
							{shared
								? "Only you see this — what the code was for, once it's ended."
								: howMany > 1
									? "Only you see it. The list groups these codes under this name — without one they show as “" +
										`${howMany} vouchers · today”.`
									: "Only you see this — it's how you'll tell look-alike codes apart in three months."}
						</FieldDescription>
					</Field>
				</div>

				{/* The reason the action is off — in a tooltip nobody opens, it is
				    invisible; as a bare muted line under the last field, it reads as
				    a THIRD hint for the Label textarea (which is exactly how it
				    looked when rendered). So it is separated from the form, carries
				    the lock glyph, and sits in the action zone it belongs to. */}
				{blocked !== null && !saving ? (
					<p className="flex items-start gap-1.5 border-t border-border pt-3 text-xs font-medium text-muted-foreground">
						<Lock className="mt-px size-3.5 shrink-0" aria-hidden />
						{blocked}
					</p>
				) : null}
				<DialogFooter>
					<Button
						variant="outline"
						className="tap-target"
						onClick={() => {
							reset();
							onClose();
						}}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button
						className="tap-target gap-2"
						onClick={submit}
						disabled={blocked !== null || saving}
					>
						{saving ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : null}
						{shared
							? "Create code"
							: howMany > 1
								? `Create ${howMany} vouchers`
								: "Create voucher"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A typed money amount in minor units, or NaN while it isn't one — the
 * shared validators then say why. */
function sen(text: string): number {
	const parsed = Math.round(Number.parseFloat(text.replace(/,/g, "")) * 100);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** One width for both modes — wide enough for `1,000.00` behind an `RM`
 * plate, narrow enough that `%` still sits beside its number. */
const VALUE_FIELD_WIDTH = "max-w-40";

/** The store's own currency symbol for the plate — never a hardcoded "RM"
 * (an SG store bills in SGD, and the plate would be the first thing to lie). */
function currencySymbol(currency: string): string {
	return formatPrice(0, currency).replace(/[\d.,\s ]/g, "") || currency;
}
