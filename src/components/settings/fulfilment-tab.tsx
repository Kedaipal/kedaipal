import { useMutation, useQuery } from "convex/react";
import { ExternalLink, MapPin, Pencil, Phone, Plus, Truck } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { formatPhone } from "../../lib/customer";
import { convexErrorMessage } from "../../lib/format";
import { deriveMapsUrl } from "../../lib/google-address";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { SortableList } from "../ui/sortable-list";
import { PickupLocationEditDialog } from "./pickup-location-edit-dialog";

interface FulfilmentTabProps {
	retailerId: Id<"retailers">;
	offerSelfCollect: boolean;
	offerDelivery: boolean;
}

function Card({ children }: { children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			{children}
		</section>
	);
}

function SectionHeading({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold text-foreground">{title}</h3>
			{description ? (
				<p className="text-xs text-muted-foreground leading-relaxed">
					{description}
				</p>
			) : null}
		</div>
	);
}

/**
 * Inline toggle button styled as a switch — codebase has no Switch component
 * today and a single use doesn't justify a new shared primitive. Keeps the
 * component count flat per the wider settings module convention.
 */
function ToggleSwitch({
	on,
	onChange,
	disabled = false,
	label,
}: {
	on: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!on)}
			className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors ${
				on ? "border-accent bg-accent" : "border-input bg-muted"
			} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
		>
			<span
				className={`inline-block size-5 rounded-full bg-background shadow-sm transition-transform ${
					on ? "translate-x-5" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}

export function FulfilmentTab({
	retailerId,
	offerSelfCollect,
	offerDelivery,
}: FulfilmentTabProps) {
	const locations = useQuery(api.pickupLocations.listForRetailer, {
		retailerId,
	});
	const updateSettings = useMutation(api.retailers.updateSettings);
	const setActive = useMutation(api.pickupLocations.setActive);
	const reorder = useMutation(api.pickupLocations.reorder);
	const markPickupSetupSeen = useMutation(api.retailers.markPickupSetupSeen);

	// Fire-and-forget on first mount so step 4 of the dashboard checklist
	// dismisses. Server-side is idempotent (no-op when already true) so a
	// double-render or re-mount doesn't double-write. We don't await or surface
	// errors — failing this is purely cosmetic for the checklist.
	const seenFired = useRef(false);
	useEffect(() => {
		if (seenFired.current) return;
		seenFired.current = true;
		markPickupSetupSeen({}).catch(() => {
			seenFired.current = false; // allow retry on subsequent mount
		});
	}, [markPickupSetupSeen]);

	const [editing, setEditing] = useState<Doc<"pickupLocations"> | "new" | null>(
		null,
	);
	const [showInactive, setShowInactive] = useState(false);
	const [toggling, setToggling] = useState(false);

	const active = locations?.filter((l) => l.isActive) ?? [];
	const inactive = locations?.filter((l) => !l.isActive) ?? [];

	// Fulfilment invariant (mirrors the server guard in retailers.updateSettings):
	// a storefront must keep ≥1 WORKING method. Self-collect only "works" with an
	// active location, so once we know the location list we can pre-disable the
	// toggle that would strand the store and show an actionable reason. The server
	// still enforces this — the disabled state is courtesy, not the gate.
	const selfCollectWorking = offerSelfCollect && active.length > 0;
	const deliveryIsLastMethod =
		locations !== undefined && offerDelivery && !selfCollectWorking;
	const selfCollectIsLastMethod = offerSelfCollect && !offerDelivery;
	const deliveryToggleDisabled = toggling || deliveryIsLastMethod;
	const selfCollectToggleDisabled = toggling || selfCollectIsLastMethod;

	async function handleToggleDelivery(next: boolean) {
		setToggling(true);
		try {
			await updateSettings({ offerDelivery: next });
			toast.success(next ? "Delivery enabled." : "Delivery turned off.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setToggling(false);
		}
	}

	async function handleToggleSelfCollect(next: boolean) {
		setToggling(true);
		try {
			await updateSettings({ offerSelfCollect: next });
			toast.success(
				next ? "Self-collect enabled." : "Self-collect turned off.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setToggling(false);
		}
	}

	async function handleToggleActive(
		location: Doc<"pickupLocations">,
		next: boolean,
	) {
		try {
			await setActive({ pickupLocationId: location._id, isActive: next });
			toast.success(
				next ? `“${location.label}” restored.` : `“${location.label}” hidden.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	// --- Drag-and-drop reorder ---
	//
	// We keep an optimistic `localOrder` of active ids that the SortableContext
	// renders in. On drop:
	//   1. Compute the new order via @dnd-kit/sortable's arrayMove.
	//   2. Apply it to `localOrder` immediately (UI updates instantly).
	//   3. Fire the reorder mutation. If it fails, revert localOrder so the UI
	//      snaps back and the seller sees the toast.
	// Convex's reactive query then ships the authoritative order back on
	// success, which matches localOrder so no flicker.
	//
	// Reconciliation is gated by a primitive string key (`activeIdsKey`) so the
	// effect only fires when the server's active set or order ACTUALLY changes
	// — adding the recomputed-each-render `activeIds` array to the deps would
	// re-sync on every parent render, clobbering optimistic state between drop
	// and mutation-ack and producing a visible "snap back, then re-jump"
	// stutter.
	const activeIds = active.map((l) => l._id);
	const activeIdsKey = activeIds.join("|");
	const [localOrder, setLocalOrder] =
		useState<Array<Id<"pickupLocations">>>(activeIds);
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional —
	// see the comment above. activeIds is read via closure on the render where
	// activeIdsKey actually changes, so we get the latest server order without
	// the per-render reset.
	useEffect(() => {
		setLocalOrder(activeIds);
	}, [activeIdsKey]);

	const orderedActive = useMemo(() => {
		const byId = new Map(active.map((l) => [l._id, l]));
		return localOrder
			.map((id) => byId.get(id))
			.filter((l): l is Doc<"pickupLocations"> => l !== undefined);
	}, [active, localOrder]);

	async function handleReorder(orderedIds: string[]) {
		const next = orderedIds as Array<Id<"pickupLocations">>;
		const previous = localOrder;
		setLocalOrder(next); // optimistic
		try {
			await reorder({ retailerId, orderedIds: next });
		} catch (err) {
			setLocalOrder(previous); // revert on failure
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-6 pt-2">
			<Card>
				<div className="flex items-start justify-between gap-4">
					<SectionHeading
						title="Delivery"
						description="When on, buyers can enter a delivery address at checkout. No setup needed — they just type where their order should go."
					/>
					<ToggleSwitch
						on={offerDelivery}
						onChange={handleToggleDelivery}
						disabled={deliveryToggleDisabled}
						label="Offer delivery on the storefront"
					/>
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Truck className="size-4 shrink-0 text-accent" aria-hidden="true" />
					<span>The fast default — most F&amp;B sellers keep this on.</span>
				</div>
				{deliveryIsLastMethod ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						Delivery is your storefront&apos;s only working way to receive
						orders right now. Add an active pickup location (and keep
						self-collect on) before switching to pickup-only.
					</p>
				) : null}
			</Card>

			<Card>
				<div className="flex items-start justify-between gap-4">
					<SectionHeading
						title="Self-collect"
						description="When on, buyers see a self-collect option at checkout — but only when you also have at least one active pickup location below."
					/>
					<ToggleSwitch
						on={offerSelfCollect}
						onChange={handleToggleSelfCollect}
						disabled={selfCollectToggleDisabled}
						label="Offer self-collect on the storefront"
					/>
				</div>
				{selfCollectIsLastMethod ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						Self-collect is your storefront&apos;s only working way to receive
						orders right now (delivery is off). Turn delivery back on before
						turning this off.
					</p>
				) : offerSelfCollect && active.length === 0 ? (
					<p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
						Self-collect is on but you have no active pickup locations yet —
						buyers won&apos;t see the option until you add one.
					</p>
				) : null}
			</Card>

			<Card>
				<div className="flex items-center justify-between gap-3">
					<SectionHeading
						title="Pickup locations"
						description="Where buyers can collect their orders. Frozen onto each order so deactivating or editing later never rewrites past pickup details."
					/>
					<Button
						type="button"
						onClick={() => setEditing("new")}
						size="sm"
						className="h-10 shrink-0 gap-1.5"
					>
						<Plus className="size-4" />
						Add
					</Button>
				</div>

				{locations === undefined ? (
					<LocationListSkeleton />
				) : active.length === 0 ? (
					<EmptyState onAdd={() => setEditing("new")} />
				) : (
					<SortableList
						items={orderedActive}
						getId={(loc) => loc._id}
						onReorder={handleReorder}
						renderItem={(loc, handle, state) =>
							state.isSorting ? (
								// Collapsed one-line row while dragging (matches the order-status
								// editor) — a tall list stays easy to rearrange.
								<div
									className={`flex items-center gap-2 rounded-xl border bg-background p-3 ${
										state.isOverlay
											? "border-accent shadow-lg"
											: "border-border"
									}`}
								>
									{handle}
									<MapPin
										className="size-4 shrink-0 text-accent"
										aria-hidden="true"
									/>
									<span className="truncate text-sm font-medium">
										{loc.label}
									</span>
								</div>
							) : (
								<div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
									<LocationRowBody
										location={loc}
										onEdit={() => setEditing(loc)}
										onToggleActive={(next) => handleToggleActive(loc, next)}
										dragHandle={handle}
									/>
								</div>
							)
						}
					/>
				)}

				{inactive.length > 0 ? (
					<div className="flex flex-col gap-2 border-t border-border pt-3">
						<button
							type="button"
							onClick={() => setShowInactive((s) => !s)}
							className="self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
						>
							{showInactive
								? `Hide inactive (${inactive.length})`
								: `Show inactive (${inactive.length})`}
						</button>
						{showInactive ? (
							<ul className="flex flex-col gap-2">
								{inactive.map((loc) => (
									<LocationRow
										key={loc._id}
										location={loc}
										onEdit={() => setEditing(loc)}
										onToggleActive={(next) => handleToggleActive(loc, next)}
									/>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</Card>

			<PickupLocationEditDialog
				open={editing !== null}
				onClose={() => setEditing(null)}
				location={editing === "new" ? undefined : (editing ?? undefined)}
				retailerId={retailerId}
			/>
		</div>
	);
}

/**
 * Body of a pickup row (icon + label/address/link/notes + action bar). Used
 * inside both row variants below; takes an optional leading slot for the
 * drag handle so the sortable variant can inject one without re-implementing
 * the rest of the layout.
 */
function LocationRowBody({
	location,
	onEdit,
	onToggleActive,
	dragHandle,
}: {
	location: Doc<"pickupLocations">;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
	dragHandle?: ReactNode;
}) {
	return (
		<>
			<div className="flex items-start gap-3">
				{dragHandle}
				<MapPin
					className="size-4 shrink-0 text-accent mt-0.5"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="text-sm font-semibold leading-tight">
						{location.label}
					</p>
					<p className="text-xs text-muted-foreground whitespace-pre-line">
						{location.address}
					</p>
					{(() => {
						const mapsUrl = deriveMapsUrl(location);
						return mapsUrl ? (
							<a
								href={mapsUrl}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
							>
								<ExternalLink className="size-3" />
								Open in maps
							</a>
						) : null;
					})()}
					{location.notes ? (
						<p className="text-xs text-muted-foreground whitespace-pre-line">
							{location.notes}
						</p>
					) : null}
					{location.managerName || location.managerWaPhone ? (
						<p className="flex items-center gap-1 text-xs text-muted-foreground">
							<Phone
								className="size-3 shrink-0 text-accent"
								aria-hidden="true"
							/>
							<span>
								Manager: {location.managerName ?? "—"}
								{location.managerWaPhone
									? ` · ${formatPhone(location.managerWaPhone)}`
									: ""}
							</span>
						</p>
					) : null}
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 border-t border-border pt-3">
				<button
					type="button"
					onClick={onEdit}
					aria-label={`Edit ${location.label}`}
					className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
				>
					<Pencil className="size-3.5" />
					Edit
				</button>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">
						{location.isActive ? "Active" : "Hidden"}
					</span>
					<ToggleSwitch
						on={location.isActive}
						onChange={onToggleActive}
						label={`Toggle active state of ${location.label}`}
					/>
				</div>
			</div>
		</>
	);
}

/**
 * Plain (non-draggable) variant for inactive rows. No grip handle — inactive
 * rows live behind the "Show inactive" collapsible and aren't part of the
 * sortable set.
 */
function LocationRow({
	location,
	onEdit,
	onToggleActive,
}: {
	location: Doc<"pickupLocations">;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
}) {
	return (
		<li className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 opacity-60">
			<LocationRowBody
				location={location}
				onEdit={onEdit}
				onToggleActive={onToggleActive}
			/>
		</li>
	);
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-8 text-center">
			<MapPin className="size-6 text-muted-foreground" aria-hidden="true" />
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium">No pickup locations yet</p>
				<p className="text-xs text-muted-foreground">
					Add a place buyers can collect their orders from.
				</p>
			</div>
			<Button
				type="button"
				onClick={onAdd}
				size="sm"
				variant="outline"
				className="h-10 gap-1.5"
			>
				<Plus className="size-4" />
				Add pickup location
			</Button>
		</div>
	);
}

function LocationListSkeleton() {
	return (
		<ul className="flex flex-col gap-2">
			{[0, 1].map((n) => (
				<li
					key={n}
					className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
				>
					<div className="flex items-start gap-3">
						<Skeleton className="size-4 rounded-full" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-48" />
						</div>
					</div>
					<div className="flex items-center justify-between border-t border-border pt-3">
						<div className="flex gap-1">
							<Skeleton className="size-11 rounded-lg" />
							<Skeleton className="size-11 rounded-lg" />
							<Skeleton className="h-11 w-16 rounded-lg" />
						</div>
						<Skeleton className="h-7 w-12 rounded-full" />
					</div>
				</li>
			))}
		</ul>
	);
}
