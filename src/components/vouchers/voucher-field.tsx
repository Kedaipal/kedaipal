import { useMutation } from "convex/react";
import { Check, Clock, Loader2, Ticket, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	formatVoucherTerms,
	minSpendShortfall,
	parseVoucherCode,
	SHARED_CODE_MIN,
	type VoucherConditions,
	type VoucherTerms,
	voucherDiscountFor,
	voucherFinePrint,
	voucherRefusalMessage,
} from "../../../convex/lib/vouchers";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** An applied voucher, as both redemption surfaces hold it. */
export interface AppliedVoucher extends VoucherTerms {
	code: string;
	/** The entry rules the server reported (`z8r3fdz0pw`) — judged here
	 * against the live basket so the surface can say "spend RM12 more"
	 * without a round trip; the order door judges them for real. */
	conditions?: VoucherConditions;
	/** The buyer number a per-buyer code was last checked for, as stored. */
	checkedFor?: string;
}

/**
 * Does the applied voucher's minimum spend hold against this basket?
 * (`z8r3fdz0pw`) A code below its minimum stays APPLIED — the buyer may be
 * mid-basket, and the seller at the counter usually keys the code first — but
 * takes nothing off and is not sent with the order until it qualifies, so
 * the total on screen is always the total charged.
 */
export function voucherQualifies(
	applied: AppliedVoucher,
	itemSubtotal: number,
): boolean {
	return minSpendShortfall(applied.conditions?.minSpend, itemSubtotal) === 0;
}

/** The code an order door should receive: the applied code once it
 * qualifies, otherwise none. The ONE rule every submit path reads, so the
 * preview and the order can't disagree about whether the discount is on. */
export function voucherCodeForOrder(
	applied: AppliedVoucher | null,
	itemSubtotal: number,
): string | undefined {
	return applied && voucherQualifies(applied, itemSubtotal)
		? applied.code
		: undefined;
}

/**
 * The "Have a voucher?" control (`z8r3fdr617`) — ONE component for the two
 * surfaces that take a typed code: the storefront checkout (the buyer types
 * it, or arrives with it on a `?voucher=` link) and the counter panel (the
 * seller keys it off the buyer's QR). The house rule is one idea, one control:
 * a chip in one place and a different-looking box in the other is how an app
 * starts looking like two apps.
 *
 * Collapsed by default. An un-applied voucher field sitting open on every
 * checkout is a prompt to go hunting for a code nobody has, which costs
 * conversions on the majority of orders to serve the minority — so it is a
 * single quiet line until it is wanted, and OPENS ITSELF when a code arrived
 * on the link.
 *
 * Every state is drawn: closed, empty, checking, applied, refused. The refusal
 * is the one that matters — it renders UNDER THE FIELD, never as a toast, so a
 * bad code reads as "fix this one thing" rather than as the checkout breaking.
 * And the sen figure is computed locally with the SAME shared helper the
 * server uses, so the preview and the charge agree without a round-trip on
 * every quantity change.
 */
