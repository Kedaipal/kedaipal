/**
 * Settings → Order status: the seller's own words for the steps an order goes
 * through, held ONCE PER FLOW KIND (`z8r3fdh3w1`).
 *
 * Before this there was one flat list plus a global rename map, which meant a
 * cake shop's vocabulary reached its campsite bookings — "Confirmed" renamed to
 * "Ok go" showed up on a stay — and no screen could see or clear it. Here every
 * kind the store actually uses gets its own card, its own Default/Customised
 * state, and its own reset. A kind's words can no longer reach another kind.
 *
 * Only the kinds the store uses are rendered, so a delivery-only seller sees
 * one card and nothing about bookings.
 */

import {
	AlertTriangle,
	ChevronDown,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useRevealOnAdd } from "../../hooks/useRevealOnAdd";
import { convexErrorMessage } from "../../lib/format";
import {
	ANCHOR_UI_LABELS,
	collectStageConfigErrors,
	configuredStages,
	FLOW_KIND_UI,
	FLOW_KINDS,
	MAX_ORDER_STAGES,
	type OrderFlowKind,
	type OrderFlows,
	type OrderStage,
	resolveStages,
	STAGE_ANCHORS,
	STAGE_DESCRIPTION_MAX_LENGTH,
	STAGE_LABEL_MAX_LENGTH,
	type StageAnchor,
	type StatusLabels,
	sameStages,
	stageLabel,
} from "../../lib/orderStatus";
import { reorderByIds } from "../../lib/reorder";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { SortableList } from "../ui/sortable-list";
import {
	Card,
	InfoBanner,
	SAVE_BTN_CLASS,
	SectionHeading,
} from "./settings-primitives";

/** What the caller must tell us to decide which kinds exist for this store. */
export type OrderFlowsInput = {
	orderFlows: OrderFlows | undefined;
	/** LEGACY flat list — still the source for an un-migrated delivery/pickup
	 * kind, and what a first customisation of those kinds seeds from. */
	orderStages: OrderStage[] | undefined;
	/** LEGACY global renames, same role. */
	statusLabels: StatusLabels | undefined;
	offerDelivery: boolean;
	offerSelfCollect: boolean;
	hasBookingListings: boolean;
	hasEventListings: boolean;
};

/** Per-kind patch the card sends up; omitted kinds are left untouched. */
export type OrderFlowsPatch = Partial<Record<OrderFlowKind, OrderStage[]>>;

/**
 * The Order status tab body. One card per flow kind the store uses, plus the
 * one-shot "Reset all" for a seller who wants their vocabulary gone.
 */
