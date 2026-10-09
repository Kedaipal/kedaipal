import { useMutation } from "convex/react";
import { Check, Loader2, Ticket, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	formatVoucherTerms,
	normalizeVoucherCode,
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
}) {
	const checkCode = useMutation(api.vouchers.checkCode);
	const [open, setOpen] = useState(initialCode !== undefined);
	const [code, setCode] = useState("");
	const [checking, setChecking] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);

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

	if (applied) {
		const worth = formatVoucherTerms(applied, (sen) =>
			formatPrice(sen, currency),
		);
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
				{/* Removable in place — a panel states what is currently on and lets
				    it be taken off where it is shown. */}
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

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={disabled}
				className="tap-target flex w-fit items-center gap-1.5 text-sm font-semibold text-accent-emphasis underline-offset-2 hover:underline disabled:opacity-50"
			>
				<Ticket className="size-4" aria-hidden />
				{label}
			</button>
		);
	}

	// Typed-but-unapplied preview, so "10% off" means something before the tap.
	const guess = normalizeVoucherCode(code);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Input
					aria-label="Voucher code"
					variant="field"
					autoCapitalize="characters"
					autoComplete="off"
					spellCheck={false}
					placeholder="KP-XXXX-XXXX"
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
			{/* The refusal lives under the field it belongs to. */}
			{refusal ? (
				<p role="alert" className="text-xs font-medium text-destructive">
					{refusal}
				</p>
			) : code.trim() !== "" && guess === null ? (
				<p className="text-xs text-muted-foreground">
					Codes read <span className="font-mono">KP-XXXX-XXXX</span> — keep
					typing.
				</p>
			) : (
				<p className="text-xs text-muted-foreground">
					One voucher per order. It comes off the items, not delivery.
				</p>
			)}
			{/* Honest about the cap before the tap, where the basket is small
			    enough for a fixed voucher to be clipped by it. */}
			{itemSubtotal <= 0 ? (
				<p className="text-xs text-muted-foreground">
					Add something to the basket first.
				</p>
			) : null}
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
