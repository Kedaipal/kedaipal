import { useMutation, useQuery } from "convex/react";
import {
	ArrowDown,
	ArrowUp,
	ExternalLink,
	MapPin,
	Pencil,
	Plus,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
	const moveUp = useMutation(api.pickupLocations.moveUp);
	const moveDown = useMutation(api.pickupLocations.moveDown);
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

	async function handleMove(
		location: Doc<"pickupLocations">,
		direction: "up" | "down",
	) {
		try {
			if (direction === "up") {
				await moveUp({ pickupLocationId: location._id });
			} else {
				await moveDown({ pickupLocationId: location._id });
			}
		} catch (err) {
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
					<ul className="flex flex-col gap-2">
						{active.map((loc, i) => (
							<LocationRow
								key={loc._id}
								location={loc}
								onEdit={() => setEditing(loc)}
								onMoveUp={
									i === 0 ? undefined : () => handleMove(loc, "up")
								}
								onMoveDown={
									i === active.length - 1
										? undefined
										: () => handleMove(loc, "down")
								}
								onToggleActive={(next) => handleToggleActive(loc, next)}
							/>
						))}
					</ul>
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

function LocationRow({
	location,
	onEdit,
	onMoveUp,
	onMoveDown,
	onToggleActive,
}: {
	location: Doc<"pickupLocations">;
	onEdit: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	onToggleActive: (next: boolean) => void;
}) {
	return (
		<li
			className={`flex flex-col gap-3 rounded-xl border border-border bg-background p-4 ${
				location.isActive ? "" : "opacity-60"
			}`}
		>
			<div className="flex items-start gap-3">
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
				<div className="flex items-center gap-1">
					{location.isActive ? (
						<>
							<button
								type="button"
								onClick={onMoveUp}
								disabled={!onMoveUp}
								aria-label={`Move ${location.label} up`}
								className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
							>
								<ArrowUp className="size-4" />
							</button>
							<button
								type="button"
								onClick={onMoveDown}
								disabled={!onMoveDown}
								aria-label={`Move ${location.label} down`}
								className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
							>
								<ArrowDown className="size-4" />
							</button>
						</>
					) : null}
					<button
						type="button"
						onClick={onEdit}
						aria-label={`Edit ${location.label}`}
						className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
					>
						<Pencil className="size-3.5" />
						Edit
					</button>
				</div>
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
