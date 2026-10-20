/**
 * EasyParcel courier dispatch card — order detail (z8r3fdcje2).
 *
 * The Delyva card's sibling for Singapore parcels, differing where EasyParcel
 * differs:
 *  - Rates come back as a LIST with indicative prices (no quotation id, no
 *    countdown), so the picker is INLINE like Delyva's — on a phone, a
 *    scrollable list inside a scrollable dialog is the worse of the two.
 *  - EasyParcel is PREPAID: the wallet balance sits beside the rate list, and
 *    a pick the wallet can't cover is warned about BEFORE the book tap.
 *  - The booking pays in the same tap (submit → pay) and hands back the
 *    courier's own AWB label PDF — linked on the card the moment it exists.
 *  - Status is POLLED (no webhook), so an active booking carries a "Refresh
 *    status" action instead of silently waiting for the half-hour cron.
 *  - There is no cancel API: cancelling means doing it in the EasyParcel
 *    dashboard and then marking it cancelled here — the dialog says exactly
 *    that, never pretending an API call it can't make.
 *
 * An empty rate list is a normal answer, not an error — it hands off to the
 * manual-courier flow instead of a dead end.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
	CircleAlert,
	ExternalLink,
	FileText,
	FlaskConical,
	RefreshCw,
	Truck,
	Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { isActiveJobStatus } from "../../../convex/lib/deliveryJobs";
import type { EasyparcelRate } from "../../../convex/lib/easyparcel";
import { courierContactFallbackCopy } from "../../lib/delyva-dispatch-block";
import { easyparcelSurface } from "../../lib/dispatch-surface";
import {
	easyparcelBlockCopy,
	easyparcelStatusLabel,
} from "../../lib/easyparcel-dispatch-block";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { Input } from "../ui/input";

export function EasyparcelDispatchCard({
	order,
	embedded = false,
	lockedReason,
}: {
	order: Doc<"orders">;
	/** Rendered inside the dispatch hub's shell — see BookDeliveryCard. */
	embedded?: boolean;
	/** Set while the store can't book right now (out of credits, or
	 * view-only) — see BookDeliveryCard. Marking cancelled stays open. */
	lockedReason?: string;
}) {
	const dispatch = useQuery(
		convexQuery(api.easyparcel.getDispatchState, { shortId: order.shortId }),
	).data;

	const prepareBooking = useAction(api.easyparcel.prepareBooking);
	const confirmBooking = useAction(api.easyparcel.confirmBooking);
	const refreshJobStatus = useAction(api.easyparcel.refreshJobStatus);
	const markCancelled = useMutation(api.easyparcel.markCancelled);

	const [weightInput, setWeightInput] = useState("");
	const [rates, setRates] = useState<EasyparcelRate[] | null>(null);
	/** The wallet snapshot that came back WITH the rates — what the warnings
	 * compare against, so the verdict and the prices are from one moment. */
	const [quotedBalance, setQuotedBalance] = useState<number | undefined>();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [quoting, setQuoting] = useState(false);
	const [booking, setBooking] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingCancel, setConfirmingCancel] = useState(false);

	// Seed the weight field from the order's own parcel weight ONCE, when the
	// dispatch state first arrives (the Delyva ref posture — clearing the field
	// must not snap the computed value back under the seller's cursor).
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
	const surface = easyparcelSurface(order, dispatch);
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
	const balanceCurrency = dispatch.balanceCurrency ?? order.currency;

	// Not bookable from here yet — a one-line hint, not a disabled button for
	// a feature the seller has never heard of (the Delyva posture, verbatim).
	if (surface === "hint") {
		if (blockReason === "disabled") {
			return (
				<p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
					<Truck className="mr-1.5 inline size-3.5 align-[-2px]" />
					EasyParcel booking is paused — turn <b>EasyParcel couriers</b> back on
					under Courier booking in{" "}
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
					Book Singapore parcel couriers straight from an order.
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
					connect EasyParcel
				</Link>{" "}
				to book couriers and have tracking numbers and labels fill themselves
				in.
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
				weightKgOverride: weightValid ? weightKg : undefined,
			});
			if (!result.ok) {
				setError(result.message ?? easyparcelBlockCopy(result.reason));
				setRates(null);
				return;
			}
			setRates(result.rates);
			setQuotedBalance(result.balanceMinor);
			// Cheapest pre-selected — the list arrives price-sorted from the server.
			setSelectedId(result.rates[0]?.serviceId ?? null);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setQuoting(false);
		}
	}

	async function handleBook() {
		const rate = rates?.find((r) => r.serviceId === selectedId);
		if (!rate) return;
		setBooking(true);
		setError(null);
		try {
			const result = await confirmBooking({
				shortId: order.shortId,
				serviceId: rate.serviceId,
				serviceName: rate.serviceName,
				courierName: rate.courierName,
				priceMinor: rate.priceMinor,
				weightKgOverride: weightValid ? weightKg : undefined,
			});
			if (!result.ok) {
				// In-place, not a toast: the seller has just come back from a top-up
				// and the reason must still be on screen (the 86eypncfy lesson).
				setError(result.message ?? easyparcelBlockCopy(result.reason));
				return;
			}
			setRates(null);
			setSelectedId(null);
			toast.success(`${rate.serviceName} booked`);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setBooking(false);
		}
	}

	async function handleRefreshStatus() {
		setRefreshing(true);
		try {
			const result = await refreshJobStatus({ shortId: order.shortId });
			if (!result.ok)
				toast.error(result.message ?? "Couldn't refresh the status");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setRefreshing(false);
		}
	}

	const selected = rates?.find((r) => r.serviceId === selectedId) ?? null;
	const selectedUnaffordable =
		selected !== null &&
		quotedBalance !== undefined &&
		selected.priceMinor > quotedBalance;

	return (
		<section
			className={
				embedded
					? "flex flex-col gap-3"
					: "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
			}
		>
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					EasyParcel Courier
				</p>
				{job && !failedJob ? (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
							completedJob
								? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
								: "bg-accent/15 text-accent-emphasis"
						}`}
					>
						{easyparcelStatusLabel(job.status)}
					</span>
				) : null}
			</div>

			{/* A demo booking dispatches no courier and spends play money, and
			    looks identical to a real one until nobody turns up — said at the
			    point of spend, not only in Settings (86eypncfy). */}
			{dispatch.isDemo ? (
				<p className="flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
					<FlaskConical className="mt-0.5 size-4 shrink-0" />
					<span>
						<span className="font-medium">
							Test mode — no courier will come.
						</span>{" "}
						Your EasyParcel key belongs to their demo environment, so any
						booking here is simulated and nothing is really charged. Connect
						your live key in{" "}
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
				<div className="flex flex-col gap-2.5 text-sm">
					<div className="flex items-center gap-2">
						<Truck className="size-4 shrink-0 text-accent" />
						<span className="font-medium">
							{job.serviceName ?? "EasyParcel"}
						</span>
					</div>

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
							Booked — waiting for {job.serviceName ?? "the courier"} to issue a
							tracking number. It appears here and on your buyer&apos;s order
							page by itself.
						</p>
					)}

					{/* The courier's own label — the first provider that gives us one.
					    Beside Kedaipal's despatch label, never instead of it. */}
					{job.labelUrl ? (
						<a
							href={job.labelUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-accent-emphasis hover:border-accent/40"
						>
							<FileText className="size-4 shrink-0" />
							Courier label (PDF)
							<ExternalLink className="ml-auto size-3.5 shrink-0" />
						</a>
					) : null}

					<p className="text-muted-foreground">
						{completedJob
							? "Delivered. Your buyer was notified automatically."
							: "Your buyer already has this — the tracking number is on their order page. The order marks itself Shipped at collection and Delivered on arrival; EasyParcel is checked every half hour."}
					</p>

					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							Booking cost {formatPrice(job.costActual, balanceCurrency)}
						</span>
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

					{activeJob ? (
						<div className="flex flex-col gap-1">
							<Button
								type="button"
								variant="outline"
								className="h-11 w-full"
								isLoading={refreshing}
								onClick={() => void handleRefreshStatus()}
							>
								<RefreshCw className="size-4" /> Refresh status
							</Button>
							<Button
								type="button"
								variant="ghost"
								className="h-11 w-full text-destructive"
								onClick={() => setConfirmingCancel(true)}
							>
								Cancelled it in EasyParcel?
							</Button>
						</div>
					) : null}
				</div>
			) : bookable && !lockedReason ? (
				<>
					{/* Where the courier collects — surfaced BEFORE the first quote so
					    a stale pickup address is caught at the moment it matters. */}
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

					{/* Who the courier will phone at the buyer's end (z8r3fdh274). */}
					{dispatch.buyerContactFallback ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							{courierContactFallbackCopy(dispatch.country)}
						</p>
					) : null}

					{/* The weight is the one number that changes the price, so it is
					    editable here rather than hidden behind a re-quote. */}
					<div className="flex flex-col gap-1.5">
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
									setRates(null);
									setError(null);
								}}
								className="max-w-28"
							/>
							<span className="text-sm text-muted-foreground">kg</span>
						</div>
						{needsTypedWeight ? (
							<p className="text-xs text-muted-foreground">
								{dispatch.weightIssue === "custom_item"
									? "This order has a custom line, so we can't work its weight out — weigh the packed parcel and type it here."
									: "Some items here have no parcel weight set, so we can't add it up — weigh the packed parcel and type it here (or set weights in Products)."}
							</p>
						) : null}
					</div>

					{error ? (
						<p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
							<CircleAlert className="mt-0.5 size-4 shrink-0" />
							<span>{error}</span>
						</p>
					) : null}

					{rates === null ? (
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
					) : rates.length === 0 ? (
						<div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-3 py-3.5">
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">
									No courier can take a parcel this weight to this address right
									now.
								</span>{" "}
								Check the buyer&apos;s postal code and your pickup postal code —
								EasyParcel quotes on those two numbers.
							</p>
							<p className="text-sm text-muted-foreground">
								Arrange delivery yourself and add the tracking number below —
								your buyer still gets the shipped update.
							</p>
							<button
								type="button"
								className="min-h-9 text-xs font-medium text-accent underline-offset-2 hover:underline"
								onClick={() => setRates(null)}
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
									Buyer paid{" "}
									{formatPrice(order.deliveryFee ?? 0, order.currency)}
								</span>
							</div>
							{rates.map((rate, index) => {
								const active = rate.serviceId === selectedId;
								return (
									<button
										key={rate.serviceId}
										type="button"
										aria-pressed={active}
										disabled={booking}
										onClick={() => setSelectedId(rate.serviceId)}
										className={`flex w-full items-center gap-2.5 rounded-2xl border-2 p-2.5 text-left transition-colors disabled:opacity-60 ${
											active
												? "border-accent bg-accent/5"
												: "border-border bg-card hover:border-accent/40"
										}`}
									>
										<span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground">
											{initials(rate.courierName)}
										</span>
										<span className="flex min-w-0 grow flex-col gap-0.5">
											<span className="truncate text-sm font-semibold">
												{rate.serviceName}
											</span>
											<span className="truncate text-xs text-muted-foreground">
												{rateMeta(rate)}
											</span>
										</span>
										<span className="flex shrink-0 flex-col items-end gap-1">
											<span className="text-sm font-bold">
												{formatPrice(rate.priceMinor, balanceCurrency)}
											</span>
											{index === 0 && rates.length > 1 ? (
												<span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent-emphasis">
													Cheapest
												</span>
											) : null}
										</span>
										<span
											aria-hidden="true"
											className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
												active ? "border-accent" : "border-border"
											}`}
										>
											{active ? (
												<span className="size-2 rounded-full bg-accent" />
											) : null}
										</span>
									</button>
								);
							})}

							{/* The prepaid wallet, right where the spend happens. Amber the
							    moment the pick outprices it — the server refuses anyway,
							    but a disabled-with-reason beats a bounced booking. */}
							{quotedBalance !== undefined ? (
								<p
									className={`flex items-center gap-1.5 text-xs ${
										selectedUnaffordable
											? "font-medium text-amber-700 dark:text-amber-400"
											: "text-muted-foreground"
									}`}
								>
									<Wallet className="size-3.5 shrink-0" />
									{selectedUnaffordable ? (
										<>
											Wallet {formatPrice(quotedBalance, balanceCurrency)} — not
											enough for this courier. Top up in EasyParcel, then
											re-quote.
										</>
									) : (
										<>
											EasyParcel wallet:{" "}
											{formatPrice(quotedBalance, balanceCurrency)}
										</>
									)}
								</p>
							) : null}

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
							<Button
								type="button"
								className="h-11 w-full"
								isLoading={booking}
								disabled={booking || !selected || selectedUnaffordable}
								onClick={() => void handleBook()}
							>
								{booking ? (
									"Booking…"
								) : (
									<>
										<Truck className="size-4" />
										Book {selected?.serviceName} —{" "}
										{selected
											? formatPrice(selected.priceMinor, balanceCurrency)
											: ""}
									</>
								)}
							</Button>
							<p className="text-xs text-muted-foreground">
								Paid from your EasyParcel wallet when you book. The tracking
								number and the courier&apos;s label PDF land here, and the
								tracking number reaches your buyer&apos;s order page.
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
								{easyparcelBlockCopy(blockReason ?? "")}
							</>
						)}
					</p>
				</div>
			)}

			<ConfirmDialog
				open={confirmingCancel}
				onOpenChange={setConfirmingCancel}
				title="Mark this booking cancelled?"
				description="EasyParcel has no cancel API, so cancel the shipment in your EasyParcel dashboard first (their support can help if the courier already has it). This only updates Kedaipal: the booking is marked cancelled here and you can book a courier again. The order itself doesn't change."
				confirmLabel="Mark cancelled"
				destructive
				onConfirm={async () => {
					const result = await markCancelled({ shortId: order.shortId });
					if (result.ok) toast.success("Booking marked cancelled");
					else toast.error(result.message ?? "Couldn't mark it cancelled");
				}}
			/>
		</section>
	);
}

/** Two-letter mark for a courier with no logo of ours — deliberate over a
 * remote logo: the card must render identically offline and on a cold cache
 * (EasyParcel's `courier_logo` URLs are theirs to move). */
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "??";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** The one line under a rate's name: the courier, the ETA, the earliest
 * pickup — EasyParcel's own vocabulary, in plain words. */
function rateMeta(rate: EasyparcelRate): string {
	const pickup = rate.pickupDate ? `pickup ${rate.pickupDate}` : null;
	return [rate.courierName, rate.deliveryEta, pickup]
		.filter(Boolean)
		.join(" · ");
}
