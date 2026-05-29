import {
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, GripVertical, MapPin, Pencil, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { PickupLocationEditDialog } from "./pickup-location-edit-dialog";

interface PickupLocationsTabProps {
	retailerId: Id<"retailers">;
	offerSelfCollect: boolean;
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
				on
					? "border-accent bg-accent"
					: "border-input bg-muted"
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

export function PickupLocationsTab({
	retailerId,
	offerSelfCollect,
}: PickupLocationsTabProps) {
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

	const [editing, setEditing] = useState<
		Doc<"pickupLocations"> | "new" | null
	>(null);
	const [showInactive, setShowInactive] = useState(false);
	const [toggling, setToggling] = useState(false);

	const active = locations?.filter((l) => l.isActive) ?? [];
	const inactive = locations?.filter((l) => !l.isActive) ?? [];

	async function handleToggleOffer(next: boolean) {
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
	const [localOrder, setLocalOrder] = useState<Array<Id<"pickupLocations">>>(
		activeIds,
	);
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

	const sensors = useSensors(
		// Mouse / pen: a small drag distance must elapse before a drag starts so
		// click-on-edit / click-on-toggle isn't misinterpreted as a drag.
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		// Touch: a brief hold disambiguates drag intent from a scroll/tap. The
		// `touch-none` class on the grip handle prevents the page from scrolling
		// while the user holds it.
		useSensor(TouchSensor, {
			activationConstraint: { delay: 250, tolerance: 5 },
		}),
		// Keyboard a11y: arrow keys move a focused row.
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	async function handleDragEnd(event: DragEndEvent) {
		const { active: draggedItem, over } = event;
		if (!over || draggedItem.id === over.id) return;
		const oldIndex = localOrder.indexOf(
			draggedItem.id as Id<"pickupLocations">,
		);
		const newIndex = localOrder.indexOf(over.id as Id<"pickupLocations">);
		if (oldIndex === -1 || newIndex === -1) return;

		const next = arrayMove(localOrder, oldIndex, newIndex);
		const previous = localOrder;
		setLocalOrder(next);
		try {
			await reorder({ retailerId, orderedIds: next });
		} catch (err) {
			setLocalOrder(previous);
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-6 pt-2">
			<Card>
				<div className="flex items-start justify-between gap-4">
					<SectionHeading
						title="Offer self-collect"
						description="When on, buyers see a self-collect option at checkout — but only when you also have at least one active pickup location below."
					/>
					<ToggleSwitch
						on={offerSelfCollect}
						onChange={handleToggleOffer}
						disabled={toggling}
						label="Offer self-collect on the storefront"
					/>
				</div>
				{offerSelfCollect && active.length === 0 ? (
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
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={localOrder}
							strategy={verticalListSortingStrategy}
						>
							<ul className="flex flex-col gap-2">
								{orderedActive.map((loc) => (
									<SortableLocationRow
										key={loc._id}
										location={loc}
										onEdit={() => setEditing(loc)}
										onToggleActive={(next) => handleToggleActive(loc, next)}
									/>
								))}
							</ul>
						</SortableContext>
					</DndContext>
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
				location={editing === "new" ? undefined : editing ?? undefined}
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
					{location.mapsUrl ? (
						<a
							href={location.mapsUrl}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
						>
							<ExternalLink className="size-3" />
							Open in maps
						</a>
					) : null}
					{location.notes ? (
						<p className="text-xs text-muted-foreground whitespace-pre-line">
							{location.notes}
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
 * Sortable variant for active rows — wraps the row with `useSortable` and
 * exposes a `GripVertical` drag handle on the left. Listeners are attached
 * ONLY to the handle so tapping Edit / the active toggle doesn't start a drag.
 *
 * `touch-none` on the handle is critical on mobile — without it the page
 * would scroll while the seller tries to drag.
 */
function SortableLocationRow({
	location,
	onEdit,
	onToggleActive,
}: {
	location: Doc<"pickupLocations">;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: location._id });
	// Keep the row fully opaque while dragging — the border-accent + shadow is
	// enough visual indicator. Snapping opacity from <1 back to 1 on drop reads
	// as a flicker; using only properties that animate via `transition` keeps
	// the drop landing smooth.
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 10 : "auto",
	};

	return (
		<li
			ref={setNodeRef}
			style={style}
			className={`flex flex-col gap-3 rounded-xl border bg-background p-4 transition-shadow ${
				isDragging ? "border-accent shadow-lg" : "border-border"
			}`}
		>
			<LocationRowBody
				location={location}
				onEdit={onEdit}
				onToggleActive={onToggleActive}
				dragHandle={
					<button
						type="button"
						aria-label={`Drag to reorder ${location.label}`}
						{...attributes}
						{...listeners}
						className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:cursor-grabbing"
					>
						<GripVertical className="size-4" />
					</button>
				}
			/>
		</li>
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
