import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ChevronLeft, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { MAX_PROMOTION_PRODUCTS } from "../../../convex/lib/promotions";
import { convexErrorMessage } from "../../lib/format";
import {
	type FlowProduct,
	type MemberPayload,
	reviewBlockedReason,
	summariseReview,
} from "../../lib/promotion-flow";
import { cn } from "../../lib/utils";
import {
	EMPTY_PROMO_DRAFT,
	PROMO_PERCENT_PRESETS,
	type PromoDraft,
	PromoFields,
	promoDraftFrom,
	promoDraftIssue,
	promoSubmitValue,
} from "../forms/promo-fields";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { PriceReview } from "./price-review";
import { type PickerCatalog, ProductPicker } from "./product-picker";

/**
 * The bulk promotion flow (`z8r3fducfd`): pick products → set the discount →
 * review every price → save. Three entries share it so the same questions are
 * always asked by the same controls:
 *
 *  - `create` — all three steps;
 *  - `edit`   — terms + review of the products already in it, seeded from
 *               the prices the storefront is showing now (so a per-product
 *               override made in a product form survives an edit);
 *  - `add`    — pick + review, on the promotion's existing terms.
 *
 * The terms step is the product form's own `PromoFields` in its terms-only
 * mode — one set of "When does it start? / How long does it run?" questions
 * in the whole app.
 */

type Step = "pick" | "terms" | "review";

const STEPS: Record<"create" | "edit" | "add", Step[]> = {
	create: ["pick", "terms", "review"],
	edit: ["terms", "review"],
	add: ["pick", "review"],
};

const STEP_TITLE: Record<Step, string> = {
	pick: "Which products are on sale?",
	terms: "Set the discount",
	review: "Check the sale prices",
};

type Props = {
	retailerId: Id<"retailers">;
	currency: string;
	catalog: PickerCatalog;
	/** Why nothing can be saved here (lapsed store, no write grant, Starter). */
	blockedReason: string | null;
	mode: "create" | "edit" | "add";
	/** The promotion being edited or added to — or, in `create`, the ended
	 * one being run again (its name, extras and products pre-filled). */
	promotion?: Doc<"promotions">;
	/** `edit`: the products in it now, with their live prices. `create` from
	 * "Run again": the products it last ran on. */
	members?: FlowProduct[];
	/** `edit`: each line's live sale price, so the review starts from what
	 * the storefront shows. */
	seedPrices?: Record<string, string>;
};

/** The flow works in plain string ids (the catalog's); the server takes
 * typed ones. One conversion, at the one place the payload leaves. */
function toMemberArgs(members: MemberPayload[]) {
	return members.map((m) => ({
		productId: m.productId as Id<"products">,
		prices: m.prices.map((p) => ({
			variantId: p.variantId as Id<"productVariants">,
			promoPrice: p.promoPrice,
		})),
	}));
}

function requirePromotion(promotion: Doc<"promotions"> | undefined) {
	if (!promotion) throw new Error("This step needs a promotion");
	return promotion;
}

