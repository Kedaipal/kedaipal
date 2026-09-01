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
import { useAction } from "convex/react";
import {
	CircleAlert,
	ExternalLink,
	FlaskConical,
	RefreshCw,
	Snowflake,
	Truck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { DelyvaItemType, DelyvaService } from "../../../convex/lib/delyva";
import {
	delyvaBlockCopy,
	delyvaStatusLabel,
} from "../../lib/delyva-dispatch-block";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { Input } from "../ui/input";

const ITEM_TYPES: ReadonlyArray<{ value: DelyvaItemType; label: string }> = [
	{ value: "PARCEL", label: "Parcel" },
	{ value: "CHILLED", label: "Chilled" },
	{ value: "FROZEN", label: "Frozen" },
];

/** Terminal statuses free the order's booking slot — a rebook is allowed. */
const TERMINAL = new Set(["completed", "canceled", "expired", "rejected"]);

export function DelyvaDispatchCard({ order }: { order: Doc<"orders"> }) {
	const dispatch = useQuery(
		convexQuery(api.delyva.getDispatchState, { shortId: order.shortId }),
	).data;

	const prepareBooking = useAction(api.delyva.prepareBooking);
	const confirmBooking = useAction(api.delyva.confirmBooking);
	const cancelBooking = useAction(api.delyva.cancelBooking);

	const [itemType, setItemType] = useState<DelyvaItemType | null>(null);
	const [weightInput, setWeightInput] = useState("");
	const [services, setServices] = useState<DelyvaService[] | null>(null);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);
	const [quoting, setQuoting] = useState(false);
	const [booking, setBooking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingCancel, setConfirmingCancel] = useState(false);

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

	if (order.deliveryMethod !== "delivery" || !dispatch) return null;

	const job = dispatch.job;
	const activeJob = job && !TERMINAL.has(job.status) ? job : null;
	const failedJob =
		job && (job.status === "canceled" || job.status === "expired" || job.status === "rejected")
			? job
			: null;
	const completedJob = job?.status === "completed" ? job : null;
	const blockReason = dispatch.blockReason;
	const bookable = blockReason === null;
	const effectiveItemType = itemType ?? dispatch.defaultItemType;

	// A store in a country we don't serve, with nothing booked, has no business
	// showing a courier card at all — the Lalamove posture.
	if (blockReason === "country_unsupported" && !job) return null;
	// Not a delivery order, or nothing to say: stay out of the way entirely.
	if ((blockReason === "not_delivery" || blockReason === "no_address") && !job)
		return null;

	// Never set up — a one-line discoverability hint, not a disabled button for
	// a feature the seller has never heard of.
	if (!dispatch.bookingEnabled && !job) {
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
					search={{ tab: "fulfilment" }}
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

	const selected = services?.find((s) => s.code === selectedCode) ?? null;

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
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
						<span className="font-medium">Test mode — no courier will come.</span>{" "}
						Your Delyva key is a demo-account key, so any booking here is
						simulated and nothing is really charged. Connect your live key in{" "}
						<Link
							to="/app/settings"
							search={{ tab: "fulfilment" }}
							className="font-medium underline underline-offset-2"
						>
							Settings → Fulfilment
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
						{failedJob.failureReason ? ` — ${failedJob.failureReason}` : ""}. Your
						buyer was not notified; the order is unchanged.
					</span>
				</p>
			) : null}

			{job && (activeJob || completedJob) ? (
				<div className="flex flex-col gap-2.5 text-sm">
					<div className="flex items-center gap-2">
						<Truck className="size-4 shrink-0 text-accent" />
						<span className="font-medium">{job.serviceName ?? "Delyva"}</span>
						{job.itemType && job.itemType !== "PARCEL" ? (
							<span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
								<Snowflake className="size-3" />
								{job.itemType === "FROZEN" ? "Frozen" : "Chilled"}
							</span>
						) : null}
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
							tracking number. It appears here and on your buyer&apos;s order page
							by itself.
						</p>
					)}

					<p className="text-muted-foreground">
						{completedJob
							? "Delivered. Your buyer was notified automatically."
							: "Your buyer already has this — the tracking number is on their order page. The order marks itself Shipped at collection and Delivered on arrival."}
					</p>

					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							Booking cost {formatPrice(job.costActual, order.currency)}
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
						<Button
							type="button"
							variant="ghost"
							className="h-11 w-full text-destructive"
							onClick={() => setConfirmingCancel(true)}
						>
							Cancel booking
						</Button>
					) : null}
				</div>
			) : bookable || failedJob ? (
				<>
					{/* What is being shipped, in the seller's terms. The weight is the
					    one number that changes the price, so it is editable here rather
					    than hidden behind a re-quote. */}
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
									setServices(null);
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
									? "Cold-chain coverage is West Malaysia only for most couriers."
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
									Buyer paid{" "}
									{formatPrice(order.deliveryFee ?? 0, order.currency)}
								</span>
							</div>
							{services.map((service, index) => {
								const active = service.code === selectedCode;
								return (
									<button
										key={service.code}
										type="button"
										aria-pressed={active}
										disabled={booking}
										onClick={() => setSelectedCode(service.code)}
										className={`flex w-full items-center gap-2.5 rounded-2xl border-2 p-2.5 text-left transition-colors disabled:opacity-60 ${
											active
												? "border-accent bg-accent/5"
												: "border-border bg-card hover:border-accent/40"
										}`}
									>
										<span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground">
											{initials(service.companyName || service.name)}
										</span>
										<span className="flex min-w-0 grow flex-col gap-0.5">
											<span className="truncate text-sm font-semibold">
												{service.name}
											</span>
											<span className="truncate text-xs text-muted-foreground">
												{serviceMeta(service)}
											</span>
										</span>
										<span className="flex shrink-0 flex-col items-end gap-1">
											<span className="text-sm font-bold">
												{formatPrice(service.price, service.currency)}
											</span>
											{index === 0 && services.length > 1 ? (
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
								disabled={booking || !selected}
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
								Charged to your Delyva credit when you book. The tracking number
								lands here and on your buyer&apos;s order page.
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
					<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						{blockReason === "plan_gated" ? <ProBadge /> : null}
						{delyvaBlockCopy(blockReason ?? "")}
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

/** Two-letter mark for a courier with no logo of ours — deliberate over a
 * remote logo: the card must render identically offline and on a cold cache. */
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "??";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** The one line under a courier's name: what kind of service it is, and what
 * the parcel is allowed to be. Delyva's own vocabulary, in plain words. */
function serviceMeta(service: DelyvaService): string {
	const speed =
		service.serviceType === "INSTANT"
			? "Same-day"
			: service.serviceType === "SDD"
				? "Same-day"
				: service.serviceType === "NDD"
					? "Next-day"
					: null;
	const cold = service.itemTypes?.some(
		(t) => t === "CHILLED" || t === "FROZEN",
	)
		? "Cold chain"
		: null;
	return [cold, speed, service.companyName].filter(Boolean).join(" · ");
}
