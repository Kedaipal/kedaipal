import { useMutation } from "convex/react";
import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage, sanitizeIntInput } from "../../lib/format";
import {
	clampDelta,
	confirmLabel,
	EMPTY_DELTA,
	hasChange,
	liveShift,
	movementLabel,
	nextCount,
	type StockDraft,
	toAdjustment,
} from "../../lib/stock-adjust";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";

/**
 * The one place a seller changes stock by hand (86eypn8ye).
 *
 * Lives in its own `product/` folder rather than `forms/` because it is not a
 * form field: it is opened from the products LIST as well as the editor, writes
 * on its own confirm, and shares nothing with the product save it was
 * deliberately taken out of.
 *
 * ## The design, and what it rejected
 *
 * The number the seller stares at IS the control: big result, `-`/`+` either
 * side, quick chips underneath. The rejected alternative made them pick a verb
 * (Add / Remove / Set to) before they could type — more honest about intent,
 * but a tap of ceremony on a job done several times a day.
 *
 * What survived from it is the CONFIRM BUTTON: it reads "Add 10", never "Save".
 * Together with the "Adding 10" line under the digits, that keeps the three
 * numbers apart — the shelf now, the change, the result — which is the only way
 * a big changing number can't be misread as "how many I am adding".
 *
 * The exact-count path is reachable but never the default: a stock take is a
 * real job, and it is also the only path that can still write a sale out of
 * existence, so it is the only one carrying a warning.
 */

/**
 * Confirming writes IMMEDIATELY — before, and independently of, the product
 * form's own Save. Said out loud because the alternative is a seller adjusting
 * stock, backing out of the editor without saving, and reasonably expecting the
 * count to have backed out with it.
 */
const SAVES_ON_ITS_OWN =
	"Stock saves on its own, separately from the product's other details.";

/** One adjustable line. `onHand` must come from a LIVE query — a snapshot
 * passed in at open time is exactly the staleness this ticket exists to kill. */
export type StockLine = {
	variantId: Id<"productVariants">;
	/** Variant label, or the product name for a no-options product. */
	label: string;
	onHand: number;
};

// ---------------------------------------------------------------------------
// Single-variant dialog
// ---------------------------------------------------------------------------

