/**
 * Delyva courier dispatch card — order detail (86eyjpv6z).
 *
 * The Lalamove `BookDeliveryCard`'s sibling for parcels, and it differs where
 * Delyva differs. Lalamove returns ONE price bound to a 5-minute quotation id,
 * so its flow is a modal with a countdown. Delyva returns a LIST of courier
 * services whose prices are indicative — the order create re-prices — so there
 * is no quotation to expire, nothing to count down, and the real task is a
 * comparison. That makes the picker INLINE on the card rather than trapped in
 * a modal: on a phone, a scrollable courier list inside a scrollable dialog is
 * the worse of the two.
 *
 * An empty service list is a normal answer ("no courier takes a chilled 2.5 kg
 * parcel to this address"), not an error — it renders as an empty state that
 * hands off to the manual-courier flow instead of a dead end.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
	CircleAlert,
	ExternalLink,
	FlaskConical,
	MapPin,
	Printer,
	RefreshCw,
	Snowflake,
	Truck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { DelyvaJobView } from "../../../convex/delyva";
import { walletVerdict } from "../../../convex/lib/courierWallet";
import {
	isActiveJobStatus,
	isCourierLinkPending,
} from "../../../convex/lib/deliveryJobs";
import {
	type DelyvaItemType,
	type DelyvaService,
	delyvaHandoff,
	delyvaLabelAvailability,
	delyvaLogoUrl,
	delyvaSpeedLabel,
} from "../../../convex/lib/delyva";
import { courierMargin } from "../../lib/courier-margin";
import {
	courierContactFallbackCopy,
	delyvaBlockCopy,
	delyvaStatusLabel,
} from "../../lib/delyva-dispatch-block";
import { delyvaSurface } from "../../lib/dispatch-surface";
import { downloadPdfBytes } from "../../lib/download";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import {
	type CourierHandoff,
	courierLinkPendingSellerCopy,
	dropoffSteps,
	HANDOFF_PICKER_NOTE,
	LABEL_UNAVAILABLE_COPY,
	LEGACY_BOOKED_COPY,
	parcelDeliveredCopy,
	pickupCollectionCopy,
} from "../../lib/parcel-courier-copy";
import { TONE_PANEL } from "../../lib/tone";
import { ProBadge } from "../app/pro-gate";
import { DispatchWalletLine } from "../deliveries/dispatch-wallet-line";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { Input } from "../ui/input";
import { CourierLogo } from "./courier-logo";
import { HandoffPill } from "./handoff-pill";
import { pricedWithoutWeight, weightGapLine } from "./weight-gap-note";

const ITEM_TYPES: ReadonlyArray<{ value: DelyvaItemType; label: string }> = [
	{ value: "PARCEL", label: "Parcel" },
	{ value: "CHILLED", label: "Chilled" },
	{ value: "FROZEN", label: "Frozen" },
];

/** Terminal statuses free the order's booking slot — a rebook is allowed. */
export function DelyvaDispatchCard({
	order,
	embedded = false,
	lockedReason,
}: {
	order: Doc<"orders">;
	/** Rendered inside the dispatch hub's shell — see BookDeliveryCard. */
	embedded?: boolean;
	/** Set while the store can't book right now (out of credits, or
	 * view-only) — see BookDeliveryCard. Cancelling stays open. */
	lockedReason?: string;
}) {
	const dispatch = useQuery(
		convexQuery(api.delyva.getDispatchState, { shortId: order.shortId }),
	).data;
	// The same wallet read the line beside Book shows (the cache shares it).
	const wallets = useQuery(
		convexQuery(api.courierWallets.list, { retailerId: order.retailerId }),
	).data;

	const prepareBooking = useAction(api.delyva.prepareBooking);
	const confirmBooking = useAction(api.delyva.confirmBooking);
	const cancelBooking = useAction(api.delyva.cancelBooking);
	const getLabel = useAction(api.delyva.getLabel);

	const [itemType, setItemType] = useState<DelyvaItemType | null>(null);
	const [weightInput, setWeightInput] = useState("");
	const [services, setServices] = useState<DelyvaService[] | null>(null);
	/** Set with an empty `services` list: the account has no courier switched
	 * on at all, so no address would quote. Distinguishes "you have nothing
	 * connected" from "nobody covers this route". */
	const [noCouriersOnAccount, setNoCouriersOnAccount] = useState(false);
	// How many couriers the seller's Delyva account has switched on — couriers
	// are opt-in there, so the list's footer says the count (z8r3fdx34j).
	const [activeCourierCount, setActiveCourierCount] = useState<number | null>(
		null,
	);
	/** Set with an empty list on a chilled/frozen quote: the same route quotes
	 * fine as an ordinary parcel, so the gap is cold chain on the account. */
	const [coldChainGap, setColdChainGap] = useState(false);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);
	const [quoting, setQuoting] = useState(false);
	const [booking, setBooking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	const [printingLabel, setPrintingLabel] = useState(false);

	// Seed the weight field from the order's own parcel weight ONCE, when the
	// dispatch state first arrives. Keyed on a ref rather than `weightInput ===
	// ""` so that clearing the field to retype a weight doesn't instantly snap
	// the computed value back in under the seller's cursor.
	const seededWeight = useRef(false);
	useEffect(() => {
		if (seededWeight.current) return;
		if (dispatch?.computedWeightKg != null) {
			seededWeight.current = true;
			setWeightInput(String(dispatch.computedWeightKg));
		}
	}, [dispatch?.computedWeightKg]);

	// One source for "does this provider have anything to show here" — the
	// dispatch hub asks the same question before it offers a tab.
	const surface = delyvaSurface(order, dispatch);
	if (surface === "none" || !dispatch) return null;

	const job = dispatch.job;
	const activeJob = job && isActiveJobStatus(job.status) ? job : null;
	const failedJob =
		job &&
		(job.status === "canceled" ||
			job.status === "expired" ||
			job.status === "rejected")
			? job
			: null;
	const completedJob = job?.status === "completed" ? job : null;
	const blockReason = dispatch.blockReason;
	const bookable = blockReason === null;
	const effectiveItemType = itemType ?? dispatch.defaultItemType;

	// Not bookable from here yet — a one-line hint, not a disabled button for
	// a feature the seller has never heard of. Which hint depends on WHY:
	// telling a connected seller to "connect Delyva" sends them looking for a
	// screen they already finished, and hides the switch they actually need.
	if (surface === "hint") {
		if (blockReason === "disabled") {
			return (
				<p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
					<Truck className="mr-1.5 inline size-3.5 align-[-2px]" />
					Delyva booking is paused — turn <b>Delyva couriers</b> back on under
					Courier booking in{" "}
					<Link
						to="/app/settings/delivery-pricing"
						hash="courier-booking"
						className="font-medium text-accent hover:underline"
					>
						Settings → Delivery pricing
					</Link>
					.
				</p>
			);
		}
		if (blockReason === "plan_gated") {
			return (
				<p className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
					<Truck className="size-3.5" />
					Book couriers straight from an order — nationwide and cold chain.
					<ProBadge />
				</p>
			);
		}
		return (
			<p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
				<Truck className="mr-1.5 inline size-3.5 align-[-2px]" />
				Ship parcels without leaving Kedaipal —{" "}
				<Link
					to="/app/settings"
					search={{ tab: "integrations" }}
					className="font-medium text-accent hover:underline"
				>
					connect Delyva
				</Link>{" "}
				to book couriers and have tracking numbers fill themselves in.
			</p>
		);
	}

	const weightKg = Number(weightInput);
	const weightValid = Number.isFinite(weightKg) && weightKg > 0;
	const needsTypedWeight = dispatch.computedWeightKg === null;

	async function handleQuote() {
		setQuoting(true);
		setError(null);
		try {
			const result = await prepareBooking({
				shortId: order.shortId,
				itemType: effectiveItemType,
				weightKgOverride: weightValid ? weightKg : undefined,
			});
			if (!result.ok) {
				setError(result.message ?? delyvaBlockCopy(result.reason));
				setServices(null);
				return;
			}
			setServices(result.services);
			// A row with no service class is shown as pickup — Delyva's
			// convention is that only drop-off services carry a suffix — but
			// it is a guess, so it is logged where a support thread can find it.
			const untyped = result.services.filter(
				(s) => delyvaHandoff(s.serviceType) === undefined,
			);
			if (untyped.length > 0) {
				console.warn(
					"[delyva] quote rows without a serviceType, shown as pickup",
					{ shortId: order.shortId, codes: untyped.map((s) => s.code) },
				);
			}
			setNoCouriersOnAccount(result.accountHasNoCouriers === true);
			setActiveCourierCount(result.activeCourierCount ?? null);
			setColdChainGap(result.coldChainUnavailable === true);
			// Cheapest pre-selected — the list arrives price-sorted from the server.
			setSelectedCode(result.services[0]?.code ?? null);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setQuoting(false);
		}
	}

	async function handleBook() {
		const service = services?.find((s) => s.code === selectedCode);
		if (!service) return;
		setBooking(true);
		setError(null);
		try {
			const result = await confirmBooking({
				shortId: order.shortId,
				serviceCode: service.code,
				serviceName: service.name,
				serviceType: service.serviceType,
				itemType: effectiveItemType,
				weightKgOverride: weightValid ? weightKg : undefined,
			});
			if (!result.ok) {
				// In-place, not a toast: the seller has just come back from a top-up
				// and the reason must still be on screen (the 86eypncfy lesson).
				setError(result.message ?? delyvaBlockCopy(result.reason));
				return;
			}
			setServices(null);
			setSelectedCode(null);
			toast.success(`${service.name} booked`);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setBooking(false);
		}
	}

	/**
	 * The courier's own label (z8r3fe11x3). PDF bytes are saved the way the
	 * despatch label is (`downloadPdfBytes` — printing a saved PDF is one tap
	 * on every platform, and a `window.open` on a blob after an await is
	 * popup-blocked on iOS Safari); a URL opens in a new tab. A failure is a
	 * toast carrying Delyva's own message, never silence.
	 */
	async function handlePrintLabel() {
		setPrintingLabel(true);
		try {
			const result = await getLabel({ shortId: order.shortId });
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			if (result.kind === "pdf") {
				downloadPdfBytes(result.filename, result.pdf);
			} else {
				window.open(result.url, "_blank", "noopener");
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPrintingLabel(false);
		}
	}

	const selected = services?.find((s) => s.code === selectedCode) ?? null;
	// Since 31 Oct the quote reads Delyva's balance too, so a wallet that
	// can't pay is known before the tap: Book disables with the wallet line as
	// its reason, exactly like EasyParcel. A stale or refusal-seen number only
	// warns (walletVerdict) — Delyva stays the final judge.
	const walletView = wallets?.find((w) => w.provider === "delyva");
	const selectedUnaffordable =
		selected !== null &&
		walletView !== undefined &&
		walletVerdict(walletView, selected.price, Date.now(), selected.currency) ===
			"block";

	return (
		<section
			// `@container`: the picker row and the handoff pill size by the CARD's
			// width (`@md`), not the viewport — the order page is one phone-width
			// column until `lg`, and the hub may narrow it further.
			className={
				embedded
					? "@container flex flex-col gap-3"
					: "@container flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
			}
		>
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Delyva Courier
				</p>
				{job && !failedJob ? (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
							completedJob
								? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
								: "bg-accent/15 text-accent-emphasis"
						}`}
					>
						{delyvaStatusLabel(job.status)}
					</span>
				) : null}
			</div>

			{/* A demo booking dispatches no courier and spends play money, and
			    looks identical to a real one until nobody turns up — so it is said
			    at the point of spend, not only in Settings (86eypncfy). */}
			{dispatch.isDemo ? (
				<p className="flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
					<FlaskConical className="mt-0.5 size-4 shrink-0" />
					<span>
						<span className="font-medium">
							Test mode — no courier will come.
						</span>{" "}
						Your Delyva key is a demo-account key, so any booking here is
						simulated and nothing is really charged. Connect your live key in{" "}
						<Link
							to="/app/settings"
							search={{ tab: "integrations" }}
							className="font-medium underline underline-offset-2"
						>
							Settings → Integrations
						</Link>
						.
					</span>
				</p>
			) : null}

			{/* Failed booking — amber, with the one-tap rebook below it. */}
			{failedJob && !activeJob ? (
				<p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
					<CircleAlert className="mt-0.5 size-4 shrink-0" />
					<span>
						<span className="font-medium">Booking didn&apos;t go through</span>
						{failedJob.failureReason ? ` — ${failedJob.failureReason}` : ""}.
						Your buyer was not notified; the order is unchanged.
					</span>
				</p>
			) : null}

			{job && (activeJob || completedJob) ? (
				<BookedState
					job={job}
					order={order}
					completed={completedJob !== null}
					active={activeJob !== null}
					pickupSummary={dispatch.pickupSummary}
					printingLabel={printingLabel}
					onPrintLabel={() => void handlePrintLabel()}
					onCancel={() => setConfirmingCancel(true)}
				/>
			) : bookable && !lockedReason ? (
				<>
					{/* Where the courier collects — surfaced BEFORE the first quote so a
					    stale pickup address (imported from Delyva's profile at connect)
					    is caught at the moment it matters, with the edit one tap away. */}
					{dispatch.pickupSummary ? (
						<p className="text-xs text-muted-foreground">
							Collecting from{" "}
							<span className="font-medium text-foreground">
								{dispatch.pickupSummary}
							</span>{" "}
							·{" "}
							<Link
								to="/app/settings"
								search={{ tab: "integrations" }}
								className="font-medium text-accent hover:underline"
							>
								Edit
							</Link>
						</p>
					) : null}

					{/* Who the courier will phone at the buyer's end — said before the
					    first quote, so a seller isn't surprised when the courier calls
					    the store about an overseas buyer (z8r3fdh274). */}
					{dispatch.buyerContactFallback ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							{courierContactFallbackCopy(dispatch.country)}
						</p>
					) : null}

					{/* What is being shipped, in the seller's terms. The weight is the
					    one number that changes the price, so it is editable here rather
					    than hidden behind a re-quote. */}
					<div className="flex flex-col gap-1.5">
						{/* The buyer was priced without part of the weight (the
						    one-kilo floor, or lines with no weight in a heavier cart):
						    the seller must know it BEFORE they pick a service, where
						    "buyer paid" sits beside every price — the one place the
						    under-collection shows. */}
						{pricedWithoutWeight(order.deliverySnapshot) ? (
							<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
								{weightGapLine(order.deliverySnapshot)}
							</p>
						) : null}
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium text-muted-foreground">
								Parcel weight
							</span>
							{!needsTypedWeight ? (
								<span className="text-[11px] text-muted-foreground">
									From your product weights
								</span>
							) : null}
						</div>
						<div className="flex items-center gap-2">
							<Input
								variant="field"
								type="text"
								inputMode="decimal"
								aria-label="Parcel weight in kilograms"
								value={weightInput}
								disabled={quoting || booking}
								isError={weightInput !== "" && !weightValid}
								onChange={(e) => {
									setWeightInput(e.target.value.replace(/[^\d.]/g, ""));
									// Prices are per-weight — an edited weight invalidates them.
									setServices(null);
									setError(null);
								}}
								className="max-w-28"
							/>
							<span className="text-sm text-muted-foreground">kg</span>
						</div>
						{needsTypedWeight ? (
							<p className="text-xs text-muted-foreground">
								{dispatch.weightIssue === "custom_item" ? (
									"This order has a custom line, so we can't work its weight out — weigh the packed parcel and type it here."
								) : (
									<>
										Some items here have no parcel weight set, so we can&apos;t
										add it up — weigh the packed parcel and type it here. Set
										the weights once in{" "}
										<Link
											to="/app/products"
											className="font-medium text-accent-emphasis underline-offset-2 hover:underline"
										>
											Products
										</Link>{" "}
										and the next booking fills itself in.
									</>
								)}
							</p>
						) : null}
					</div>

					{/* Parcel type — the store default, overridable for this one order.
					    Changing it re-filters which couriers can take the parcel, so the
					    prices are dropped with it. */}
					<div className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							Parcel type
						</span>
						<div className="flex flex-wrap gap-2">
							{ITEM_TYPES.map((type) => {
								const active = effectiveItemType === type.value;
								return (
									<button
										key={type.value}
										type="button"
										aria-pressed={active}
										disabled={quoting || booking}
										onClick={() => {
											setItemType(type.value);
											setServices(null);
											setError(null);
										}}
										className={`flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-xs font-medium transition-colors disabled:opacity-60 ${
											active
												? "border-accent bg-accent/[0.08] font-semibold text-accent-emphasis"
												: "border-border bg-card text-muted-foreground hover:border-accent/40"
										}`}
									>
										{type.value !== "PARCEL" ? (
											<Snowflake className="size-3" />
										) : null}
										{type.label}
									</button>
								);
							})}
						</div>
						{effectiveItemType !== dispatch.defaultItemType ? (
							<p className="text-xs text-muted-foreground">
								Just for this order — your store default stays{" "}
								{dispatch.defaultItemType === "PARCEL"
									? "Parcel"
									: dispatch.defaultItemType === "CHILLED"
										? "Chilled"
										: "Frozen"}
								.
							</p>
						) : null}
					</div>

					{error ? (
						<p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
							<CircleAlert className="mt-0.5 size-4 shrink-0" />
							<span>{error}</span>
						</p>
					) : null}

					{services === null ? (
						<Button
							type="button"
							className="h-11 w-full"
							isLoading={quoting}
							disabled={quoting || !weightValid}
							onClick={() => void handleQuote()}
						>
							{quoting ? (
								"Getting courier prices…"
							) : (
								<>
									<Truck className="size-4" />
									{failedJob ? "Try again" : "Get courier prices"}
								</>
							)}
						</Button>
					) : services.length === 0 && noCouriersOnAccount ? (
						/* The account itself has no courier switched on — every address
						   would come back empty, so blaming this one would send the
						   seller re-typing addresses forever (Zaki's SG account, 3 Sep:
						   an empty Service Providers panel). Name the real cause. */
						<div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-3 py-3.5">
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">
									Your Delyva account has no couriers switched on yet.
								</span>{" "}
								Nothing can be quoted until at least one is active — this
								isn&apos;t about this order&apos;s address.
							</p>
							<p className="text-sm text-muted-foreground">
								Open <b>Delyva → Settings → Integrations</b> to connect a
								courier you already have an account with, or ask Delyva support
								to enable their courier partners for your account. Meanwhile,
								arrange delivery yourself and add the tracking number below.
							</p>
							<button
								type="button"
								className="min-h-9 text-xs font-medium text-accent underline-offset-2 hover:underline"
								onClick={() => setServices(null)}
							>
								Start over
							</button>
						</div>
					) : services.length === 0 && coldChainGap ? (
						/* The same route quotes fine as a parcel, so nothing is wrong
						   with the address — this account simply has no cold-chain
						   service. Delyva filters item types server-side, so the two
						   are indistinguishable without asking twice. */
						<div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-3 py-3.5">
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">
									None of the couriers on your Delyva account carries{" "}
									{effectiveItemType.toLowerCase()} parcels.
								</span>{" "}
								This same route quotes fine as an ordinary parcel, so it
								isn&apos;t the address or the weight.
							</p>
							<p className="text-sm text-muted-foreground">
								Ask Delyva to enable a cold-chain service on your account — then
								re-quote here. If these goods aren&apos;t temperature-sensitive
								after all, switch the parcel type to <b>Parcel</b> above.
							</p>
							<button
								type="button"
								className="min-h-9 text-xs font-medium text-accent underline-offset-2 hover:underline"
								onClick={() => setServices(null)}
							>
								Start over
							</button>
						</div>
					) : services.length === 0 ? (
						<div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-3 py-3.5">
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">
									No courier can take a{" "}
									{effectiveItemType === "PARCEL"
										? "parcel"
										: effectiveItemType.toLowerCase()}{" "}
									this weight to this address right now.
								</span>{" "}
								{effectiveItemType !== "PARCEL"
									? "Cold-chain couriers cover far less ground than ordinary parcels — check with Delyva before promising a chilled or frozen delivery to a distant address."
									: ""}
							</p>
							<p className="text-sm text-muted-foreground">
								{effectiveItemType !== "PARCEL"
									? "Try Parcel if the goods aren't temperature-sensitive, or arrange"
									: "Arrange"}{" "}
								delivery yourself and add the tracking number below — your buyer
								still gets the shipped update.
							</p>
							<button
								type="button"
								className="min-h-9 text-xs font-medium text-accent underline-offset-2 hover:underline"
								onClick={() => setServices(null)}
							>
								Start over
							</button>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-xs font-medium text-muted-foreground">
									Choose a courier
								</span>
								<span className="text-[11px] text-muted-foreground">
									{/* The comparison only means something in one currency.
									    A Delyva account belonging to another market prices in
									    ITS currency (a Malaysian account quotes MYR for a
									    Singapore store), and "buyer paid S$6.00" next to
									    "RM 0.10" invites a margin call out of thin air. */}
									{services.some((s) => s.currency !== order.currency) ? (
										<>
											Quoted in {services[0]?.currency} — buyer paid{" "}
											{formatPrice(order.deliveryFee ?? 0, order.currency)}, so
											these prices aren&apos;t directly comparable
										</>
									) : (
										<>
											Buyer paid{" "}
											{formatPrice(order.deliveryFee ?? 0, order.currency)}
										</>
									)}
								</span>
							</div>
							{services.map((service, index) => {
								const active = service.code === selectedCode;
								// A missing class renders as pickup (Delyva suffixes only
								// drop-off services) — logged at quote time, never guessed
								// silently.
								const handoff = delyvaHandoff(service.serviceType) ?? "pickup";
								return (
									<button
										key={service.code}
										type="button"
										aria-pressed={active}
										disabled={booking}
										onClick={() => setSelectedCode(service.code)}
										// Board 1 grid: logo | name, meta, pill | price (44|1fr|92, then
										// 48|1fr|104 once the card is `@md` wide). The price column is
										// FIXED so a long service name wraps under itself instead of
										// pushing the number, and nothing here truncates — a seller
										// comparing couriers reads whole names.
										className={`grid w-full grid-cols-[44px_minmax(0,1fr)_92px] items-start gap-x-2.5 rounded-2xl border-2 p-2.5 text-left transition-colors disabled:opacity-60 @md:grid-cols-[48px_minmax(0,1fr)_104px] ${
											active
												? "border-accent bg-accent/5"
												: "border-border bg-card hover:border-accent/40"
										}`}
									>
										<CourierLogo
											logoUrl={delyvaLogoUrl(service.logoPath)}
											name={service.companyName || service.name}
										/>
										<span className="flex min-w-0 flex-col items-start gap-1">
											<span className="text-sm font-semibold leading-snug break-words">
												{service.name}
											</span>
											<span className="text-xs leading-snug text-muted-foreground">
												{serviceMeta(service)}
											</span>
											<HandoffPill handoff={handoff} />
										</span>
										<span className="flex flex-col items-end gap-1 text-right">
											<span className="text-sm font-bold tabular-nums">
												{formatPrice(service.price, service.currency)}
											</span>
											{/* Against what the buyer paid — the buyer never chose
											    this courier, so its price is the seller's margin. */}
											{service.currency === order.currency ? (
												<MarginTag
													priceMinor={service.price}
													buyerPaidMinor={order.deliveryFee ?? 0}
													currency={order.currency}
												/>
											) : null}
											{index === 0 && services.length > 1 ? (
												<span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent-emphasis">
													Cheapest
												</span>
											) : null}
										</span>
									</button>
								);
							})}
							{/* What the two pills mean — said once, under the list, so a
							    seller weighing a RM5 drop-off against a RM7 pickup knows the
							    cheaper one is a trip to a branch (z8r3fe11x3). */}
							<p className="text-xs text-muted-foreground">
								{HANDOFF_PICKER_NOTE}
							</p>

							{dispatch.isDemo ? (
								<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
									<FlaskConical className="mt-0.5 size-3.5 shrink-0" />
									<span>
										<span className="font-medium">Test keys.</span> This books a
										simulated shipment — no courier is dispatched and nothing is
										charged.
									</span>
								</p>
							) : null}
							{/* Read with the quote: short on a fresh read disables Book
							    below; a last-seen (refusal) balance only warns. */}
							<DispatchWalletLine
								id={`delyva-wallet-${order.shortId}`}
								provider="delyva"
								priceMinor={selected ? selected.price : null}
								priceCurrency={selected?.currency ?? order.currency}
								retailerId={order.retailerId}
								country={dispatch.country}
							/>
							<Button
								type="button"
								className="h-11 w-full"
								isLoading={booking}
								disabled={booking || !selected || selectedUnaffordable}
								aria-describedby={
									selectedUnaffordable
										? `delyva-wallet-${order.shortId}`
										: undefined
								}
								onClick={() => void handleBook()}
							>
								{booking ? (
									"Booking…"
								) : (
									<>
										<Truck className="size-4" />
										Book {selected?.name} —{" "}
										{selected
											? formatPrice(selected.price, selected.currency)
											: ""}
									</>
								)}
							</Button>
							<p className="text-xs text-muted-foreground">
								Charged to your Delyva wallet when you book. Prices here are
								Delyva&apos;s estimate — the final one is set when the booking
								goes through. The tracking number lands here and on your
								buyer&apos;s order page.
							</p>
							<p className="text-xs text-muted-foreground">
								Only couriers switched on in your Delyva account show here
								{activeCourierCount !== null
									? ` (${activeCourierCount} on)`
									: ""}
								.{" "}
								<a
									href="https://my.delyva.app"
									target="_blank"
									rel="noopener noreferrer"
									className="font-medium text-accent-emphasis underline-offset-2 hover:underline"
								>
									Add couriers in Delyva
								</a>
							</p>
							<button
								type="button"
								disabled={booking || quoting}
								className="flex min-h-9 items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60"
								onClick={() => void handleQuote()}
							>
								<RefreshCw className="size-3" /> Refresh prices
							</button>
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col gap-2">
					<Button type="button" className="h-11 w-full" disabled>
						<Truck className="size-4" /> Book a courier
					</Button>
					{/* The store-wide lock outranks this order's own block: it stops
					    every booking, and it is the one the seller can clear today. */}
					<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						{lockedReason ?? (
							<>
								{blockReason === "plan_gated" ? <ProBadge /> : null}
								{delyvaBlockCopy(blockReason ?? "")}
							</>
						)}
					</p>
				</div>
			)}

			<ConfirmDialog
				open={confirmingCancel}
				onOpenChange={setConfirmingCancel}
				title="Cancel this courier booking?"
				description="We'll ask Delyva to cancel it. If the courier has already collected the parcel they may refuse — check your Delyva app if that happens. The order itself doesn't change, and you can book again afterwards."
				confirmLabel="Cancel booking"
				destructive
				onConfirm={async () => {
					const result = await cancelBooking({ shortId: order.shortId });
					if (result.ok) toast.success("Booking cancelled");
					else toast.error(result.message ?? "Couldn't cancel the booking");
				}}
			/>
		</section>
	);
}

/** The one line under a courier's name: what kind of service it is, and what
 * the parcel is allowed to be. Delyva's own vocabulary, in plain words. Speed
 * is judged on the BASE class, so `NDD-DROP` still reads Next-day. */
function serviceMeta(service: DelyvaService): string {
	const speed = delyvaSpeedLabel(service.serviceType) ?? null;
	const cold = service.itemTypes?.some((t) => t === "CHILLED" || t === "FROZEN")
		? "Cold chain"
		: null;
	return [cold, speed, service.companyName].filter(Boolean).join(" · ");
}

/**
 * The booked card (z8r3fe11x3). Branches on the HANDOFF the booking was made
 * on: a drop-off service is a job the seller still has to do, so it leads
 * with the three steps and a primary Print shipping label; a pickup service
 * says where the courier collects from and keeps the label secondary; a
 * booking from before the handoff was stored claims neither. The demo
 * banner, when there is one, sits above all of this in the parent.
 */
function BookedState({
	job,
	order,
	completed,
	active,
	pickupSummary,
	printingLabel,
	onPrintLabel,
	onCancel,
}: {
	job: DelyvaJobView;
	order: Doc<"orders">;
	completed: boolean;
	active: boolean;
	pickupSummary?: string;
	printingLabel: boolean;
	onPrintLabel: () => void;
	onCancel: () => void;
}) {
	const handoff: CourierHandoff | undefined = delyvaHandoff(job.serviceType);
	// Before the parcel's first scan: the steps / collection line and the
	// label are owed only until then.
	const awaitingScan = job.status === "assigning" || job.status === "ongoing";
	const label = delyvaLabelAvailability(job);
	const courier = job.serviceName ?? "Delyva";

	const printButton = (variant: "default" | "outline") => (
		<div className="flex flex-col gap-1">
			<Button
				type="button"
				variant={variant}
				className="h-11 w-full"
				isLoading={printingLabel}
				disabled={printingLabel || !label.ok}
				aria-describedby={
					label.ok ? undefined : `delyva-label-why-${order.shortId}`
				}
				onClick={onPrintLabel}
			>
				<Printer className="size-4" />
				Print shipping label
			</Button>
			{label.ok ? null : (
				<p
					id={`delyva-label-why-${order.shortId}`}
					className="text-xs text-muted-foreground"
				>
					{LABEL_UNAVAILABLE_COPY[label.reason]}
				</p>
			)}
		</div>
	);

	return (
		<div className="flex flex-col gap-2.5 text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<Truck className="size-4 shrink-0 text-accent" />
				<span className="font-medium">{courier}</span>
				{job.itemType && job.itemType !== "PARCEL" ? (
					<span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
						<Snowflake className="size-3" />
						{job.itemType === "FROZEN" ? "Frozen" : "Chilled"}
					</span>
				) : null}
				{handoff ? <HandoffPill handoff={handoff} className="ml-auto" /> : null}
			</div>

			{/* Drop-off: the seller's three steps lead, with the label — the one
			    thing a branch will scan — as the primary action (board 2). */}
			{awaitingScan && handoff === "dropoff" ? (
				<>
					<ol
						aria-label="What to do next"
						className={`flex flex-col gap-2.5 rounded-xl border px-3 py-3 ${TONE_PANEL.info}`}
					>
						{dropoffSteps(job.serviceName).map((step, index) => (
							<li key={step.title} className="flex gap-2.5">
								<span
									aria-hidden="true"
									className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-segment text-[11px] font-bold text-segment-foreground"
								>
									{index + 1}
								</span>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="font-medium">{step.title}</span>
									<span className="text-xs">{step.detail}</span>
								</span>
							</li>
						))}
					</ol>
					{printButton("default")}
				</>
			) : null}

			{job.awb ? (
				<div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
					<span className="flex min-w-0 flex-col gap-0.5">
						<span className="text-xs text-muted-foreground">
							Tracking number
						</span>
						<span className="truncate font-mono text-sm font-semibold">
							{job.awb}
						</span>
					</span>
					<CopyButton value={job.awb} ariaLabel="Copy tracking number" />
				</div>
			) : (
				<p className="text-muted-foreground">
					Booked — waiting for {courier} to issue a tracking number. It appears
					here and on your buyer&apos;s order page by itself.
				</p>
			)}

			{/* Pickup: where the courier collects from (board 3). A place, never
			    a time — Delyva schedules the pickup on the courier's cadence. */}
			{awaitingScan && handoff === "pickup" ? (
				<p className="flex items-start gap-2 text-muted-foreground">
					<MapPin className="mt-0.5 size-4 shrink-0" />
					<span>{pickupCollectionCopy(job.serviceName, pickupSummary)}</span>
				</p>
			) : null}

			{/* Booked with a number but no link yet (z8r3fe0t4e): the link is
			    written at the first scan, so the line says when it comes and
			    "Track parcel" below stays absent until `order.carrierTrackingUrl`
			    exists. The moment is worded by the handoff; a legacy booking
			    claims neither kind. */}
			<p className="text-muted-foreground">
				{completed
					? parcelDeliveredCopy(!!order.carrierTrackingUrl)
					: isCourierLinkPending({ ...job, provider: "delyva" }, order)
						? courierLinkPendingSellerCopy(job.serviceName, handoff)
						: handoff === undefined
							? LEGACY_BOOKED_COPY
							: `Your buyer already has this — the tracking number is on their order page. The order marks itself Shipped ${
									handoff === "dropoff"
										? "once the branch scans the parcel in"
										: "at collection"
								} and Delivered on arrival.`}
			</p>

			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span>Booking cost {formatPrice(job.costActual, order.currency)}</span>
				{order.carrierTrackingUrl ? (
					<a
						href={order.carrierTrackingUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 font-medium text-accent hover:underline"
					>
						Track parcel <ExternalLink className="size-3" />
					</a>
				) : null}
			</div>

			{/* Pickup and legacy bookings keep the label secondary: the courier
			    brings their own, but a printed one speeds the handover. Gone once
			    the parcel is scanned — it is on the parcel by then. */}
			{active && awaitingScan && handoff !== "dropoff"
				? printButton("outline")
				: null}

			{active ? (
				<Button
					type="button"
					variant="ghost"
					className="h-11 w-full text-destructive"
					onClick={onCancel}
				>
					Cancel booking
				</Button>
			) : null}
		</div>
	);
}
/** "+RM 0.80 kept" / "RM 3.40 from your margin" beside one courier's price. */
function MarginTag({
	priceMinor,
	buyerPaidMinor,
	currency,
}: {
	priceMinor: number;
	buyerPaidMinor: number;
	currency: string;
}) {
	const margin = courierMargin(priceMinor, buyerPaidMinor, currency);
	return (
		<span
			className={
				margin.tone === "loss"
					? "text-[11px] font-medium text-amber-700 dark:text-amber-300"
					: "text-[11px] text-muted-foreground"
			}
		>
			{margin.label}
		</span>
	);
}