export function VoucherField({
	retailerId,
	currency,
	itemSubtotal,
	applied,
	onApply,
	onRemove,
	initialCode,
	disabled = false,
	label = "Have a voucher?",
	serverRefusal,
	variant = "panel",
	buyer,
	anonymousBuyer = false,
	refusedCode,
}: {
	retailerId: Id<"retailers">;
	currency: string;
	/** Pre-discount item subtotal, for the preview figure. */
	itemSubtotal: number;
	applied: AppliedVoucher | null;
	onApply: (voucher: AppliedVoucher) => void;
	onRemove: () => void;
	/** From `?voucher=` — applied on mount, with the panel open so the buyer
	 * can see what landed (and remove it) rather than finding a mystery
	 * discount on their total. */
	initialCode?: string;
	disabled?: boolean;
	label?: string;
	/**
	 * A refusal the SERVER gave at order create (`z8r3fdr617`). The door
	 * re-validates and can refuse a code the field happily checked moments
	 * earlier — someone else spent it, the seller voided it — and that answer
	 * belongs where the buyer applied it, not in a page-level banner above a
	 * ticket still showing the discount.
	 *
	 * Rendered, never synced into state: the parent clears the applied voucher
	 * at the same moment, so the ticket's total corrects itself and this is
	 * just the sentence explaining why.
	 */
	serverRefusal?: string;
	/**
	 * Which house the control is standing in. `panel` is the dashboard's
	 * (bordered input + outline button); `receipt` is the buyer's Order
	 * Ticket, where the same control wears mono type, a dotted leader and a
	 * stamped APPLY so it reads as a line of the printed receipt rather than
	 * a form dropped on top of one.
	 *
	 * One control, two skins — deliberately NOT two components: the states,
	 * the normalisation, the refusal copy and the shared discount maths are
	 * the thing that must never diverge, and they don't.
	 */
	variant?: "panel" | "receipt";
	/**
	 * The buyer's WhatsApp number when the surface already knows it — the
	 * counter's bound session (`z8r3fdz0pw`). Sent with the check so a
	 * per-buyer code is judged for THIS buyer before the seller rings it up.
	 */
	buyer?: {
		waPhone: string;
		waDialCountry?: string;
		/** The number as an order stores it (E.164 digits) — compared with
		 * `checkedFor` to know whether the applied code was judged for THIS
		 * number or an earlier one. */
		digits?: string;
		/** How the page prints the number ("012-345 6789"). */
		label?: string;
	};
	/**
	 * An anonymous counter sale: there is no number to count, so a per-buyer
	 * code's use counts against its total only — and the panel says so,
	 * because otherwise the seller would assume the limit protected them.
	 */
	anonymousBuyer?: boolean;
	/** The code the host took off with `serverRefusal` — put back in the box
	 * so the sentence is visibly about it (`z8r3fdz0pw`). */
	refusedCode?: string;
}) {
	const checkCode = useMutation(api.vouchers.checkCode);
	const [openedByBuyer, setOpen] = useState(initialCode !== undefined);
	// Forced open while a server refusal stands: it is the only place the
	// sentence can sit, and the parent has just removed the code that was on
	// the ticket.
	const open = openedByBuyer || serverRefusal !== undefined;
	const [code, setCode] = useState("");
	const [checking, setChecking] = useState(false);
	const [ownRefusal, setRefusal] = useState<string | null>(null);
	// A code the host took off for THIS buyer (`z8r3fdz0pw`, flow A) stays
	// typed in the box, so the buyer sees which code the sentence is about.
	useEffect(() => {
		if (refusedCode !== undefined) setCode(refusedCode);
	}, [refusedCode]);
	// The field's own answer wins while it has one — the buyer has typed since
	// the server spoke, so the newer sentence is the true one.
	const refusal = ownRefusal ?? serverRefusal ?? null;

	const apply = useCallback(
		async (raw: string) => {
			const typed = raw.trim();
			if (typed === "") return;
			setChecking(true);
			setRefusal(null);
			try {
				const result = await checkCode({
					retailerId,
					code: typed,
					...(buyer
						? { waPhone: buyer.waPhone, waDialCountry: buyer.waDialCountry }
						: {}),
				});
				if (result.ok) {
					onApply({
						code: result.code,
						...result.terms,
						conditions: result.conditions,
						checkedFor: result.checkedFor,
					});
					setCode("");
				} else {
					// Including a dead code that arrived on a shared LINK: say so
					// plainly rather than pricing at full and letting the buyer
					// wonder where the discount went. The sentence has ONE author
					// (convex/lib/vouchers.ts), shared with the server's refusal —
					// re-worded here only to spell money the way this page does.
					setRefusal(
						voucherRefusalMessage(
							result.refusal,
							{ usedOnOrder: result.usedOnOrder, ...result.detail },
							formatPrice,
						),
					);
				}
			} catch {
				// Rate limiter, or the network. Never block the checkout over it —
				// the buyer can place the order without the voucher, or retry.
				setRefusal(
					"Couldn't check that code just now — try again in a moment.",
				);
			} finally {
				setChecking(false);
			}
		},
		[checkCode, onApply, retailerId, buyer],
	);

	// Apply a link-borne code exactly once.
	const autoApplied = useRef(false);
	useEffect(() => {
		if (autoApplied.current || initialCode === undefined) return;
		autoApplied.current = true;
		void apply(initialCode);
	}, [initialCode, apply]);

	// Typed-but-unapplied guess, so Apply can disable until the code could be
	// real rather than refusing a half-typed one at the server. Either
	// spelling — a `KP-…` single-use code or a shared word (`z8r3fducfm`).
	const guess = parseVoucherCode(code);
	const receipt = variant === "receipt";

	// ── APPLIED ─────────────────────────────────────────────────────────────
	// On the RECEIPT the discount is already stated by its own line in the
	// money block, so a second green panel repeating it is noise. The caller
	// renders that line; this control then only has to offer the way out, and
	// it does so exactly like a product line does — tap to disclose, trash in
	// the same icon well (`z8r3fdr617`, Zaki 12 Oct).
	if (applied) {
		const worth = formatVoucherTerms(applied, (sen) =>
			formatPrice(sen, currency),
		);
		const notes = voucherNoteLines({
			applied,
			itemSubtotal,
			currency,
			buyer,
			anonymousBuyer,
			skin: variant,
		});
		if (receipt) {
			// Only the way out: the notes sit under the voucher LINE, where they
			// are visible without opening it (`VoucherNotes`).
			return (
				<div className="flex flex-col">
					<div className="flex items-center justify-between gap-3 pb-1 pt-0.5">
						<button
							type="button"
							onClick={onRemove}
							disabled={disabled}
							className="flex w-fit items-center gap-1 rounded-lg pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
							aria-label={`Remove voucher ${applied.code}`}
						>
							<span className="tap-target flex size-8 shrink-0 items-center justify-center">
								<Trash2 className="size-4" aria-hidden />
							</span>
							Remove voucher
						</button>
						<span className="shrink-0 text-xs text-muted-foreground">
							{worth}
						</span>
					</div>
				</div>
			);
		}
		return (
			// Under its minimum the code is held, not applied: no tick and no
			// accent, or the panel would say "on" beside a total without it.
			<div
				className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
					notes.pending
						? "border-border bg-muted/40"
						: "border-accent/40 bg-accent/5"
				}`}
			>
				{notes.pending ? (
					<Clock
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden
					/>
				) : (
					<Check className="size-4 shrink-0 text-accent-emphasis" aria-hidden />
				)}
				<div className="min-w-0 flex-1">
					<p
						className={`truncate text-sm font-semibold ${
							notes.pending ? "text-foreground" : "text-accent-emphasis"
						}`}
					>
						{notes.pending ? `${worth} — not yet` : `${worth} applied`}
					</p>
					<p className="truncate font-mono text-[11px] text-muted-foreground">
						{applied.code}
						{notes.finePrint ? ` · ${notes.finePrint}` : ""}
					</p>
					{notes.pending ? (
						<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
							{notes.pending}
						</p>
					) : null}
					{notes.perBuyer ? (
						<p
							className={`text-xs ${
								notes.checked ? "text-accent-emphasis" : "text-muted-foreground"
							}`}
						>
							{notes.perBuyer}
						</p>
					) : null}
				</div>
				<button
					type="button"
					onClick={onRemove}
					disabled={disabled}
					className="tap-target flex shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
					aria-label={`Remove voucher ${applied.code}`}
				>
					Remove
				</button>
			</div>
		);
	}

	// ── CLOSED ──────────────────────────────────────────────────────────────
	// One quiet line. On the receipt it is a peer of "+ Add more items" and
	// wears the ticket's caption type, so the footer reads as two actions of
	// equal weight rather than a stray link.
	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={disabled}
				className={
					receipt
						? "tap-target flex w-fit items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-emphasis disabled:opacity-50"
						: "tap-target flex w-fit items-center gap-1.5 text-sm font-semibold text-accent-emphasis underline-offset-2 hover:underline disabled:opacity-50"
				}
			>
				{receipt ? "+ Voucher code" : <Ticket className="size-4" aria-hidden />}
				{receipt ? null : label}
			</button>
		);
	}

	// ── OPEN ────────────────────────────────────────────────────────────────
	// The receipt skin IS a receipt line: ticket glyph, mono field on the same
	// dotted leader every charge row uses, and a stamped APPLY in the TOTAL's
	// type. Nothing new enters the ticket's grammar, which is the whole point
	// — the old chrome input and outline button read as a form dropped into a
	// printed receipt.
	if (receipt) {
		return (
			<div className="flex flex-col">
				<div className="flex items-center gap-2 py-1 font-mono text-[13px] leading-6">
					{/* Centred on the ROW, the glyph reads LOW against the code:
					    the input carries `pb-0.5` and a 2px dotted rule, so ~4px
					    of its box sits under the text and drags the row's centre
					    down with it. Lift the icon by that much to sit on the
					    text's own centre instead. (It was `translate-y-0.5`,
					    tuned when the input was 13px; the 16px bump that keeps
					    iOS from zooming moved the baseline out from under it.) */}
					<Ticket
						aria-hidden
						className={`size-3.5 shrink-0 -translate-y-0.5 ${
							refusal ? "text-destructive" : "text-muted-foreground"
						}`}
					/>
					<input
						aria-label="Voucher code"
						autoCapitalize="characters"
						autoComplete="off"
						spellCheck={false}
						placeholder="voucher code"
						value={code}
						disabled={disabled || checking}
						onChange={(e) => {
							setCode(e.target.value);
							setRefusal(null);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void apply(code);
							}
						}}
						// 16px, NOT the row's 13px: iOS Safari zooms the whole page
						// when a focused input is under 16px, so a buyer tapping this
						// on an iPhone would have the ticket lurch at them. Every
						// other input on this checkout is already 16px — this was the
						// only one that wasn't. The row keeps its 13px; only the
						// control the thumb lands in is bumped.
						className={`min-w-0 flex-1 border-b-2 border-dotted bg-transparent pb-0.5 font-mono text-base uppercase tracking-wider placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-60 ${
							refusal
								? "border-destructive text-destructive"
								: "border-border focus:border-accent"
						}`}
					/>
					<button
						type="button"
						onClick={() => void apply(code)}
						disabled={disabled || checking || guess === null}
						className="tap-target shrink-0 font-mono text-[11px] font-extrabold uppercase tracking-[0.14em] text-accent-emphasis disabled:opacity-40"
					>
						{checking ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							"Apply"
						)}
					</button>
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							setCode("");
							setRefusal(null);
						}}
						className="tap-target flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
						aria-label="Close voucher field"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				</div>
				{/* Indented to the receipt's text column (the glyph gutter), so a
				    refusal reads as a note on the line above it. */}
				{refusal ? (
					<p
						role="alert"
						className="pl-5 font-mono text-[11px] leading-5 text-destructive"
					>
						{refusal}
					</p>
				) : null}
			</div>
		);
	}

	// ── OPEN · panel skin (the counter) ─────────────────────────────────────
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Input
					aria-label="Voucher code"
					variant="field"
					autoCapitalize="characters"
					autoComplete="off"
					spellCheck={false}
					placeholder="Code"
					value={code}
					disabled={disabled || checking}
					isError={refusal !== null}
					onChange={(e) => {
						setCode(e.target.value);
						setRefusal(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							void apply(code);
						}
					}}
					className="font-mono tracking-wider"
				/>
				<Button
					type="button"
					variant="outline"
					className="tap-target shrink-0"
					disabled={disabled || checking || guess === null}
					onClick={() => void apply(code)}
				>
					{checking ? (
						<Loader2 className="size-4 animate-spin" aria-hidden />
					) : (
						"Apply"
					)}
				</Button>
				<button
					type="button"
					onClick={() => {
						setOpen(false);
						setCode("");
						setRefusal(null);
					}}
					className="tap-target flex shrink-0 items-center justify-center rounded-lg px-1 text-muted-foreground hover:text-foreground"
					aria-label="Close voucher field"
				>
					<X className="size-4" aria-hidden />
				</button>
			</div>
			{refusal ? (
				<p role="alert" className="text-xs font-medium text-destructive">
					{refusal}
				</p>
			) : code.trim() !== "" && guess === null ? (
				// Not the `KP-XXXX-XXXX` hint any more: a shared word is a code
				// too, so the only thing a half-typed one has in common with a
				// real one is being too short.
				<p className="text-xs text-muted-foreground">
					Keep typing — a code is at least {SHARED_CODE_MIN} letters or numbers.
				</p>
			) : itemSubtotal <= 0 ? (
				// The counter can sit with an empty cart and the field open; the
				// receipt can't (the empty-cart panel replaces the whole ticket).
				<p className="text-xs text-muted-foreground">
					Add something to the order first — a voucher comes off the items.
				</p>
			) : (
				<p className="text-xs text-muted-foreground">
					One voucher per order. It comes off the items, not delivery.
				</p>
			)}
		</div>
	);
}

/** The applied voucher's sen value against a live basket — the ONE place a
 * surface should compute a preview discount, so it can never drift from the
 * server's figure. */
export function previewDiscount(
	applied: AppliedVoucher | null,
	itemSubtotal: number,
): number {
	return applied && voucherQualifies(applied, itemSubtotal)
		? voucherDiscountFor(applied, itemSubtotal)
		: 0;
}

type VoucherBuyer = {
	waPhone: string;
	waDialCountry?: string;
	digits?: string;
	label?: string;
};

/**
 * The applied code's notes (`z8r3fdz0pw`) — the ONE author for both skins:
 * what is still needed (`pending`), the fine print (cap, minimum), and what
 * the per-buyer rule means for THIS buyer. "Checked" only when the code was
 * judged for the number on the page right now; an edited number reads as
 * not-yet-checked.
 */
export function voucherNoteLines({
	applied,
	itemSubtotal,
	currency,
	buyer,
	anonymousBuyer = false,
	skin,
}: {
	applied: AppliedVoucher;
	itemSubtotal: number;
	currency: string;
	buyer?: VoucherBuyer;
	anonymousBuyer?: boolean;
	skin: "panel" | "receipt";
}): {
	pending: string | null;
	finePrint: string;
	perBuyer: string | null;
	checked: boolean;
} {
	const money = (sen: number) => formatPrice(sen, currency);
	const minSpend = applied.conditions?.minSpend;
	const shortfall = minSpendShortfall(minSpend, itemSubtotal);
	const pending =
		shortfall > 0 && minSpend !== undefined
			? `Add ${money(shortfall)} more to use ${applied.code} — it needs ${money(minSpend)} of items.`
			: null;
	// The minimum is left out of the fine print while `pending` already
	// states it with the shortfall — said once, where it matters.
	const finePrint = voucherFinePrint(
		{
			maxDiscount: applied.maxDiscount,
			minSpend: pending === null ? minSpend : undefined,
		},
		money,
	).join(" · ");
	const limit = applied.conditions?.perBuyerLimit;
	const checked =
		applied.checkedFor !== undefined &&
		buyer?.digits !== undefined &&
		applied.checkedFor === buyer.digits;
	const perBuyer =
		limit === undefined
			? null
			: anonymousBuyer
				? `${limit} per buyer. This sale has no buyer number, so it counts toward the code's total only.`
				: checked
					? `✓ ${limit} per buyer · checked for ${buyer?.label ?? "this number"}`
					: skin === "receipt"
						? `${limit} per buyer · checked against your WhatsApp number`
						: `${limit} per buyer.`;
	return { pending, finePrint, perBuyer, checked };
}

/**
 * The applied code's notes on the RECEIPT (`z8r3fdz0pw`), rendered by the
 * ticket directly under the voucher line — visible without opening it, in
 * the receipt's own mono caption type, so they read as fine print on that
 * line. (The applied control itself sits behind the line's disclosure.)
 */
export function VoucherNotes(props: {
	applied: AppliedVoucher | null;
	itemSubtotal: number;
	currency: string;
	buyer?: VoucherBuyer;
}) {
	if (!props.applied) return null;
	const notes = voucherNoteLines({
		...props,
		applied: props.applied,
		skin: "receipt",
	});
	if (!notes.pending && !notes.finePrint && !notes.perBuyer) return null;
	return (
		<div className="flex flex-col pb-1 pl-5 font-mono text-[11px] leading-5">
			{notes.pending ? (
				<p className="text-amber-700 dark:text-amber-400">{notes.pending}</p>
			) : null}
			{notes.finePrint ? (
				<p className="text-muted-foreground">{notes.finePrint}</p>
			) : null}
			{notes.perBuyer ? (
				<p
					className={
						notes.checked ? "text-accent-emphasis" : "text-muted-foreground"
					}
				>
					{notes.perBuyer}
				</p>
			) : null}
		</div>
	);
}

/**
 * Flow A's re-check (`z8r3fdz0pw`, Zaki 30 Oct 2026): a per-buyer code
 * applies before the buyer has given a number — the ticket says it will be
 * checked against it — and is judged here the moment a parseable number is
 * in (the host debounces it). A number that has used it takes the code OFF
 * via `onRefused`, before Place order; the order door enforces the limit
 * regardless of what this showed.
 *
 * A HOOK owned by the page, not logic inside the field, because on the
 * storefront the field is mounted only while the voucher line is open — a
 * re-check living there would never run for a buyer who didn't tap it.
 *
 * A code taken off for `buyer_limit` is HELD: if the buyer then corrects a
 * mistyped number, the held code is re-checked for the new one and comes
 * back without retyping. Anything the buyer applies clears the hold.
 */
export function usePerBuyerRecheck({
	retailerId,
	applied,
	buyer,
	onApply,
	onRefused,
}: {
	retailerId: Id<"retailers">;
	applied: AppliedVoucher | null;
	buyer: VoucherBuyer | undefined;
	onApply: (voucher: AppliedVoucher) => void;
	onRefused: (message: string, code: string) => void;
}): void {
	const checkCode = useMutation(api.vouchers.checkCode);
	const [held, setHeld] = useState<string | null>(null);
	const lastRecheck = useRef<string | null>(null);
	useEffect(() => {
		if (applied !== null) setHeld(null);
	}, [applied]);
	useEffect(() => {
		if (!buyer) return;
		const target = applied
			? applied.conditions?.perBuyerLimit !== undefined &&
				applied.checkedFor !== buyer.digits
				? applied.code
				: null
			: held;
		if (target === null) return;
		const key = `${target}|${buyer.waDialCountry ?? ""}|${buyer.waPhone}`;
		if (lastRecheck.current === key) return;
		lastRecheck.current = key;
		void (async () => {
			try {
				const result = await checkCode({
					retailerId,
					code: target,
					waPhone: buyer.waPhone,
					waDialCountry: buyer.waDialCountry,
				});
				if (result.ok) {
					onApply({
						code: result.code,
						...result.terms,
						conditions: result.conditions,
						checkedFor: result.checkedFor,
					});
					return;
				}
				setHeld(result.refusal === "buyer_limit" ? target : null);
				onRefused(
					voucherRefusalMessage(
						result.refusal,
						{ usedOnOrder: result.usedOnOrder, ...result.detail },
						formatPrice,
					),
					target,
				);
			} catch {
				// The limiter or the network. Leave the ticket as it is — the
				// order door judges the number for real, and says so if it must.
			}
		})();
	}, [buyer, applied, held, checkCode, retailerId, onApply, onRefused]);
}