export function StockAdjustDialog({
	open,
	onOpenChange,
	productName,
	line,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productName: string;
	line: StockLine | null;
}) {
	const adjustStock = useMutation(api.products.adjustStock);
	const [draft, setDraft] = useState<StockDraft>(EMPTY_DELTA);
	const [saving, setSaving] = useState(false);
	// The count when this dialog opened. Kept only to notice that reality moved
	// underneath — never used as the base for the write, which always resolves
	// against the live value (and again, server-side, inside the transaction).
	const [openedAt, setOpenedAt] = useState<number | null>(null);

	const live = line?.onHand ?? 0;

	// `line.onHand` is deliberately NOT a dependency. Re-running on it would
	// reset the baseline — and the seller's half-typed adjustment — every time a
	// sale landed, which is exactly the moment the notice below exists to
	// survive. Pinned by the mid-dialog test.
	// biome-ignore lint/correctness/useExhaustiveDependencies: open-time snapshot; onHand must not re-seed it
	useEffect(() => {
		if (!open) return;
		setDraft(EMPTY_DELTA);
		setOpenedAt(line?.onHand ?? 0);
	}, [open, line?.variantId]);

	async function handleConfirm() {
		if (!line || !hasChange(live, draft)) return;
		setSaving(true);
		try {
			await adjustStock({
				adjustments: [toAdjustment(line.variantId, live, draft)],
			});
			toast.success(`Stock updated — ${nextCount(live, draft)} in stock`);
			onOpenChange(false);
		} catch (err) {
			// A refused exact count lands here. The dialog stays open on the live
			// number, so confirming again is one tap against a figure the seller can
			// now actually see.
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Adjust stock</DialogTitle>
					<DialogDescription>
						{productName}
						{line && line.label !== productName ? ` · ${line.label}` : ""}
					</DialogDescription>
				</DialogHeader>

				{line ? (
					<StockAdjustBody
						live={live}
						openedAt={openedAt ?? live}
						draft={draft}
						onDraftChange={setDraft}
					/>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleConfirm}
						isLoading={saving}
						disabled={!line || !hasChange(live, draft)}
						className={cn(
							"h-11",
							draft.mode === "set" &&
								"bg-primary text-primary-foreground hover:bg-primary/90",
						)}
					>
						{confirmLabel(live, draft)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// The shared control
// ---------------------------------------------------------------------------

function StockAdjustBody({
	live,
	openedAt,
	draft,
	onDraftChange,
}: {
	live: number;
	openedAt: number;
	draft: StockDraft;
	onDraftChange: (next: StockDraft) => void;
}) {
	const result = nextCount(live, draft);
	const shift = liveShift(openedAt, live, draft);
	const changed = hasChange(live, draft);

	function step(by: number) {
		if (draft.mode !== "delta") return;
		onDraftChange({ mode: "delta", delta: clampDelta(live, draft.delta + by) });
	}

	return (
		<div className="flex flex-col gap-4">
			{/* What the store holds. Stated first and separately from everything
			    below it, so the result number never has to double as "current". */}
			<div className="rounded-xl bg-muted px-4 py-3 text-center">
				<p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
					In stock now
				</p>
				<p className="mt-1 font-heading text-3xl font-extrabold tabular-nums">
					{live}
				</p>
			</div>

			{shift ? (
				<p
					className={cn(
						"rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed",
						shift.tone === "info"
							? "border-accent/30 bg-accent/8 text-accent-emphasis"
							: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
					)}
				>
					{shift.message}
					{shift.suggestion !== undefined ? (
						<button
							type="button"
							onClick={() =>
								onDraftChange({
									mode: "set",
									setTo: shift.suggestion as number,
								})
							}
							className="mt-2 block min-h-11 w-full rounded-lg border border-current/25 bg-background/60 px-3 text-[12.5px] font-semibold"
						>
							Use {shift.suggestion} instead
						</button>
					) : null}
				</p>
			) : null}

			{draft.mode === "delta" ? (
				<>
					<div className="flex items-center gap-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => step(-1)}
							disabled={live + draft.delta <= 0}
							aria-label="One fewer"
							className="size-14 shrink-0 rounded-2xl p-0 [&_svg:not([class*='size-'])]:size-5"
						>
							<Minus />
						</Button>
						<div className="min-w-0 flex-1 text-center">
							<p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
								New count
							</p>
							<p
								className={cn(
									"font-heading text-[42px] leading-none font-extrabold tabular-nums",
									changed && "text-accent-emphasis",
								)}
							>
								{result}
							</p>
							{/* Load-bearing: names the CHANGE beside the RESULT. */}
							<p
								className={cn(
									"mt-1.5 text-[12.5px] font-semibold",
									changed ? "text-accent-emphasis" : "text-muted-foreground",
								)}
							>
								{movementLabel(live, draft)}
							</p>
						</div>
						<Button
							type="button"
							onClick={() => step(1)}
							aria-label="One more"
							className="size-14 shrink-0 rounded-2xl p-0 [&_svg:not([class*='size-'])]:size-5"
						>
							<Plus />
						</Button>
					</div>

					<div className="flex flex-wrap justify-center gap-2">
						{[-10, -5, -1, 1, 5, 10, 20].map((by) => (
							<button
								key={by}
								type="button"
								onClick={() => step(by)}
								disabled={by < 0 && live + draft.delta <= 0}
								className="min-h-11 min-w-[52px] rounded-full border border-input bg-background px-3 text-[13px] font-bold tabular-nums transition-colors hover:bg-muted disabled:opacity-40"
							>
								{by > 0 ? `+${by}` : by}
							</button>
						))}
					</div>

					<button
						type="button"
						onClick={() => onDraftChange({ mode: "set", setTo: null })}
						className="self-center text-[13px] font-semibold text-accent-emphasis underline underline-offset-4"
					>
						Counted your shelf? Set the exact number
					</button>
					<p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
						{SAVES_ON_ITS_OWN}
					</p>
				</>
			) : (
				<div className="rounded-xl border-2 border-primary p-3.5">
					<label className="flex flex-col gap-1.5">
						<span className="text-[12px] font-semibold text-foreground">
							Set the exact count
						</span>
						<Input
							inputMode="numeric"
							autoFocus
							placeholder="0"
							value={draft.setTo === null ? "" : String(draft.setTo)}
							onChange={(e) => {
								const raw = sanitizeIntInput(e.target.value);
								onDraftChange({
									mode: "set",
									setTo: raw === "" ? null : Number.parseInt(raw, 10),
								});
							}}
							className="h-13 text-center font-heading text-2xl font-extrabold tabular-nums"
						/>
					</label>
					<p className="mt-2 text-center text-[12.5px] font-semibold text-muted-foreground">
						{movementLabel(live, draft)}
					</p>
					<p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
						<strong className="font-bold">This replaces the count</strong>{" "}
						rather than moving it — anything that sells before you tap is
						written over. To correct a sale, use &minus; instead.
					</p>
					<button
						type="button"
						onClick={() => onDraftChange(EMPTY_DELTA)}
						className="mt-3 block w-full text-center text-[13px] font-semibold text-accent-emphasis underline underline-offset-4"
					>
						Back to + / &minus;
					</button>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Multi-variant sheet
// ---------------------------------------------------------------------------

/**
 * Every tracked variant of one product, adjustable in a single pass — the
 * "after the market day" surface, opened from the products list.
 *
 * Sends ONE batched mutation, so the sheet either applies whole or not at all.
 * N separate calls would leave the seller with some rows moved and some not,
 * and no way to tell which.
 *
 * The mode toggle is shared by every row rather than repeated per row: a stock
 * take counts the whole shelf, so the seller switches once. It is also the only
 * way a multi-variant product can express an exact count at all now that the
 * product save no longer writes stock — without it, a seller who counted three
 * sizes would have to do the arithmetic themselves, which is the failure the
 * single dialog's exact-count path exists to avoid.
 */
export function StockSheet({
	open,
	onOpenChange,
	productName,
	lines,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productName: string;
	lines: StockLine[];
}) {
	const adjustStock = useMutation(api.products.adjustStock);
	const [mode, setMode] = useState<"delta" | "set">("delta");
	const [drafts, setDrafts] = useState<Record<string, StockDraft>>({});
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setMode("delta");
		setDrafts({});
	}, [open]);

	function draftFor(line: StockLine): StockDraft {
		const existing = drafts[line.variantId];
		if (existing && existing.mode === mode) return existing;
		// Switching modes seeds "set" rows with the live count, so the field opens
		// on the truth and an untouched row still means "no change".
		return mode === "delta" ? EMPTY_DELTA : { mode: "set", setTo: line.onHand };
	}

	const pending = lines.filter((l) => hasChange(l.onHand, draftFor(l)));

	async function handleApply() {
		if (pending.length === 0) return;
		setSaving(true);
		try {
			await adjustStock({
				adjustments: pending.map((l) =>
					toAdjustment(l.variantId, l.onHand, draftFor(l)),
				),
			});
			toast.success(
				`Stock updated for ${pending.length} ${pending.length === 1 ? "choice" : "choices"}`,
			);
			onOpenChange(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Stock</SheetTitle>
					<SheetDescription>{productName}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-3">
					<div className="flex gap-1 rounded-xl bg-muted p-1">
						{(["delta", "set"] as const).map((m) => (
							<button
								key={m}
								type="button"
								onClick={() => {
									setMode(m);
									setDrafts({});
								}}
								className={cn(
									"min-h-11 flex-1 rounded-lg text-[13.5px] font-semibold transition-colors",
									mode === m
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground",
								)}
							>
								{m === "delta" ? "Adjust by" : "Set exact counts"}
							</button>
						))}
					</div>

					{lines.map((line) => {
						const draft = draftFor(line);
						const result = nextCount(line.onHand, draft);
						const changed = hasChange(line.onHand, draft);
						return (
							<div
								key={line.variantId}
								className={cn(
									"rounded-xl border p-3",
									changed ? "border-accent/40 bg-accent/5" : "border-border",
								)}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="min-w-0 flex-1 truncate text-sm font-semibold">
										{line.label}
									</span>
									<span
										className={cn(
											"shrink-0 text-[12px] font-bold tabular-nums",
											changed
												? "text-accent-emphasis"
												: "text-muted-foreground",
										)}
									>
										{changed
											? `${line.onHand} → ${result}`
											: `${line.onHand} in stock`}
									</span>
								</div>
								{mode === "delta" ? (
									<div className="mt-2.5 flex h-11 items-center overflow-hidden rounded-lg border border-input bg-background">
										<button
											type="button"
											aria-label={`One fewer ${line.label}`}
											disabled={(result ?? 0) <= 0}
											onClick={() =>
												setDrafts((d) => ({
													...d,
													[line.variantId]: {
														mode: "delta",
														delta: clampDelta(
															line.onHand,
															(draft.mode === "delta" ? draft.delta : 0) - 1,
														),
													},
												}))
											}
											className="flex h-full w-11 shrink-0 items-center justify-center border-r border-border/60 text-muted-foreground disabled:opacity-40"
										>
											<Minus className="size-4" aria-hidden="true" />
										</button>
										<span className="flex-1 text-center text-[15px] font-semibold tabular-nums">
											{result}
										</span>
										<button
											type="button"
											aria-label={`One more ${line.label}`}
											onClick={() =>
												setDrafts((d) => ({
													...d,
													[line.variantId]: {
														mode: "delta",
														delta:
															(draft.mode === "delta" ? draft.delta : 0) + 1,
													},
												}))
											}
											className="flex h-full w-11 shrink-0 items-center justify-center border-l border-border/60 text-muted-foreground"
										>
											<Plus className="size-4" aria-hidden="true" />
										</button>
									</div>
								) : (
									<Input
										inputMode="numeric"
										aria-label={`Exact count for ${line.label}`}
										value={
											draft.mode === "set" && draft.setTo !== null
												? String(draft.setTo)
												: ""
										}
										onChange={(e) => {
											const raw = sanitizeIntInput(e.target.value);
											setDrafts((d) => ({
												...d,
												[line.variantId]: {
													mode: "set",
													setTo: raw === "" ? null : Number.parseInt(raw, 10),
												},
											}));
										}}
										className="mt-2.5 h-11 text-center font-semibold tabular-nums"
									/>
								)}
								{changed ? (
									<p className="mt-1.5 text-[12px] font-semibold text-accent-emphasis">
										{movementLabel(line.onHand, draft)}
									</p>
								) : null}
							</div>
						);
					})}

					{mode === "set" ? (
						<p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
							<strong className="font-bold">These replace the counts.</strong>{" "}
							Anything that sells before you apply is written over — use
							&ldquo;Adjust by&rdquo; to correct a sale.
						</p>
					) : null}

					<p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
						{SAVES_ON_ITS_OWN}
					</p>

					<div className="flex gap-2 pt-1">
						<Button
							variant="outline"
							className="h-11 flex-1"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							className="h-11 flex-[1.6]"
							isLoading={saving}
							disabled={pending.length === 0}
							onClick={handleApply}
						>
							{pending.length === 0
								? "No changes"
								: `Apply · ${pending.length} ${pending.length === 1 ? "change" : "changes"}`}
						</Button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
