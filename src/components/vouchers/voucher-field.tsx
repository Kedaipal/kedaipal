import { useMutation } from "convex/react";
import { Check, Loader2, Ticket, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	formatVoucherTerms,
	parseVoucherCode,
	SHARED_CODE_MIN,
	type VoucherTerms,
	voucherDiscountFor,
	voucherRefusalMessage,
} from "../../../convex/lib/vouchers";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** An applied voucher, as both redemption surfaces hold it. */
export interface AppliedVoucher extends VoucherTerms {
	code: string;
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
				const result = await checkCode({ retailerId, code: typed });
				if (result.ok) {
					onApply({ code: result.code, ...result.terms });
					setCode("");
				} else {
					// Including a dead code that arrived on a shared LINK: say so
					// plainly rather than pricing at full and letting the buyer
					// wonder where the discount went. The sentence has ONE author
					// (convex/lib/vouchers.ts), shared with the server's refusal.
					setRefusal(
						voucherRefusalMessage(result.refusal, {
							usedOnOrder: result.usedOnOrder,
						}),
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
		[checkCode, onApply, retailerId],
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
		if (receipt) {
			return (
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
			);
		}
		return (
			<div className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2.5">
				<Check className="size-4 shrink-0 text-accent-emphasis" aria-hidden />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold text-accent-emphasis">
						{worth} applied
					</p>
					<p className="truncate font-mono text-[11px] text-muted-foreground">
						{applied.code}
					</p>
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
	return applied ? voucherDiscountFor(applied, itemSubtotal) : 0;
}
