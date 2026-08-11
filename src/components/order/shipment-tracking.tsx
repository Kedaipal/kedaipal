import { useMutation } from "convex/react";
import { ChevronDown, CircleAlert, ExternalLink, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { DispatchBlock } from "../../../convex/lalamove";
import {
	COURIERS,
	findCourier,
	isSafeTrackingUrl,
} from "../../../convex/lib/couriers";
import { dispatchBlockCopy } from "../../lib/dispatch-block";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

// Manual courier + tracking number on mark-shipped (86eyehvk4). Two entry
// points share one fieldset: the mark-shipped prompt (MarkShippedDialog) and
// the order-detail card's edit mode (ShipmentTrackingCard). Neither messages
// the buyer — an order sends exactly one WhatsApp, at confirmation, and it's
// long gone by ship time (Meta bills per message). Whenever the courier +
// number are entered, they surface on the buyer's live order page, so the copy
// below promises that page and never a chat update.

const OTHER = "__other";
// Sellers ship with one courier — remember the last pick per device so the
// mark-shipped prompt opens pre-filled.
const LAST_COURIER_KEY = "kedaipal.lastCourier";

export type ShipmentFields = {
	courierName?: string;
	trackingNo?: string;
	carrierTrackingUrl?: string;
};

type ShipmentDraft = {
	/** Registry courier label, OTHER, or "" (none picked). */
	courier: string;
	otherName: string;
	trackingNo: string;
	/** Pasted link — only offered for "Other" couriers; registry couriers
	 * derive the link server-side from the tracking number. */
	url: string;
};

function readLastCourier(): string {
	try {
		const stored = localStorage.getItem(LAST_COURIER_KEY);
		return stored && findCourier(stored) ? stored : "";
	} catch {
		return "";
	}
}

function storeLastCourier(courier: string): void {
	try {
		if (courier && courier !== OTHER)
			localStorage.setItem(LAST_COURIER_KEY, courier);
	} catch {
		// Private mode etc — remembering the courier is best-effort.
	}
}

function draftToFields(draft: ShipmentDraft): ShipmentFields {
	// "No courier" is an explicit whole-form clear — the number/link inputs are
	// hidden in that state, so any leftover draft values must not silently save.
	if (draft.courier === "") return {};
	const courierName =
		draft.courier === OTHER ? draft.otherName.trim() : draft.courier;
	return {
		courierName: courierName || undefined,
		trackingNo: draft.trackingNo.trim() || undefined,
		carrierTrackingUrl:
			draft.courier === OTHER ? draft.url.trim() || undefined : undefined,
	};
}

// appearance-none + our own chevron: the native macOS caret hugs the right
// border and ignores padding, so it fought the rounded-xl focus ring.
const SELECT_CLASSES =
	"min-h-11 w-full appearance-none rounded-xl border border-input bg-background px-4 pr-10 text-base outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/50";

/** Shared fieldset: courier picklist + tracking number (+ name/link for "Other"). */
function ShipmentFieldset({
	draft,
	onChange,
	autoFocusTracking = false,
}: {
	draft: ShipmentDraft;
	onChange: (draft: ShipmentDraft) => void;
	autoFocusTracking?: boolean;
}) {
	const selected = findCourier(draft.courier);
	const noCourier = draft.courier === "";
	return (
		<div className="flex flex-col gap-3">
			<label className="flex flex-col gap-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					Courier
				</span>
				<div className="relative">
					<select
						value={draft.courier}
						onChange={(e) => onChange({ ...draft, courier: e.target.value })}
						className={SELECT_CLASSES}
					>
						<option value="">No courier</option>
						{COURIERS.map((c) => (
							<option key={c.label} value={c.label}>
								{c.label}
							</option>
						))}
						<option value={OTHER}>Other courier</option>
					</select>
					<ChevronDown
						aria-hidden="true"
						className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
				</div>
			</label>
			{/* "No courier" collapses the form — the remaining inputs only make
			    sense once a courier is picked, and draftToFields treats this state
			    as an explicit clear. */}
			{!noCourier ? (
				<>
					{draft.courier === OTHER ? (
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								Courier name
							</span>
							<Input
								value={draft.otherName}
								onChange={(e) =>
									onChange({ ...draft, otherName: e.target.value })
								}
								placeholder="e.g. Best Express"
								className="h-11 rounded-xl"
							/>
						</label>
					) : null}
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							Tracking number
						</span>
						<Input
							autoFocus={autoFocusTracking}
							value={draft.trackingNo}
							onChange={(e) =>
								onChange({ ...draft, trackingNo: e.target.value })
							}
							placeholder="e.g. 630002864925"
							className="h-11 rounded-xl"
						/>
					</label>
					{draft.courier === OTHER ? (
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								Tracking link (optional)
							</span>
							<Input
								type="url"
								value={draft.url}
								onChange={(e) => onChange({ ...draft, url: e.target.value })}
								placeholder="https://…"
								className="h-11 rounded-xl"
							/>
						</label>
					) : null}
				</>
			) : null}
			{/* Tell the seller what the buyer will get — no hidden behavior. */}
			<p className="text-xs leading-relaxed text-muted-foreground">
				{noCourier
					? "No tracking info will be attached — you can add it later from this order."
					: selected
						? selected.buildTrackingUrl
							? `The buyer's order page gets a ${selected.label} tracking link automatically.`
							: `${selected.label} has no public tracking page — the buyer's order page shows the number to copy instead.`
						: "The buyer's order page shows the courier name and number to copy — paste a link if the courier has a tracking page."}
			</p>
		</div>
	);
}

/**
 * The advance-to-shipped prompt, in one of two shapes decided by the vendor's
 * delivery method (86eyff02p):
 *
 * - **Rider dispatch** (`lalamoveVendor`, i.e. Lalamove is the delivery charge
 *   they picked): riders only, **no manual courier form at all** — they don't
 *   ship parcels, so a courier picklist here would be noise that invites
 *   tracking contradicting the rider's own live link. Bookable → the rider
 *   explainer + a "Book a rider" CTA (the Lalamove Delivery card sits far down
 *   the page, so this is the second, eye-level entrance to the SAME guarded
 *   flow). Not bookable → the reason, in the seller's words, with the fix path.
 * - **Everyone else**: the plain optional courier + tracking-number form.
 *
 * Skippable in every shape, and every shape keeps a real footer button that
 * advances the order — "Book a rider" is never the only way out. Recording how
 * a rider vendor's blocked order actually went out is the CARD's job, not this
 * prompt's (`ShipmentTrackingCard`, which stays editable in exactly that
 * state); the blocked copy says so, so the path isn't hidden.
 */
export function MarkShippedDialog({
	open,
	onOpenChange,
	advanceLabel,
	onConfirm,
	lalamoveVendor,
	riderBlockReason,
	onBookRider,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The advance button's own label, e.g. "Mark as Shipped" — stage vocabulary. */
	advanceLabel: string;
	onConfirm: (fields: ShipmentFields) => Promise<void>;
	/** Rider dispatch IS this vendor's delivery method
	 * (`getDeliveryJob.bookingEnabled`) — the manual parcel-courier form is not
	 * offered to them anywhere. */
	lalamoveVendor: boolean;
	/** Why a rider can't be booked on THIS order right now; null = bookable.
	 * Only read when `lalamoveVendor` — both come from the same resolved
	 * `getDeliveryJob` read, so they can't disagree. */
	riderBlockReason: DispatchBlock | null;
	/** Closes this prompt and triggers the SAME booking flow as the Lalamove
	 * Delivery card (today's price shown, tap to confirm; live tracking attaches
	 * itself and the rider's pickup drives "shipped"). */
	onBookRider: () => void;
}) {
	const [draft, setDraft] = useState<ShipmentDraft | null>(null);
	const [saving, setSaving] = useState(false);
	const riderBookable = lalamoveVendor && riderBlockReason === null;
	// Lazy-init on open so the last-used courier is read fresh each time.
	const activeDraft = draft ?? {
		courier: readLastCourier(),
		otherName: "",
		trackingNo: "",
		url: "",
	};

	// Rider vendors advance with no shipment fields — there's no courier form to
	// read, and a rider's tracking link attaches itself on booking.
	async function handleConfirm() {
		setSaving(true);
		try {
			await onConfirm(lalamoveVendor ? {} : draftToFields(activeDraft));
			if (!lalamoveVendor) storeLastCourier(activeDraft.courier);
			onOpenChange(false);
			setDraft(null);
		} catch {
			// onConfirm surfaces its own toast; keep the dialog open for a retry.
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) setDraft(null);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{advanceLabel}</DialogTitle>
					{lalamoveVendor ? (
						<DialogDescription>
							{riderBookable
								? "How is this order going out?"
								: "A rider can't be booked for this order right now."}
						</DialogDescription>
					) : (
						<DialogDescription>
							Add the courier and tracking number — it appears on the
							buyer&apos;s order page, so they can follow the parcel instead of
							asking you. Optional; you can also add it later from this order.
						</DialogDescription>
					)}
				</DialogHeader>

				{lalamoveVendor ? (
					// Branch on the reason itself, not the derived `riderBookable`, so the
					// blocked arm has it narrowed to a real DispatchBlock.
					riderBlockReason === null ? (
						<p className="text-sm leading-relaxed text-muted-foreground">
							Book a Lalamove rider for this delivery — you&apos;ll see
							today&apos;s price and confirm before anything is charged. Live
							tracking attaches automatically, and the order updates on its own
							when the rider picks up, so there&apos;s nothing to mark manually.
							Dropping this one off yourself? Ship it without a rider below.
						</p>
					) : (
						// Blocked: say why (with its fix path) and let the seller choose —
						// back out and fix it, or ship this one without a rider. Never a
						// silent advance, never a wall.
						<div className="flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
							<CircleAlert className="size-4 shrink-0 translate-y-0.5" />
							<div className="flex flex-col gap-1.5 text-sm leading-relaxed">
								<p>{dispatchBlockCopy(riderBlockReason)}</p>
								{/* Name the add-tracking path explicitly: an order going out
								    another way is exactly the one that needs a courier +
								    consignment number, and the card below is where it goes. */}
								<p className="text-amber-900/80 dark:text-amber-200/80">
									Close this to sort it out and book after — or ship it anyway
									below and add the courier + tracking number from the Shipment
									tracking card on this order.
								</p>
							</div>
						</div>
					)
				) : (
					<ShipmentFieldset draft={activeDraft} onChange={setDraft} />
				)}

				<DialogFooter>
					<Button
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={saving}
						className="h-11"
					>
						Cancel
					</Button>
					{/* Booking is on the table, so it leads — but shipping without a
					    rider is a real path and gets a real button (a text link inside a
					    paragraph fails the ≥44px tap-target rule, and here it's the only
					    way to move the order). Quiet variant keeps the hierarchy. */}
					{riderBookable ? (
						<Button
							variant="link"
							onClick={handleConfirm}
							disabled={saving}
							className="h-11"
						>
							{saving ? "Updating…" : `${advanceLabel} without a rider`}
						</Button>
					) : null}
					{riderBookable ? (
						<Button onClick={onBookRider} className="h-11">
							Book a rider
						</Button>
					) : (
						<Button onClick={handleConfirm} disabled={saving} className="h-11">
							{saving
								? "Updating…"
								: lalamoveVendor
									? `${advanceLabel} anyway`
									: advanceLabel}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Order-detail "Shipment tracking" card: shows the attached courier + number
 * (copyable) + track link, with an edit mode for add-after / corrections.
 *
 * `readOnly` means a rider is handling this delivery (booked, or bookable right
 * now) — manual courier entry isn't theirs to do, so the card keeps showing
 * what the buyer sees (the link and number a booking mirrored onto the order)
 * but drops Add/Edit, and disappears entirely while there's nothing attached.
 *
 * It is deliberately NOT "the vendor uses Lalamove": when no rider can be
 * booked — a Pro→Starter downgrade leaves `deliveryBooking.enabled` true and
 * `blockReason` permanently `plan_gated`, and a legacy pinless address or a
 * phone-less counter order does the same per order — the parcel that actually
 * went out still needs its consignment number recorded. Hiding this card there
 * would leave the store with no way to enter tracking at all, which is the
 * downgrade-never-traps-the-seller line the rest of the codebase holds.
 */
export function ShipmentTrackingCard({
	order,
	readOnly = false,
}: {
	order: {
		_id: Id<"orders">;
		courierName?: string;
		trackingNo?: string;
		carrierTrackingUrl?: string;
	};
	readOnly?: boolean;
}) {
	const setShipmentTracking = useMutation(api.orders.setShipmentTracking);
	const [draft, setDraft] = useState<ShipmentDraft | null>(null);
	const [saving, setSaving] = useState(false);
	const editing = draft !== null;
	const hasAny = Boolean(
		order.courierName || order.trackingNo || order.carrierTrackingUrl,
	);
	// Nothing to show and nothing to add — the Lalamove Delivery card above is
	// where a rider vendor's dispatch lives.
	if (readOnly && !hasAny) return null;

	function startEdit() {
		const known = order.courierName
			? findCourier(order.courierName)
			: undefined;
		setDraft({
			// A stored non-registry name (or a URL-only legacy/Lalamove row) edits
			// as "Other" so nothing silently drops.
			courier: known ? known.label : hasAny ? OTHER : readLastCourier(),
			otherName: known ? "" : (order.courierName ?? ""),
			trackingNo: order.trackingNo ?? "",
			url: known ? "" : (order.carrierTrackingUrl ?? ""),
		});
	}

	async function handleSave() {
		if (!draft) return;
		setSaving(true);
		try {
			await setShipmentTracking({
				orderId: order._id,
				...draftToFields(draft),
			});
			storeLastCourier(draft.courier);
			setDraft(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Shipment Tracking
				</p>
				{!editing && !readOnly ? (
					<button
						type="button"
						onClick={startEdit}
						className="text-xs text-accent hover:underline"
					>
						{hasAny ? "Edit" : "Add tracking"}
					</button>
				) : null}
			</div>

			{editing && draft ? (
				<div className="flex flex-col gap-3">
					<ShipmentFieldset draft={draft} onChange={setDraft} />
					<div className="flex gap-2">
						<Button
							onClick={handleSave}
							disabled={saving}
							className="h-9 flex-1 text-sm"
						>
							{saving ? "Saving…" : "Save"}
						</Button>
						<Button
							variant="secondary"
							onClick={() => setDraft(null)}
							disabled={saving}
							className="h-9 text-sm"
						>
							Cancel
						</Button>
					</div>
				</div>
			) : hasAny ? (
				<div className="flex flex-col gap-2">
					{order.courierName || order.trackingNo ? (
						<div className="flex items-center justify-between gap-2">
							<div className="flex min-w-0 items-center gap-2">
								<Truck className="size-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									{order.courierName ? (
										<p className="truncate text-sm font-medium text-foreground">
											{order.courierName}
										</p>
									) : null}
									{order.trackingNo ? (
										<p className="truncate font-mono text-sm text-muted-foreground">
											{order.trackingNo}
										</p>
									) : null}
								</div>
							</div>
							{order.trackingNo ? (
								<CopyButton
									value={order.trackingNo}
									ariaLabel="Copy tracking number"
									successMessage="Tracking number copied"
								/>
							) : null}
						</div>
					) : null}
					{/* Scheme-checked like the buyer's page — a pre-sanitize row could
					    hold a non-http(s) URL, and this anchor would run it. */}
					{isSafeTrackingUrl(order.carrierTrackingUrl) ? (
						<a
							href={order.carrierTrackingUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-accent underline underline-offset-2"
						>
							<ExternalLink className="size-3.5 shrink-0" />
							<span className="truncate">Track with courier</span>
						</a>
					) : null}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No tracking added yet — the buyer&apos;s order page shows it the
					moment you add it.
				</p>
			)}
		</section>
	);
}
