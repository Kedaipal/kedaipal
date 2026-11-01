import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { CheckCircle2, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PARCEL_WEIGHT_MAX_G } from "../../../convex/lib/variant";
import {
	PARCEL_WEIGHTS_BATCH_MAX,
	WEIGHT_REQUIRED_COPY,
	type WeightPricing,
} from "../../../convex/lib/weightPricing";
import { convexErrorMessage, sanitizeIntInput } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";

/**
 * The bulk weight fill (Products → Parcel weights, 23 Oct 2026): every
 * buyable choice with no parcel weight, product by product, each with a box
 * — so an existing catalogue is weighed in minutes, not product by product
 * through the editor. Reached from the readiness notice (Settings → Delivery
 * pricing, the Products list) and from the floor note on an order.
 *
 * Drafts are keyed by variant id, never by a product or choice name; saved
 * rows leave the list on their own (the query is reactive), so a half-done
 * session always shows exactly what is still unweighed.
 */

type UnweighedProduct = {
	productId: Id<"products">;
	name: string;
	choices: Array<{ variantId: Id<"productVariants">; label: string }>;
};

/** What one box holds, judged once for the row, the count and the button. */
export function weightDraftState(
	raw: string | undefined,
):
	| { kind: "blank" }
	| { kind: "ok"; grams: number }
	| { kind: "bad"; why: string } {
	const v = (raw ?? "").trim();
	if (v.length === 0) return { kind: "blank" };
	const grams = Number.parseInt(v, 10);
	if (!Number.isInteger(grams))
		return { kind: "bad", why: "Whole grams only." };
	if (grams <= 0) return { kind: "bad", why: "Has to be above 0 g." };
	if (grams > PARCEL_WEIGHT_MAX_G)
		return { kind: "bad", why: "That's over 1,000 kg — check the number." };
	return { kind: "ok", grams };
}