export function OrderFlowsSection({
	input,
	onSave,
}: {
	input: OrderFlowsInput;
	onSave: (flows: OrderFlowsPatch) => Promise<unknown>;
}) {
	const [resetAllOpen, setResetAllOpen] = useState(false);

	// A kind is shown when the store USES it — or when it is customised but no
	// longer offered. Hiding the second case would strand a config the seller
	// can neither see nor clear, which is the exact failure this ticket exists
	// to end. Delivery is the floor so the tab is never empty.
	const uses: Record<OrderFlowKind, boolean> = {
		delivery: input.offerDelivery,
		self_collect: input.offerSelfCollect,
		booking: input.hasBookingListings,
		event: input.hasEventListings,
	};
	const kinds = FLOW_KINDS.filter(
		(k) =>
			uses[k] ||
			configuredStages(input.orderFlows, input.orderStages, k).length > 0,
	);
	if (kinds.length === 0) kinds.push("delivery");

	const customisedKinds = kinds.filter(
		(k) => configuredStages(input.orderFlows, input.orderStages, k).length > 0,
	);

	async function resetAll() {
		await onSave(Object.fromEntries(kinds.map((k) => [k, []])));
		toast.success("Every order flow is back to its default steps.");
	}

	return (
		<div className="flex flex-col gap-6 pt-2">
			<InfoBanner title="How order stages work">
				<p>
					Build the steps your orders move through — name them however you work.
					Buyers see them as a live timeline; you advance orders step-by-step
					from the dashboard.
				</p>
				<p>
					Every step maps to one of four built-in milestones via{" "}
					<span className="font-medium text-foreground">“Counts as”</span>, so
					payments, packing and tracking keep working:{" "}
					<span className="font-medium text-foreground">Accepted</span> →{" "}
					<span className="font-medium text-foreground">In production</span> →{" "}
					<span className="font-medium text-foreground">Ready</span> →{" "}
					<span className="font-medium text-foreground">Done</span>.
				</p>
				<p>
					<span className="font-medium text-foreground">
						Your first step should count as “Accepted”, your last as “Done”
					</span>{" "}
					— map the steps in between to whichever milestone fits. E.g. a cake
					shop: “Order received” (Accepted) → “Baking” (In production) → “Ready
					for pickup” (Ready) → “Collected” (Done).
				</p>
				{kinds.length > 1 ? (
					<p>
						<span className="font-medium text-foreground">
							Each kind of order has its own steps.
						</span>{" "}
						Naming a step here changes that kind only — a delivery step never
						shows up on a booking.
					</p>
				) : null}
			</InfoBanner>

			{/* Advancing a stage used to be able to fire a WhatsApp. It can't any
			    more, so say what stages still do — otherwise a seller who relied on
			    stage pings just sees the toggle gone. Stated once for the tab
			    rather than once per card. */}
			<p className="text-xs text-muted-foreground leading-relaxed">
				Stages name the steps on the buyer's order page. Advancing a stage
				updates that page instantly, but doesn't send the buyer a WhatsApp.
			</p>

			{kinds.map((kind) => (
				<OrderFlowCard
					key={kind}
					kind={kind}
					input={input}
					inUse={uses[kind]}
					onSave={onSave}
				/>
			))}

			{/* One button to undo the lot. Only earns its place once more than one
			    kind is customised — below that the card's own reset IS the quick
			    way, and a second control would say the same thing twice. */}
			{customisedKinds.length > 1 ? (
				<div className="flex justify-end">
					<Button
						type="button"
						variant="ghost"
						onClick={() => setResetAllOpen(true)}
						className="h-11 lg:h-10 lg:w-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
					>
						<RotateCcw className="size-4" />
						Reset all {customisedKinds.length} to defaults
					</Button>
				</div>
			) : null}

			<ConfirmDialog
				open={resetAllOpen}
				onOpenChange={setResetAllOpen}
				title="Reset every order flow?"
				description={`Your own steps for ${customisedKinds
					.map((k) => FLOW_KIND_UI[k].short)
					.join(
						", ",
					)} are deleted and each kind goes back to Kedaipal's default steps. Orders already in flight keep moving — they just use the default wording from now on.`}
				confirmLabel="Reset all to defaults"
				destructive
				onConfirm={resetAll}
			/>
		</div>
	);
}

/**
 * One flow kind's card. Reads as a sentence before it reads as a form: this
 * kind's current steps, whether they're yours or ours, and the two things you
 * can do about it.
 */
