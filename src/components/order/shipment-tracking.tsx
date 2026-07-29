import { useMutation } from "convex/react";
import { ChevronDown, ExternalLink, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COURIERS, findCourier } from "../../../convex/lib/couriers";
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
// the order-detail card's edit mode (ShipmentTrackingCard). Neither ever
// messages the buyer on its own — tracking entered AT mark-shipped rides the
// shipped WhatsApp update that's already going out; tracking added later
// surfaces on the buyer's tracking page only (Meta bills per message).

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
							? `The buyer gets a ${selected.label} tracking link automatically.`
							: `${selected.label} has no public tracking page — the buyer sees the number to copy instead.`
						: "The buyer sees the courier name and number to copy — paste a link if the courier has a tracking page."}
			</p>
		</div>
	);
}

/**
 * The advance-to-shipped prompt. When a Lalamove rider is bookable on the
 * order (`onBookRider` provided), it opens as TWO TABS with the rider first —
 * the Lalamove Delivery card sits far down the page, so this is the second,
 * eye-level place to book (same guarded flow; the CTA closes this dialog and
 * opens the card's quote→confirm dialog). The second tab is the manual
 * parcel-courier form. Without a bookable rider it's the plain courier form.
 * Skippable either way — shipping without tracking stays one tap, and the
 * card below covers add-later.
 */
export function MarkShippedDialog({
	open,
	onOpenChange,
	advanceLabel,
	onConfirm,
	onBookRider,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The advance button's own label, e.g. "Mark as Shipped" — stage vocabulary. */
	advanceLabel: string;
	onConfirm: (fields: ShipmentFields) => Promise<void>;
	/** Present ⟺ a Lalamove rider could be booked on this order right now
	 * (keys configured, plan ok, no active job). Called from the rider tab's
	 * CTA — the parent closes this dialog and triggers the SAME booking flow
	 * as the Lalamove Delivery card (today's price shown, tap to confirm;
	 * live tracking attaches itself and the rider's pickup drives "shipped"). */
	onBookRider?: () => void;
}) {
	const [draft, setDraft] = useState<ShipmentDraft | null>(null);
	const [saving, setSaving] = useState(false);
	// Rider-first when booking is on the table — the manual form is one tap
	// away for the outstation-parcel case. Plain courier form otherwise.
	const [tab, setTab] = useState<"rider" | "courier">("rider");
	const riderTab = onBookRider !== undefined && tab === "rider";
	// Lazy-init on open so the last-used courier is read fresh each time.
	const activeDraft = draft ?? {
		courier: readLastCourier(),
		otherName: "",
		trackingNo: "",
		url: "",
	};

	async function handleConfirm() {
		setSaving(true);
		try {
			await onConfirm(draftToFields(activeDraft));
			storeLastCourier(activeDraft.courier);
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
				if (!next) {
					setDraft(null);
					setTab("rider");
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{advanceLabel}</DialogTitle>
					{onBookRider === undefined ? (
						<DialogDescription>
							Add the courier and tracking number — it goes into the
							buyer&apos;s WhatsApp update and tracking page. Optional; you can
							also add it later from this order.
						</DialogDescription>
					) : (
						<DialogDescription>How is this order going out?</DialogDescription>
					)}
				</DialogHeader>

				{onBookRider !== undefined ? (
					<div className="flex gap-2 border-b border-input">
						{(
							[
								["rider", "Lalamove rider"],
								["courier", "Parcel courier"],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => setTab(key)}
								className={`min-h-11 px-3 text-sm font-medium ${
									tab === key
										? "border-b-2 border-primary text-primary"
										: "text-muted-foreground"
								}`}
							>
								{label}
							</button>
						))}
					</div>
				) : null}

				{riderTab ? (
					<p className="text-sm leading-relaxed text-muted-foreground">
						Book a Lalamove rider for this delivery — you&apos;ll see
						today&apos;s price and confirm before anything is charged. Live
						tracking attaches automatically, and the order updates on its own
						when the rider picks up, so there&apos;s nothing to mark manually.
					</p>
				) : (
					<>
						{onBookRider !== undefined ? (
							<p className="text-xs leading-relaxed text-muted-foreground">
								Shipping with a parcel courier instead — the tracking below goes
								into the buyer&apos;s WhatsApp update and tracking page.
								Optional; you can also add it later from this order.
							</p>
						) : null}
						<ShipmentFieldset draft={activeDraft} onChange={setDraft} />
					</>
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
					{riderTab && onBookRider !== undefined ? (
						<Button onClick={onBookRider} className="h-11">
							Book a rider…
						</Button>
					) : (
						<Button onClick={handleConfirm} disabled={saving} className="h-11">
							{saving ? "Updating…" : advanceLabel}
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
 */
export function ShipmentTrackingCard({
	order,
}: {
	order: {
		_id: Id<"orders">;
		courierName?: string;
		trackingNo?: string;
		carrierTrackingUrl?: string;
	};
}) {
	const setShipmentTracking = useMutation(api.orders.setShipmentTracking);
	const [draft, setDraft] = useState<ShipmentDraft | null>(null);
	const [saving, setSaving] = useState(false);
	const editing = draft !== null;
	const hasAny = Boolean(
		order.courierName || order.trackingNo || order.carrierTrackingUrl,
	);

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
				{!editing ? (
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
					{order.carrierTrackingUrl ? (
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
					No tracking added yet — the buyer&apos;s tracking page shows it once
					you add it.
				</p>
			)}
		</section>
	);
}