export function PromotionFlow(props: Props) {
	const { retailerId, currency, catalog, blockedReason, mode } = props;
	const navigate = useNavigate();
	const create = useMutation(api.promotions.create);
	const update = useMutation(api.promotions.update);
	const addProducts = useMutation(api.promotions.addProducts);

	const steps = STEPS[mode];
	const [stepIndex, setStepIndex] = useState(0);
	const step = steps[stepIndex];

	const [selected, setSelected] = useState<Set<string>>(
		() =>
			new Set(
				mode === "create" && props.members
					? props.members.map((m) => m._id)
					: [],
			),
	);
	const [moving, setMoving] = useState<Set<string>>(() => new Set());
	const [percentOff, setPercentOff] = useState<number>(
		props.promotion?.percentOff ?? 20,
	);
	const [otherPercent, setOtherPercent] = useState("");
	const [draft, setDraft] = useState<PromoDraft>(() => {
		// "Run again" keeps the name and the flash extras but never the old
		// dates — an ended window is exactly what it can't reuse.
		if (props.promotion && mode === "create")
			return {
				...EMPTY_PROMO_DRAFT,
				on: true,
				label: props.promotion.label ?? "",
				unitCap: props.promotion.unitCap?.toString() ?? "",
				maxPerOrder: props.promotion.maxPerOrder?.toString() ?? "",
				payWithinMinutes: props.promotion.payWithinMinutes ?? 0,
			};
		if (props.promotion)
			return { ...promoDraftFrom(props.promotion), on: true };
		return { ...EMPTY_PROMO_DRAFT, on: true };
	});
	const [overrides, setOverrides] = useState<Record<string, string>>(
		() => props.seedPrices ?? {},
	);
	const [recalculated, setRecalculated] = useState(false);
	const [saving, setSaving] = useState(false);

	// The products under review: the picked ones (create/add), or the
	// promotion's own (edit). Catalog rows carry everything the review needs.
	const reviewProducts: FlowProduct[] = useMemo(() => {
		if (mode === "edit") return props.members ?? [];
		return catalog.products.filter((p) => selected.has(p._id));
	}, [mode, props.members, catalog.products, selected]);

	const summary = summariseReview(reviewProducts, percentOff, overrides);
	// A product with nothing on sale doesn't JOIN a promotion — it would carry
	// the window with no price under it. On an edit it stays (its blank lines
	// are a choice to apply); taking it out is the × on the promotion page.
	const sendMembers =
		mode === "edit"
			? summary.members
			: summary.members.filter((m) => m.prices.length > 0);
	const now = Date.now();
	const termsIssue = mode === "add" ? undefined : promoDraftIssue(draft, now);
	const hasFlashExtras =
		draft.unitCap.trim() !== "" ||
		draft.maxPerOrder.trim() !== "" ||
		draft.payWithinMinutes > 0;

	function choosePercent(next: number) {
		if (next === percentOff) return;
		setPercentOff(next);
		// A new percent re-prices every line. Typed prices from before were
		// for the old percent, so they go — and the review says so, rather
		// than leaving the seller to spot which lines quietly stayed put.
		if (Object.keys(overrides).length > 0) {
			setOverrides({});
			setRecalculated(true);
		}
	}

	const label = draft.label.trim() || props.promotion?.label || "Promotion";

	// The one reason the primary action is off, in priority order.
	const nextBlocked: string | null =
		step === "pick"
			? selected.size === 0
				? "Pick at least one product."
				: selected.size > MAX_PROMOTION_PRODUCTS
					? `One promotion holds up to ${MAX_PROMOTION_PRODUCTS} products.`
					: null
			: step === "terms"
				? !Number.isInteger(percentOff) || percentOff < 1 || percentOff > 99
					? "Pick how much off — a whole percent from 1 to 99."
					: (termsIssue ?? null)
				: (blockedReason ?? reviewBlockedReason(summary));

	async function save() {
		const terms = promoSubmitValue(draft, Date.now());
		const members = toMemberArgs(sendMembers);
		const move = [...moving]
			.filter((id) => selected.has(id))
			.map((id) => id as Id<"products">);
		setSaving(true);
		try {
			if (mode === "add") {
				const promotion = requirePromotion(props.promotion);
				await addProducts({ promotionId: promotion._id, members, move });
				toast.success(`${productsLabel(sendMembers.length)} added to ${label}`);
				navigate({
					to: "/app/promotions/$promotionId",
					params: { promotionId: promotion._id },
				});
				return;
			}
			const payload = {
				label: terms?.label,
				percentOff,
				startsAt: terms?.startsAt,
				endsAt: terms?.endsAt,
				unitCap: terms?.unitCap,
				maxPerOrder: terms?.maxPerOrder,
				payWithinMinutes: terms?.payWithinMinutes,
				members,
			};
			if (mode === "edit") {
				const promotion = requirePromotion(props.promotion);
				await update({ promotionId: promotion._id, ...payload });
				toast.success(`${label} updated`);
				navigate({
					to: "/app/promotions/$promotionId",
					params: { promotionId: promotion._id },
				});
				return;
			}
			const promotionId = await create({
				retailerId,
				...payload,
				move,
			});
			toast.success(
				terms?.startsAt !== undefined && terms.startsAt > Date.now()
					? `${label} is scheduled on ${productsLabel(sendMembers.length)}`
					: `${label} is live on ${productsLabel(sendMembers.length)}`,
			);
			navigate({
				to: "/app/promotions/$promotionId",
				params: { promotionId },
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function goNext() {
		if (nextBlocked) return;
		if (stepIndex < steps.length - 1) {
			setStepIndex(stepIndex + 1);
			window.scrollTo({ top: 0 });
		} else void save();
	}

	function goBack() {
		if (stepIndex > 0) {
			setStepIndex(stepIndex - 1);
			window.scrollTo({ top: 0 });
		}
	}

	const primaryLabel =
		step === "pick"
			? mode === "add"
				? `Next: review ${selected.size} ${selected.size === 1 ? "product" : "products"}`
				: "Next: set the discount"
			: step === "terms"
				? `Next: review ${summary.total} ${summary.total === 1 ? "price" : "prices"}`
				: saving
					? "Saving…"
					: mode === "edit"
						? `Update ${label} on ${productsLabel(sendMembers.length)}`
						: mode === "add"
							? `Add ${productsLabel(sendMembers.length)} to ${label}`
							: draft.startMode === "schedule"
								? `Schedule ${label} on ${productsLabel(sendMembers.length)}`
								: `Start ${label} on ${productsLabel(sendMembers.length)}`;

	const backTo = props.promotion
		? {
				to: "/app/promotions/$promotionId" as const,
				params: { promotionId: props.promotion._id },
			}
		: { to: "/app/promotions" as const };

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<div className="flex items-center gap-1">
				{stepIndex > 0 ? (
					<button
						type="button"
						onClick={goBack}
						aria-label="Back to the previous step"
						className="tap-target -ml-2 flex items-center justify-center rounded-lg text-foreground hover:bg-muted"
					>
						<ChevronLeft className="size-5" aria-hidden />
					</button>
				) : (
					<Link
						{...backTo}
						aria-label="Back to promotions"
						className="tap-target -ml-2 flex items-center justify-center rounded-lg text-foreground hover:bg-muted"
					>
						<ChevronLeft className="size-5" aria-hidden />
					</Link>
				)}
				<div className="flex min-w-0 flex-col">
					<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
						Step {stepIndex + 1} of {steps.length}
						{mode !== "create" && props.promotion
							? ` · ${props.promotion.label ?? "Promotion"}`
							: ""}
					</span>
					<h1 className="font-heading text-xl font-extrabold leading-tight">
						{STEP_TITLE[step]}
					</h1>
				</div>
			</div>

			{blockedReason ? (
				<div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground">
					<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p className="text-xs leading-relaxed">{blockedReason}</p>
				</div>
			) : null}

			{step === "pick" ? (
				<ProductPicker
					catalog={catalog}
					mode={mode === "add" ? "add" : "create"}
					selected={selected}
					onSelectedChange={setSelected}
					moving={moving}
					onMovingChange={setMoving}
					currency={currency}
				/>
			) : null}

			{step === "terms" ? (
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<span className="text-sm font-semibold">How much off?</span>
						<div className="flex flex-wrap gap-2">
							{PROMO_PERCENT_PRESETS.map((p) => (
								<button
									key={p}
									type="button"
									aria-pressed={percentOff === p && otherPercent === ""}
									onClick={() => {
										setOtherPercent("");
										choosePercent(p);
									}}
									className={chip(percentOff === p && otherPercent === "")}
								>
									{p}% off
								</button>
							))}
							<label
								className={cn(
									chip(otherPercent !== ""),
									"inline-flex items-center gap-1",
								)}
							>
								Other
								<Input
									aria-label="Other percentage off"
									inputMode="numeric"
									placeholder="—"
									className="h-8 w-12 border-0 bg-transparent px-1 text-right shadow-none focus-visible:ring-0"
									value={otherPercent}
									onChange={(e) => {
										const raw = e.target.value
											.replace(/[^0-9]/g, "")
											.slice(0, 2);
										setOtherPercent(raw);
										const n = Number.parseInt(raw, 10);
										if (Number.isInteger(n)) choosePercent(n);
									}}
								/>
								%
							</label>
						</div>
						<p className="text-xs text-muted-foreground">
							Rounded to the nearest 5 sen. You can change any single line on
							the next step.
						</p>
					</div>

					<div className="rounded-2xl border border-border p-4">
						<PromoFields
							draft={draft}
							onChange={(next) => setDraft({ ...next, on: true })}
							rows={[]}
							onPromoPrices={() => {}}
							currency={currency}
							noToggle
							pricing="none"
							now={now}
						/>
					</div>
					<p className="-mt-2 text-xs text-muted-foreground">
						A unit cap applies to <b>each product</b> on its own, not to the
						promotion as a whole. Bookings and events take the sale price but
						not the flash extras.
					</p>
				</div>
			) : null}

			{step === "review" ? (
				<>
					{recalculated ? (
						<p className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
							Prices recalculated at {percentOff}% off — the per-line prices
							from before were for the old discount, so they've been replaced.
						</p>
					) : null}
					{mode !== "edit" && summary.emptyProducts.length > 0 ? (
						<p className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
							Left out — nothing on it can go on sale:{" "}
							<b className="text-foreground">
								{summary.emptyProducts.join(", ")}
							</b>
							.
						</p>
					) : null}
					<PriceReview
						products={reviewProducts}
						percentOff={percentOff}
						overrides={overrides}
						onOverride={(id, value) =>
							setOverrides((prev) => ({ ...prev, [id]: value }))
						}
						currency={currency}
						summary={summary}
						hasFlashExtras={hasFlashExtras}
					/>
				</>
			) : null}

			{/* Sticky CTA — the next step must never scroll away, and it says
			    what it will do, with the reason beside it when off. Sticky on
			    desktop too: a 60-product picker is far taller than a laptop
			    screen, and a static footer left "Next" and the selected count
			    a long scroll below the list (found hands-on). Mobile sits above
			    the bottom nav; desktop has none, so it rests on the edge. */}
			<div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-2xl bg-background/95 pt-2 backdrop-blur lg:bottom-0 lg:rounded-none lg:border-t lg:border-border lg:pb-4 lg:pt-3">
				{step === "pick" && selected.size > 0 ? (
					<div className="flex items-center justify-between text-[13px]">
						<span className="text-muted-foreground">
							<b className="text-foreground">
								{selected.size} {selected.size === 1 ? "product" : "products"}
							</b>{" "}
							selected
						</span>
						<button
							type="button"
							onClick={() => {
								setSelected(new Set());
								setMoving(new Set());
							}}
							className="tap-target px-1 font-semibold text-accent-emphasis hover:underline"
						>
							Clear ({selected.size})
						</button>
					</div>
				) : null}
				<Button
					type="button"
					onClick={goNext}
					disabled={nextBlocked !== null || saving}
					className="h-12 w-full shadow-lg shadow-accent/20 lg:shadow-none"
				>
					{primaryLabel}
				</Button>
				{nextBlocked ? (
					<p className="text-center text-xs text-muted-foreground">
						{nextBlocked}
					</p>
				) : step === "review" ? (
					<p className="text-center text-xs text-muted-foreground">
						You can change it or end it any time — ending puts every price back.
					</p>
				) : null}
			</div>
		</div>
	);
}

const productsLabel = (n: number) => `${n} ${n === 1 ? "product" : "products"}`;

function chip(active: boolean) {
	return cn(
		"tap-target box-border rounded-full border-2 px-3.5 text-sm font-semibold transition-colors",
		active
			? "border-accent bg-accent/10 text-accent-emphasis"
			: "border-border bg-background text-muted-foreground hover:border-accent/40",
	);
}

export function FlowSkeleton() {
	return (
		<div className="flex flex-col gap-3 lg:max-w-2xl">
			<Skeleton className="h-12 w-64 rounded-xl" />
			<Skeleton className="h-11 rounded-xl" />
			<Skeleton className="h-40 rounded-2xl" />
			<Skeleton className="h-40 rounded-2xl" />
		</div>
	);
}

/** A promotion link that no longer resolves — deleted with its store, or a
 * stale bookmark. Says so and gives the way back, never a blank page. */
export function PromotionGone() {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center lg:max-w-2xl">
			<p className="font-medium">This promotion isn't here any more</p>
			<p className="text-sm text-muted-foreground">
				It may have been removed along with its products.
			</p>
			<Button asChild className="tap-target">
				<Link to="/app/promotions">Back to promotions</Link>
			</Button>
		</div>
	);
}

/** Edit / Add on a promotion that has already ended (a stale tab or link):
 * nothing to change any more — say so and point at the one way forward. */
export function PromotionEnded({
	promotionId,
	label,
}: {
	promotionId: string;
	label?: string;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center lg:max-w-2xl">
			<p className="font-medium">{label ?? "This promotion"} has ended</p>
			<p className="text-sm text-muted-foreground">
				Its products are back at their normal prices. Run it again to start a
				new one with the same products.
			</p>
			<Button asChild className="tap-target">
				<Link to="/app/promotions/$promotionId" params={{ promotionId }}>
					Open {label ?? "the promotion"}
				</Link>
			</Button>
		</div>
	);
}