function OrderFlowCard({
	kind,
	input,
	inUse,
	onSave,
}: {
	kind: OrderFlowKind;
	input: OrderFlowsInput;
	inUse: boolean;
	onSave: (flows: OrderFlowsPatch) => Promise<unknown>;
}) {
	const [editing, setEditing] = useState(false);
	const [resetOpen, setResetOpen] = useState(false);

	const customised =
		configuredStages(input.orderFlows, input.orderStages, kind).length > 0;
	const base = {
		orderFlows: input.orderFlows,
		orderStages: input.orderStages,
		labels: input.statusLabels,
	};
	const effective = resolveStages({ ...base, deliveryMethod: kind });
	// A fixed-length package's DEFAULTS differ from a stay's (Active/Ended vs
	// Checked in/out). While the kind is on defaults those are two different
	// chains, and printing only one would make the card lie to a store that
	// sells both. A customised booking flow covers both by design, so there is
	// one chain to print again.
	const packagedEffective =
		kind === "booking" && !customised
			? resolveStages({ ...base, deliveryMethod: kind, bookingPackaged: true })
			: undefined;
	const showPackaged =
		packagedEffective !== undefined &&
		!sameStages(packagedEffective, effective);

	// Pickup that currently reads exactly like delivery — the state every store
	// with both lands in right after the migration, since the old single list
	// applied to both. Saying so beats making them compare two lists by eye.
	const matchesDelivery =
		kind === "self_collect" &&
		input.offerDelivery &&
		sameStages(
			effective,
			resolveStages({ ...base, deliveryMethod: "delivery" }),
		);

	const chain = (stages: OrderStage[]) =>
		stages.map((s) => stageLabel(s, "en")).join("  →  ");

	async function save(stages: OrderStage[]) {
		await onSave({ [kind]: stages });
		setEditing(false);
		toast.success(`Saved your ${FLOW_KIND_UI[kind].short} steps.`);
	}

	async function reset() {
		await onSave({ [kind]: [] });
		setEditing(false);
		toast.success(`${FLOW_KIND_UI[kind].name} are back to the default steps.`);
	}

	return (
		<Card id={`order-flow-${kind}`}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<SectionHeading
					title={FLOW_KIND_UI[kind].name}
					description={
						kind === "booking"
							? "Stays and fixed-length packages — one set of steps covers both."
							: FLOW_KIND_UI[kind].blurb
					}
				/>
				<span
					className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
						customised
							? "bg-accent/10 text-accent"
							: "bg-muted text-muted-foreground"
					}`}
				>
					{customised ? "Your steps" : "Default"}
				</span>
			</div>

			{/* A kind the store stopped offering but still has a flow for. Its
			    config is not lost and not silently applied — it's here, labelled,
			    and clearable. */}
			{!inUse ? (
				<p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:text-amber-200">
					<AlertTriangle
						className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					/>
					<span>
						You're not offering this right now. These steps are kept and will
						apply again if you turn it back on.
					</span>
				</p>
			) : null}

			{editing ? (
				<StageEditor
					seed={effective}
					saveLabel={`Save ${FLOW_KIND_UI[kind].short} steps`}
					onSave={save}
					onCancel={() => setEditing(false)}
				/>
			) : (
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
						{showPackaged ? (
							<>
								<FlowChain label="Stays" text={chain(effective)} />
								<FlowChain
									label="Packages"
									text={chain(packagedEffective ?? [])}
								/>
							</>
						) : (
							<FlowChain text={chain(effective)} />
						)}
					</div>

					{matchesDelivery ? (
						<p className="text-xs text-muted-foreground leading-relaxed">
							Currently the same as your delivery steps. Editing here changes
							pickup orders only.
						</p>
					) : null}

					{/* col-REVERSE on mobile: DOM order is [Reset][Edit] so the desktop
					    row ends with the primary on the right, but stacked that would
					    put the destructive action on top. Reversing keeps the primary
					    first under the thumb on a phone. */}
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						{customised ? (
							<Button
								type="button"
								variant="ghost"
								onClick={() => setResetOpen(true)}
								className="h-11 lg:h-10 sm:w-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
							>
								<RotateCcw className="size-4" />
								Reset to defaults
							</Button>
						) : null}
						<Button
							type="button"
							variant={customised ? "outline" : "default"}
							onClick={() => setEditing(true)}
							className="h-11 lg:h-10 sm:w-auto sm:min-w-[160px]"
						>
							{customised ? "Edit steps" : "Customise steps"}
						</Button>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={resetOpen}
				onOpenChange={setResetOpen}
				title={`Reset ${FLOW_KIND_UI[kind].short} steps to defaults?`}
				description={`Your own steps are deleted and ${
					FLOW_KIND_UI[kind].name
				} go back to ${chain(
					resolveStages({ deliveryMethod: kind }),
				)}. Your other kinds of order are not affected. Orders already in flight keep moving — they just use the default wording from now on.`}
				confirmLabel="Reset to defaults"
				destructive
				onConfirm={reset}
			/>
		</Card>
	);
}

/** One "A → B → C" line, with an optional variant label in front of it. */
function FlowChain({ label, text }: { label?: string; text: string }) {
	return (
		<p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-relaxed">
			{label ? (
				<span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{label}
				</span>
			) : null}
			<span className="font-medium text-foreground">{text}</span>
		</p>
	);
}
// One editable stage in the StageEditor. `_key` is a stable React key so drag
// reordering doesn't remount inputs; `id` is the server id ("" = new stage).
type StageDraft = {
	_key: string;
	id: string;
	anchor: StageAnchor;
	labelEn: string;
	labelMs: string;
	labelZh: string;
	descEn: string;
	descMs: string;
	descZh: string;
};

function seedToDraft(s: OrderStage): StageDraft {
	return {
		_key: crypto.randomUUID(),
		// Synthesized defaults ("default:<anchor>") aren't real ids — saving turns
		// them into configured stages with fresh ids.
		id: s.id.startsWith("default:") ? "" : s.id,
		anchor: s.anchor,
		labelEn: s.label.en,
		labelMs: s.label.ms ?? "",
		labelZh: s.label.zh ?? "",
		descEn: s.description?.en ?? "",
		descMs: s.description?.ms ?? "",
		descZh: s.description?.zh ?? "",
	};
}

// Map drafts to the wire/validation shape (stable id for dup-checking).
function draftsToStages(drafts: StageDraft[]): OrderStage[] {
	return drafts.map((d, i) => ({
		id: d.id || d._key,
		anchor: d.anchor,
		label: {
			en: d.labelEn.trim(),
			...(d.labelMs.trim() ? { ms: d.labelMs.trim() } : {}),
			...(d.labelZh.trim() ? { zh: d.labelZh.trim() } : {}),
		},
		...(d.descEn.trim() || d.descMs.trim() || d.descZh.trim()
			? {
					description: {
						...(d.descEn.trim() ? { en: d.descEn.trim() } : {}),
						...(d.descMs.trim() ? { ms: d.descMs.trim() } : {}),
						...(d.descZh.trim() ? { zh: d.descZh.trim() } : {}),
					},
				}
			: {}),
		sortOrder: i,
	}));
}

/**
 * The stage list editor for ONE flow kind. Knows nothing about kinds: the card
 * above it decides which kind is being edited, seeds this with that kind's
 * effective list, and routes the save. Reset lives on the card (one visible
 * control per kind) rather than in here, where it was only reachable after
 * opening the editor.
 */
function StageEditor({
	seed,
	saveLabel,
	onSave,
	onCancel,
}: {
	seed: OrderStage[];
	saveLabel: string;
	onSave: (stages: OrderStage[]) => Promise<unknown>;
	onCancel: () => void;
}) {
	const [drafts, setDrafts] = useState<StageDraft[]>(() =>
		seed.map(seedToDraft),
	);
	const [saving, setSaving] = useState(false);
	// Cards collapse to a one-line summary by default (a full stage card is tall on
	// mobile, so the page reads better at a glance). Click a card to expand it.
	// During a drag the row always renders compact (state.isSorting), and the
	// expanded set is preserved so cards re-open exactly as they were afterwards.
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const { markAdded, revealRef } = useRevealOnAdd();
	function toggleExpand(key: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	function update(key: string, patch: Partial<StageDraft>) {
		setDrafts((prev) =>
			prev.map((d) => (d._key === key ? { ...d, ...patch } : d)),
		);
	}
	function remove(key: string) {
		setDrafts((prev) => prev.filter((d) => d._key !== key));
	}
	function addStage() {
		if (drafts.length >= MAX_ORDER_STAGES) {
			toast.error(`You can have at most ${MAX_ORDER_STAGES} stages.`);
			return;
		}
		const key = crypto.randomUUID();
		// Open the new (empty) stage so the seller can fill it in immediately, and
		// reveal it (scroll + focus) — it appends below the fold on a phone.
		setExpanded((prev) => new Set(prev).add(key));
		markAdded(key);
		setDrafts((prev) => [
			...prev,
			{
				_key: key,
				id: "",
				// Default to the last stage's anchor so the monotonic rule holds and
				// the seller usually doesn't need to touch the dropdown.
				anchor: prev[prev.length - 1]?.anchor ?? "confirmed",
				labelEn: "",
				labelMs: "",
				labelZh: "",
				descEn: "",
				descMs: "",
				descZh: "",
			},
		]);
	}

	const errors = collectStageConfigErrors(draftsToStages(drafts));
	const canSave = drafts.length > 0 && errors.length === 0 && !saving;

	async function handleSave() {
		setSaving(true);
		try {
			await onSave(draftsToStages(drafts));
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function stageCard(
		d: StageDraft,
		index: number,
		handle: ReactNode,
		state: { isSorting: boolean; isOverlay: boolean },
	) {
		const displayLabel = d.labelEn.trim() || `Stage ${index + 1}`;
		if (state.isSorting) {
			return (
				<div
					className={`flex items-center gap-2 rounded-xl border bg-card p-3 ${
						state.isOverlay ? "border-accent shadow-lg" : "border-border"
					}`}
				>
					{handle}
					<span className="truncate text-sm font-medium">{displayLabel}</span>
					<span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						{ANCHOR_UI_LABELS[d.anchor]}
					</span>
				</div>
			);
		}

		const isExpanded = expanded.has(d._key);
		if (!isExpanded) {
			// Collapsed-by-default summary — same info as the drag row; click to open.
			return (
				<div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
					{handle}
					<button
						type="button"
						onClick={() => toggleExpand(d._key)}
						aria-expanded={false}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<span className="truncate text-sm font-medium">{displayLabel}</span>
						<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{ANCHOR_UI_LABELS[d.anchor]}
						</span>
						<ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
					</button>
				</div>
			);
		}

		return (
			<div
				ref={revealRef(d._key)}
				className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
			>
				{/* Header mirrors the collapsed row exactly (handle + label + chevron
				    far-right) so the toggle target doesn't jump when expanding. */}
				<div className="flex items-center gap-2">
					{handle}
					<button
						type="button"
						onClick={() => toggleExpand(d._key)}
						aria-expanded={true}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<span className="truncate text-sm font-medium">{displayLabel}</span>
						<ChevronDown className="ml-auto size-4 shrink-0 rotate-180 text-muted-foreground" />
					</button>
				</div>

				{/* Stack on mobile (full-width, never misaligned); three columns at sm+
				    where each label fits one line so the inputs line up. */}
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Label (English)
						</span>
						<Input
							type="text"
							variant="field"
							maxLength={STAGE_LABEL_MAX_LENGTH}
							value={d.labelEn}
							onChange={(e) => update(d._key, { labelEn: e.target.value })}
							placeholder="e.g. Sewing"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Label (Bahasa Malaysia)
						</span>
						<Input
							type="text"
							variant="field"
							maxLength={STAGE_LABEL_MAX_LENGTH}
							value={d.labelMs}
							onChange={(e) => update(d._key, { labelMs: e.target.value })}
							placeholder="Optional"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Label (中文)
						</span>
						<Input
							type="text"
							variant="field"
							maxLength={STAGE_LABEL_MAX_LENGTH}
							value={d.labelZh}
							onChange={(e) => update(d._key, { labelZh: e.target.value })}
							placeholder="Optional"
						/>
					</label>
				</div>

				<label className="flex flex-col gap-1">
					<span className="text-xs font-medium text-muted-foreground">
						Counts as{" "}
						<span className="font-normal">
							— which milestone this step represents
						</span>
					</span>
					<select
						value={d.anchor}
						onChange={(e) =>
							update(d._key, { anchor: e.target.value as StageAnchor })
						}
						className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
					>
						{STAGE_ANCHORS.map((a) => (
							<option key={a} value={a}>
								{ANCHOR_UI_LABELS[a]}
							</option>
						))}
					</select>
					<span className="text-xs text-muted-foreground">
						{d.anchor === "confirmed"
							? "The order has been accepted. Use this for your first step."
							: d.anchor === "delivered"
								? "The order is complete. Use this for your last step."
								: "A step while you're fulfilling the order."}
					</span>
				</label>

				<div className="grid grid-cols-1 gap-2">
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Buyer note (optional) — English
						</span>
						<textarea
							value={d.descEn}
							onChange={(e) => update(d._key, { descEn: e.target.value })}
							placeholder="e.g. Drying — usually 1–2 days depending on weather"
							rows={2}
							maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
							className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Buyer note (optional) — Bahasa Malaysia
						</span>
						<textarea
							value={d.descMs}
							onChange={(e) => update(d._key, { descMs: e.target.value })}
							placeholder="Pilihan"
							rows={2}
							maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
							className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Buyer note (optional) — 中文
						</span>
						<textarea
							value={d.descZh}
							onChange={(e) => update(d._key, { descZh: e.target.value })}
							placeholder="可选"
							rows={2}
							maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
							className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
					</label>
				</div>

				{/* Destructive action lives at the bottom (out of the toggle header) so
				    it can't be hit while quick-expanding/collapsing. */}
				<button
					type="button"
					onClick={() => remove(d._key)}
					className="flex h-9 items-center gap-1.5 self-start rounded-lg px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
				>
					<Trash2 className="size-3.5" />
					Remove stage
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<p className="text-xs text-muted-foreground leading-relaxed">
					Drag to reorder. Each step must “count as” the same milestone as the
					one before it, or a later one.
				</p>
				<Button
					type="button"
					variant="outline"
					className="h-9 shrink-0"
					onClick={addStage}
					disabled={drafts.length >= MAX_ORDER_STAGES}
				>
					<Plus className="size-4" />
					Add stage
				</Button>
			</div>

			{drafts.length === 0 ? (
				<p className="rounded-xl border border-dashed border-input bg-muted/20 px-4 py-4 text-center text-sm text-muted-foreground">
					No stages — add at least one, or reset to the defaults.
				</p>
			) : (
				<SortableList
					items={drafts}
					getId={(d) => d._key}
					onReorder={(ids) =>
						setDrafts((prev) => reorderByIds(prev, ids, (d) => d._key))
					}
					renderItem={(d, handle, state) =>
						stageCard(d, drafts.indexOf(d), handle, state)
					}
					className="flex flex-col gap-3"
				/>
			)}

			{errors.length > 0 ? (
				<ul className="flex flex-col gap-1 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
					{errors.map((e) => (
						<li key={e}>• {e}</li>
					))}
				</ul>
			) : null}

			<div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
				<Button
					type="button"
					variant="ghost"
					onClick={onCancel}
					disabled={saving}
					className="h-11 lg:h-10 lg:w-auto"
				>
					Cancel
				</Button>
				<Button
					type="button"
					onClick={handleSave}
					disabled={!canSave}
					className={SAVE_BTN_CLASS}
				>
					{saving ? "Saving…" : saveLabel}
				</Button>
			</div>
		</div>
	);
}