export function ParcelWeightsFill({
	retailerId,
	reason,
	readOnly,
	readOnlyReason,
}: {
	retailerId: Id<"retailers">;
	/** WHY the store prices by weight — picks the explainer. Null when it
	 * doesn't (the page still works: a seller may weigh ahead of switching). */
	reason: WeightPricing | null;
	/** The catalogue can't change right now (view-only, a teammate with view
	 * on products) — every box and the save grey out, with the reason. */
	readOnly: boolean;
	readOnlyReason: string;
}) {
	const products = useQuery(
		convexQuery(api.products.unweighedChoices, { retailerId }),
	).data as UnweighedProduct[] | undefined;
	const setParcelWeights = useMutation(api.products.setParcelWeights);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [fillAll, setFillAll] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const rows = useMemo(
		() =>
			(products ?? []).flatMap((p) =>
				p.choices.map((c) => ({
					productId: p.productId,
					variantId: c.variantId,
					state: weightDraftState(drafts[c.variantId]),
				})),
			),
		[products, drafts],
	);
	const ready = rows.filter((r) => r.state.kind === "ok");
	const bad = rows.filter((r) => r.state.kind === "bad");
	const totalChoices = rows.length;

	function setDraft(variantId: string, value: string) {
		setError(null);
		setDrafts((d) => ({ ...d, [variantId]: sanitizeIntInput(value) }));
	}

	/** Fill every box that is still EMPTY — a typed weight is never overwritten
	 * by a bulk fill, the way "Same price for all" would be a surprise if it
	 * clobbered the one price the seller had already corrected. */
	function fillBlank(value: string, only?: Set<string>) {
		const v = sanitizeIntInput(value);
		if (!v) return;
		setError(null);
		setDrafts((d) => {
			const next = { ...d };
			for (const r of rows) {
				if (only && !only.has(r.variantId)) continue;
				if (weightDraftState(next[r.variantId]).kind === "blank")
					next[r.variantId] = v;
			}
			return next;
		});
	}

	async function save() {
		if (ready.length === 0 || saving) return;
		setSaving(true);
		setError(null);
		const weights = ready.map((r) => ({
			variantId: r.variantId,
			parcelWeightG: (r.state as { grams: number }).grams,
		}));
		let saved = 0;
		try {
			// Bounded batches, in order — a 60-product catalogue is a few calls.
			for (let i = 0; i < weights.length; i += PARCEL_WEIGHTS_BATCH_MAX) {
				const batch = weights.slice(i, i + PARCEL_WEIGHTS_BATCH_MAX);
				const result = await setParcelWeights({ retailerId, weights: batch });
				saved += result.updated;
				// Saved rows leave the list on their own; drop their drafts so a
				// later re-appearance (the seller clears it in the editor) starts
				// blank rather than echoing a stale number.
				setDrafts((d) => {
					const next = { ...d };
					for (const w of batch) delete next[w.variantId];
					return next;
				});
			}
			toast.success(
				saved === 1 ? "1 parcel weight saved" : `${saved} parcel weights saved`,
			);
		} catch (err) {
			const message = convexErrorMessage(err);
			setError(
				saved > 0
					? `${saved} saved, then: ${message} The rest are still here — fix and save again.`
					: message,
			);
		} finally {
			setSaving(false);
		}
	}

	if (products === undefined) {
		return (
			<ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
				{[0, 1].map((n) => (
					<li
						key={n}
						className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
					>
						<Skeleton className="h-4 w-2/5 rounded" />
						<Skeleton className="h-11 w-full rounded-xl" />
						<Skeleton className="h-11 w-full rounded-xl" />
					</li>
				))}
			</ul>
		);
	}

	if (products.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center">
				<CheckCircle2 aria-hidden className="size-8 text-accent-emphasis" />
				<p className="font-medium">Every product is weighed</p>
				<p className="mx-auto max-w-sm text-sm text-muted-foreground">
					{reason
						? "Nothing buyers can order is missing a parcel weight, so every delivery order prices on the real parcel."
						: "Nothing buyers can order is missing a parcel weight. A new product asks for one whenever your delivery charge depends on it."}
				</p>
				<Button asChild variant="outline" className="mt-2 h-11">
					<Link to="/app/products">Back to products</Link>
				</Button>
			</div>
		);
	}

	const productCount = products.length;
	const blankCount = totalChoices - ready.length - bad.length;

	return (
		<div className="flex flex-col gap-4 pb-24 lg:pb-0">
			{/* Why the seller is here, in the reason's own words — never "can't
			    be priced" on a courier store, never "1 kg parcel" on a rate card. */}
			<p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
				{reason ? (
					<>
						<span className="font-medium text-foreground">
							{WEIGHT_REQUIRED_COPY[reason].cause}.
						</span>{" "}
						{WEIGHT_REQUIRED_COPY[reason].detail}
					</>
				) : (
					"Your delivery charge doesn't use parcel weights right now, so these are optional — they're used the moment you switch to a courier or rate card that prices by weight."
				)}
			</p>

			{/* Fill-all: the one control that makes a 40-choice catalogue a
			    minute's work. Touches only EMPTY boxes, says so. */}
			{totalChoices > 1 ? (
				<div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-3">
					<label
						htmlFor="parcel-weights-fill-all"
						className="text-sm font-medium"
					>
						Fill every empty box
					</label>
					<div className="flex items-center gap-2">
						<Input
							id="parcel-weights-fill-all"
							variant="field"
							inputMode="numeric"
							placeholder="500"
							value={fillAll}
							disabled={readOnly}
							onChange={(e) => setFillAll(sanitizeIntInput(e.target.value))}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									fillBlank(fillAll);
								}
							}}
							className="max-w-32 text-right"
							aria-describedby="parcel-weights-fill-all-hint"
						/>
						<span className="text-sm text-muted-foreground">g</span>
						<Button
							type="button"
							variant="outline"
							className="h-11"
							disabled={readOnly || !fillAll || blankCount === 0}
							onClick={() => fillBlank(fillAll)}
						>
							Fill {blankCount} empty
						</Button>
					</div>
					<p
						id="parcel-weights-fill-all-hint"
						className="text-xs text-muted-foreground"
					>
						Only boxes you haven&apos;t typed in change — then adjust the odd
						ones below.
					</p>
				</div>
			) : null}

			<ul className="flex flex-col gap-3">
				{products.map((product) => {
					const ids = new Set<string>(product.choices.map((c) => c.variantId));
					const productBlank = product.choices.filter(
						(c) => weightDraftState(drafts[c.variantId]).kind === "blank",
					).length;
					return (
						<li
							key={product.productId}
							className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
						>
							<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
								<div className="flex min-w-0 flex-col">
									<Link
										to="/app/products/$productId"
										params={{ productId: product.productId }}
										className="truncate font-semibold hover:underline"
									>
										{product.name}
									</Link>
									<span className="text-xs text-muted-foreground">
										{product.choices.length === 1
											? "1 choice needs a weight"
											: `${product.choices.length} choices need a weight`}
									</span>
								</div>
								{/* Per-product fill — a cake's six flavours weigh the same;
								    its three sizes don't, so this is a shortcut, not a rule. */}
								{product.choices.length > 1 ? (
									<ProductFill
										productName={product.name}
										blank={productBlank}
										disabled={readOnly}
										onFill={(v) => fillBlank(v, ids)}
									/>
								) : null}
							</div>
							<ul className="flex flex-col gap-2">
								{product.choices.map((choice) => {
									const state = weightDraftState(drafts[choice.variantId]);
									const id = `parcel-weight-${choice.variantId}`;
									return (
										<li key={choice.variantId} className="flex flex-col gap-1">
											<div className="flex min-h-11 items-center gap-3">
												<label
													htmlFor={id}
													className="min-w-0 flex-1 truncate text-sm"
												>
													{choice.label}
												</label>
												<Input
													id={id}
													variant="field"
													inputMode="numeric"
													placeholder="500"
													value={drafts[choice.variantId] ?? ""}
													disabled={readOnly}
													isError={state.kind === "bad"}
													onChange={(e) =>
														setDraft(choice.variantId, e.target.value)
													}
													className="w-28 text-right"
													aria-label={`Parcel weight in grams for ${product.name} — ${choice.label}`}
												/>
												<span className="w-4 text-sm text-muted-foreground">
													g
												</span>
											</div>
											{state.kind === "bad" ? (
												<p
													role="alert"
													className="pl-0 text-right text-xs text-destructive"
												>
													{state.why}
												</p>
											) : null}
										</li>
									);
								})}
							</ul>
						</li>
					);
				})}
			</ul>

			{/* Sticky save at EVERY width — a 93-row catalogue scrolls the button
			    away on a desktop too (found on the /test-code pass, where the save
			    sat at the foot of 93 rows). Above the bottom nav on a phone, a
			    plate off the page edge on a desktop. Says what it will do. */}
			<div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-2xl border border-border bg-background p-3 shadow-lg lg:bottom-4">
				{error ? (
					<p
						role="alert"
						className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{error}
					</p>
				) : null}
				<Button
					type="button"
					onClick={() => void save()}
					disabled={readOnly || saving || ready.length === 0 || bad.length > 0}
					isLoading={saving}
					className="h-12 w-full lg:w-auto"
				>
					<Save className="size-4" />
					{readOnly
						? "Save — view-only"
						: ready.length === 0
							? `Save weights — ${totalChoices} across ${productCount} product${productCount === 1 ? "" : "s"}`
							: `Save ${ready.length} of ${totalChoices} weight${totalChoices === 1 ? "" : "s"}`}
				</Button>
				<p className="text-xs text-muted-foreground">
					{readOnly
						? readOnlyReason
						: bad.length > 0
							? `Fix the ${bad.length === 1 ? "box" : `${bad.length} boxes`} marked in red to save.`
							: ready.length === 0
								? "Type a weight in grams to save it — you can save a few now and the rest later."
								: ready.length < totalChoices
									? `${totalChoices - ready.length} left blank stay unweighed until you come back.`
									: "Every choice has a weight — save and you're done."}
				</p>
			</div>
		</div>
	);
}

function ProductFill({
	productName,
	blank,
	disabled,
	onFill,
}: {
	productName: string;
	blank: number;
	disabled: boolean;
	onFill: (value: string) => void;
}) {
	const [value, setValue] = useState("");
	return (
		<div className="flex items-center gap-1.5">
			<Input
				inputMode="numeric"
				placeholder="500"
				value={value}
				disabled={disabled}
				onChange={(e) => setValue(sanitizeIntInput(e.target.value))}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						onFill(value);
					}
				}}
				className="h-9 w-20 text-right"
				aria-label={`Fill every empty weight for ${productName}`}
			/>
			<span className="text-xs text-muted-foreground">g</span>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				className="h-9"
				disabled={disabled || !value || blank === 0}
				onClick={() => onFill(value)}
			>
				{blank > 0 ? `Fill all ${blank}` : "All filled"}
			</Button>
		</div>
	);
}
