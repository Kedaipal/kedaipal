import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
	ArrowLeft,
	CalendarRange,
	ArrowRight,
	BadgeCheck,
	Ban,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Copy,
	HandCoins,
	Hourglass,
	ImagePlus,
	MapPin,
	MessageCircle,
	Package,
	Phone,
	Pin,
	StickyNote,
	Trash2,
	Truck,
	User,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { attributionBucket, sourceLabel } from "../../convex/lib/attribution";
import { DEFAULT_COUNTRY } from "../../convex/lib/country";
import { describeBookingSpan } from "../lib/booking-dates";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
} from "../../convex/lib/fulfilmentDate";
import {
	BookingRequestCard,
	BookingResolutionNote,
} from "../components/order/booking-request-card";
import { SecurityDepositCard } from "../components/order/security-deposit-card";
import {
	isActiveJobStatus,
	isRiderManagedTransition,
	riderDrivesOrderStatus,
} from "../../convex/lib/lalamove";
import { isMockupGateClosed } from "../../convex/lib/order";
import {
	COUNTRY_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
	paymentMethodLabel,
} from "../../convex/lib/paymentMethod";
import { manualReminderEligibility } from "../../convex/lib/paymentReminder";
import type { PickupSnapshot } from "../../convex/lib/whatsappCopy";
import { ProBadge } from "../components/app/pro-gate";
import { BRAND_GLYPHS } from "../components/dashboard/brand-icons";
import { FulfilmentDateBadge } from "../components/dashboard/fulfilment-date-badge";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { StatusBadge } from "../components/dashboard/status-badge";
import { BookDeliveryCard } from "../components/order/book-delivery-card";
import {
	canPrintLabel,
	PrintLabelButton,
} from "../components/order/print-label-button";
import { ReceiptDownloadButton } from "../components/order/receipt-download-button";
import { RescheduleFulfilmentDialog } from "../components/order/reschedule-fulfilment-dialog";
import {
	MarkShippedDialog,
	type ShipmentFields,
	ShipmentTrackingCard,
} from "../components/order/shipment-tracking";
import {
	DeliveryAddressDisplay,
	formatAddressInline,
} from "../components/storefront/delivery-address-display";
import { AppImage } from "../components/ui/app-image";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { CopyButton } from "../components/ui/copy-button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { ZoomableImage } from "../components/ui/zoomable-image";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { canHardDeleteOrders } from "../lib/admin-actions";
import { MASK_PII } from "../lib/analytics-privacy";
import { formatPhone, orderCustomerLabel } from "../lib/customer";
import {
	convexErrorMessage,
	currencySymbol,
	formatPrice,
	formatPriceCompact,
	normalizePriceInput,
	parsePriceInput,
} from "../lib/format";
import { deriveMapsUrl } from "../lib/google-address";
import { IMAGE_ACCEPT, prepareImageUpload } from "../lib/image-upload";
import {
	anchorOrdinal,
	displayStatusLabel,
	resolveCurrentStage,
	resolveStages,
	resolveStatusLabel,
	stageLabel,
} from "../lib/orderStatus";
import { suppressNextOrderConfirmedToast } from "../lib/orderToastSuppression";
import { isCrmLocked, isOrderInboxLocked } from "../lib/subscription";
import { cn } from "../lib/utils";

/**
 * The fulfilment card's one-line summary of a booking. A fixed-length package
 * (S7, frozen `bookingPackageDays`) reads as a validity window in DAYS; a
 * free-range stay reads as check-in → check-out in NIGHTS.
 */
function bookingFulfilmentLine(order: {
	bookingCheckIn?: number;
	bookingCheckOut?: number;
	bookingPackageDays?: number;
}): string {
	if (order.bookingCheckIn === undefined || order.bookingCheckOut === undefined)
		return "Booking";
	const span = Math.round(
		(order.bookingCheckOut - order.bookingCheckIn) / DAY_MS,
	);
	const isPackage = order.bookingPackageDays !== undefined;
	const unit = isPackage ? "day" : "night";
	return `Booking · ${span} ${unit}${span === 1 ? "" : "s"} · ${describeBookingSpan(
		order.bookingCheckIn,
		order.bookingCheckOut,
		{ isPackage, format: formatFulfilmentDate },
	)}`;
}

export const Route = createFileRoute("/app/orders/$shortId")({
	component: OrderDetailRoute,
});

function OrderDetailSkeleton() {
	return (
		<div className="flex flex-col gap-5 lg:max-w-3xl">
			<PageHeaderSkeleton hasBack hasSubtitle />
			{/* Mobile back */}
			<Skeleton className="h-4 w-16 rounded lg:hidden" />
			{/* Mobile title + status */}
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-1.5 lg:hidden">
					<Skeleton className="h-7 w-28 rounded" />
					<Skeleton className="h-3 w-40 rounded" />
				</div>
				<div className="ml-auto flex flex-col items-end gap-1.5">
					<Skeleton className="h-5 w-20 rounded-full" />
					<Skeleton className="h-5 w-24 rounded-full" />
				</div>
			</div>
			{/* Customer card */}
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<Skeleton className="h-3 w-16 rounded" />
				<div className="flex items-center gap-3">
					<Skeleton className="h-9 w-9 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-32 rounded" />
						<Skeleton className="h-3 w-28 rounded" />
					</div>
				</div>
			</div>
			{/* Delivery method */}
			<div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
				<Skeleton className="h-9 w-9 shrink-0 rounded-full" />
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-3 w-20 rounded" />
					<Skeleton className="h-4 w-24 rounded" />
				</div>
			</div>
			{/* Items */}
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<Skeleton className="h-3 w-10 rounded" />
				{[0, 1, 2].map((i) => (
					<div key={i} className="flex items-start justify-between gap-3">
						<div className="flex flex-1 flex-col gap-1.5">
							<Skeleton className="h-4 w-40 rounded" />
							<Skeleton className="h-3 w-24 rounded" />
						</div>
						<Skeleton className="h-4 w-14 rounded" />
					</div>
				))}
				<div className="mt-1 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5">
					<Skeleton className="h-4 w-10 rounded" />
					<Skeleton className="h-4 w-20 rounded" />
				</div>
			</div>
			{/* Action button placeholder */}
			<Skeleton className="h-11 w-full rounded-md" />
		</div>
	);
}

// Local mirror of the shared union (src/lib/orderStatus.ts) — a route-level
// alias so the file reads standalone.
type DeliveryMethod = "delivery" | "self_collect" | "booking";

type PaymentStatus = "unpaid" | "claimed" | "received";

/** "Aina Jasmin" → "AJ"; single word → first two letters. */
function initials(name: string | undefined): string {
	if (!name?.trim()) return "?";
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(epochMs: number | undefined): string {
	if (!epochMs) return "";
	const diff = Date.now() - epochMs;
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (diff < minute) return "just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
	if (diff < day) return `${Math.floor(diff / hour)}h ago`;
	return `${Math.floor(diff / day)}d ago`;
}

/** "in 3h" / "tomorrow-ish" phrasing for the reminder cooldown + unlock. */
function formatUntil(epochMs: number): string {
	const diff = epochMs - Date.now();
	const minute = 60_000;
	const hour = 60 * minute;
	if (diff <= 0) return "now";
	if (diff < hour) return `in ${Math.max(1, Math.round(diff / minute))}m`;
	if (diff < 36 * hour) return `in ${Math.round(diff / hour)}h`;
	return `in ${Math.round(diff / (24 * hour))} days`;
}

/**
 * Stepper + next action, always on top: dots for reached stages, an outlined
 * dot for the next one, and the single most likely transition as a big button
 * right underneath — the seller never hunts for the right status move.
 * `currentIndex` is the stage the order has REACHED (-1 while pending).
 */
function OrderProgressStepper({
	stages,
	currentIndex,
	cancelled,
	action,
}: {
	stages: ReturnType<typeof resolveStages>;
	currentIndex: number;
	cancelled: boolean;
	action?: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-sm">
			{cancelled ? (
				<p className="text-sm font-medium text-destructive">
					This order was cancelled.
				</p>
			) : (
				<>
					<div className="flex items-center" aria-hidden="true">
						{stages.map((stage, index) => {
							const done = index <= currentIndex;
							const next = index === currentIndex + 1;
							return (
								<div key={stage.id} className="contents">
									{index > 0 ? (
										<span
											className={`h-[3px] flex-1 ${index <= currentIndex ? "bg-accent" : "bg-border"}`}
										/>
									) : null}
									<span
										className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
											done
												? "bg-accent text-accent-foreground"
												: next
													? "border-[2.5px] border-accent bg-card text-accent-emphasis"
													: "bg-muted text-muted-foreground"
										}`}
									>
										{done ? <Check className="size-4" /> : index + 1}
									</span>
								</div>
							);
						})}
					</div>
					<div className="-mt-1 flex justify-between gap-1">
						{stages.map((stage, index) => (
							<span
								key={stage.id}
								className={`min-w-0 truncate text-[10.5px] font-semibold ${
									index <= currentIndex
										? "text-accent-emphasis"
										: index === currentIndex + 1
											? "text-foreground"
											: "text-muted-foreground/70"
								} ${index === 0 ? "text-left" : index === stages.length - 1 ? "text-right" : "text-center"}`}
							>
								{stageLabel(stage, "en")}
							</span>
						))}
					</div>
				</>
			)}
			{action}
		</section>
	);
}

function OrderDetailRoute() {
	const { shortId } = Route.useParams();
	const navigate = useNavigate();
	const order = useQuery(convexQuery(api.orders.get, { shortId })).data;
	const updateStatus = useMutation(api.orders.updateStatus);
	const advanceToStage = useMutation(api.orders.advanceToStage);
	const markPaymentReceived = useMutation(api.orders.markPaymentReceived);
	const clearGatewayPaymentIssue = useMutation(
		api.orders.clearGatewayPaymentIssue,
	);
	const cancelRiderBooking = useAction(api.lalamove.cancelBooking);
	const sendPaymentReminder = useAction(api.orders.sendPaymentReminder);
	const [sendingReminder, setSendingReminder] = useState(false);
	const deleteOrder = useMutation(api.orders.deleteOrder);
	// Opening the order IS the seller seeing it — drains it from the New bucket,
	// the Home tile and the age escalation (86eyf1rck). Fire-and-forget: a failed
	// stamp just means it stays flagged as new, which is the safe direction.
	const markSeen = useMutation(api.orders.markSeen);
	const setPinned = useMutation(api.orders.setPinned);
	const [pinBusy, setPinBusy] = useState(false);
	// Line-item thumbnails (86eyrtz74): variant image, else product image, one
	// entry per line IN LINE ORDER (the same product can appear twice). Resolved
	// server-side in one batched read rather than a lookup per row.
	const itemImageUrls = useQuery(
		convexQuery(api.orders.getItemImageUrls, { shortId }),
	).data;
	const orderId = order?._id;
	const alreadySeen = order?.seenAt !== undefined;
	useEffect(() => {
		if (!orderId || alreadySeen) return;
		void markSeen({ orderId }).catch(() => {});
	}, [orderId, alreadySeen, markSeen]);
	// Permanent hard delete is admin-only (Kedaipal support); a plain seller only
	// ever cancels. `canHardDeleteOrders` mirrors the server gate and is shared with
	// the inbox bulk bar so the two surfaces can't drift — this is discoverability,
	// the server is the guard.
	const retailer = useDashboardRetailer();
	// Settlement rails the seller may hand-pick on "Mark payment received" — the
	// store's country decides them, so an SG seller is never made to file a
	// PayNow transfer under "Other" (86eyph341). Undefined while the payload
	// loads reads as MY, the app-wide default; the dialog only opens on a tap,
	// long after it resolves.
	const paymentMethodChoices =
		COUNTRY_PAYMENT_METHODS[retailer?.country ?? DEFAULT_COUNTRY];
	const amIAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;
	const canHardDelete = canHardDeleteOrders({
		actingAsAdmin: retailer?.actingAsAdmin,
		amIAdmin,
	});
	const proofUrl = useQuery(
		convexQuery(
			api.orders.getPaymentProofUrl,
			order?.paymentProofStorageId ? { orderId: order._id } : "skip",
		),
	).data;
	const customerImageUrl = useQuery(
		convexQuery(
			api.orders.getCustomerImageUrl,
			order?.customerImageStorageId ? { shortId } : "skip",
		),
	).data;
	// CRM context for the customer card ("8 orders · RM 1,240") — answers "who is
	// this?" without leaving the order.
	// Active Lalamove booking awareness for the cancel dialog (same query the
	// BookDeliveryCard subscribes to — Convex dedupes identical subscriptions).
	const dispatchInfo = useQuery(
		convexQuery(
			api.lalamove.getDeliveryJob,
			order?.deliveryMethod === "delivery" && order.shortId
				? { shortId: order.shortId }
				: "skip",
		),
	).data;
	const hasActiveRiderBooking =
		!!dispatchInfo?.job && isActiveJobStatus(dispatchInfo.job.status);
	// Rider dispatch IS this vendor's delivery method (they picked Lalamove as
	// their delivery charge). They never ship parcels, so no manual courier
	// surface is offered anywhere on this page — 86eyff02p.
	const lalamoveVendor = dispatchInfo?.bookingEnabled === true;
	// Collection service (86eyg0n8e): the rider collects FROM the customer, so
	// the webhook only ever moves the JOB — the order status stays the
	// seller's to advance by hand throughout.
	// Read from the ORDER, frozen at create — never the store's live setting.
	// A seller switching modes mid-flight must not retroactively change how an
	// already-placed order behaves: flipping to collection would strip the
	// rider gate off in-flight standard deliveries (letting a manual "shipped"
	// message the buyer early, without the tracking link), and flipping away
	// would impose that gate on a collection order it would strand.
	const collectionService = order?.deliveryDirection === "collection";
	// The dispatch card names itself after the TRIP it shows (or, with no job
	// yet, the store's current mode) — mirror that exactly, since the
	// cancel/delete warnings point the seller AT that card by name.
	const dispatchCardName = (
		dispatchInfo?.job
			? dispatchInfo.job.deliveryDirection === "collection"
			: dispatchInfo?.deliveryDirection === "collection"
	)
		? "Lalamove Collection"
		: "Lalamove Delivery";
	// A rider is mid-trip with this order: manual shipped/delivered advances are
	// gated behind a confirm, so the buyer's order page can't claim "on the way"
	// before the rider actually has the parcel (or without the tracking link).
	//
	// Gated from the moment of BOOKING, not from the first webhook event. The
	// old predicate also required `lastEventAt`, which left the gate off during
	// exactly the window it matters most — between placing the booking and the
	// first event landing — so a seller could click straight through a live
	// rider trip. The confirm-gated escape below is what protects the
	// webhook-less seller instead, and cancelling the booking lifts the gate
	// outright, so neither can be stranded.
	//
	// Never true for collection orders: there the rider drives the FRONT of the
	// flow, not shipped/delivered, so this gate would both lie and strand.
	// Derived from the same signal the tracking card reads, so the stepper gate
	// and that card can't drift apart.
	const riderHandlingTrip = hasActiveRiderBooking && !collectionService;
	// Has that booking actually reported yet? Only then can we promise the
	// status moves on its own — otherwise the seller may have no webhook.
	const riderWebhookReporting =
		!!dispatchInfo?.job && riderDrivesOrderStatus(dispatchInfo.job);
	// Collection order whose goods are still with the buyer: nothing downstream
	// ("packed", "cleaning", "ready") can be true yet. Mirrors the server gate
	// in orders.advanceToStage.
	const awaitingCollection =
		collectionService && order?.collectedAt === undefined;
	// Pro gate (CRM). Skipped until the retailer payload resolves AND the plan
	// allows it — `customers.get` throws `assertPlanFeature` for Starter, and a
	// route-level useQuery throw takes the whole order page down (the exact bug
	// this guard fixes; customers list/detail carry the same skip).
	const crmLocked = isCrmLocked(retailer);
	// Marketing origin of THIS order (86eyq0eq9) — the tag the buyer arrived
	// with, else counter/direct. Drilling into the filtered inbox rides the
	// Pro-gated inbox filter, so a Starter gets the fact as plain text rather
	// than a link that would silently land on an unfiltered list.
	const inboxFilterLocked = isOrderInboxLocked(retailer);
	const crmCustomer = useQuery(
		convexQuery(
			api.customers.get,
			retailer && !crmLocked && order?.customerId
				? { customerId: order.customerId }
				: "skip",
		),
	).data;
	// Holds the id of the in-flight advance target ("cancel" for cancellation).
	const [pending, setPending] = useState<string | null>(null);
	// The mark-shipped prompt (courier + tracking number, optional). Opened
	// instead of a direct advance when the target stage is shipped-anchored on a
	// delivery order with no tracking attached yet.
	const [shipDialogOpen, setShipDialogOpen] = useState(false);
	// Bumped by the prompt's "Book a rider…" CTA — BookDeliveryCard watches it
	// and opens its own quote→confirm dialog, so the seller can book from the
	// eye-level prompt without scrolling down to the card.
	const [bookRequestToken, setBookRequestToken] = useState(0);
	const [confirmingPayment, setConfirmingPayment] = useState(false);
	const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);
	const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	// Escape hatch for the rider-managed status gate — a webhook that dies
	// mid-delivery must never leave the order stuck, so "update manually
	// anyway" stays reachable behind this confirm.
	const [confirmManualAdvanceOpen, setConfirmManualAdvanceOpen] =
		useState(false);
	// Escape hatch for the collection gate — the seller fetched the items in
	// person, or the rider's webhook never reported. Confirming stamps the
	// arrival, so the order unblocks for good rather than asking every stage.
	const [confirmCollectedOpen, setConfirmCollectedOpen] = useState(false);
	// Raised right after a manual collection when a rider is STILL booked —
	// they'd otherwise turn up for goods the seller already has. Never
	// automatic: cancelling can cost a Lalamove fee once a driver is assigned,
	// and that's the seller's money and their call.
	const [confirmCancelRiderOpen, setConfirmCancelRiderOpen] = useState(false);
	const [cancellingRider, setCancellingRider] = useState(false);
	// Rare actions (cancel, delete, receipt) collapse behind one link at the bottom.
	const [moreOpen, setMoreOpen] = useState(false);
	// Optional method tag captured at confirm time (the seller has just verified
	// the channel). Undefined = leave online/unknown. See lib/paymentMethod.ts.
	const [paymentMethodChoice, setPaymentMethodChoice] = useState<
		OrderPaymentMethod | undefined
	>(undefined);

	if (order === undefined) {
		return <OrderDetailSkeleton />;
	}
	if (order === null) {
		return <p className="text-sm text-destructive">Order not found.</p>;
	}

	const deliveryMethod = (order.deliveryMethod ?? "delivery") as DeliveryMethod;
	const isSelfCollect = deliveryMethod === "self_collect";
	const isBooking = deliveryMethod === "booking";
	// Dashboard chrome is English-only (per the i18n scope), so resolve seller-
	// facing labels in EN — a retailer's EN custom labels still flow through.
	// The buyer tracking page resolves in the store's locale instead.
	const statusLabelOpts = {
		labels: order.statusLabels,
		deliveryMethod,
		locale: "en" as const,
	};
	// Phase 2 stage model: the seller's ordered stages (their config, or the
	// synthesized defaults — same path), the order's current stage, and the next
	// stage to advance into. Dashboard chrome is EN.
	const stages = resolveStages({
		orderStages: order.orderStages,
		labels: order.statusLabels,
		deliveryMethod,
	});
	const currentStage = resolveCurrentStage(
		{ status: order.status, currentStageId: order.currentStageId },
		stages,
	);
	const currentIdx = currentStage
		? stages.findIndex((s) => s.id === currentStage.id)
		: -1; // pending: not yet in the band → next is the first stage
	const nextStage =
		order.status === "cancelled" ? undefined : stages[currentIdx + 1];
	const isTerminal =
		order.status === "cancelled" || order.status === "delivered";
	// The More-actions panel's destructive rows: Cancel (any non-terminal order)
	// or Delete (admin act-as only). Drives whether that panel has anything on
	// desktop, where the receipt row lives in the header instead.
	const hasDestructiveAction = !isTerminal || canHardDelete;
	const showCarrierSection =
		!isSelfCollect && !["pending", "cancelled"].includes(order.status);
	const paymentStatus = (order.paymentStatus ?? "unpaid") as PaymentStatus;
	// Production (any packed-or-later stage) is blocked while a mockup is required
	// but not yet approved/waived. Shared gate — same source as the server.
	const mockupGated = isMockupGateClosed(order);
	// Delivery charge still to be confirmed (out-of-range "arrange" order, or
	// address without coordinates) — holds the buyer's payment ask + the seller's
	// mark-received until the seller sets it below. See orders.setDeliveryFee.
	const deliveryFeePending =
		order.deliveryFeePending === true && order.status !== "cancelled";

	// Three independent optional extras ride this one seam: the mark-shipped
	// dialog supplies courier fields, `markCollected` is the collection-gate
	// escape, and `overrideRiderGate` is only ever true from the "Update
	// manually" confirm below — the server refuses a rider-managed advance
	// without it.
	async function handleAdvance(
		stageId: string,
		shipment?: ShipmentFields,
		opts?: { markCollected?: boolean; overrideRiderGate?: boolean },
	) {
		if (!order) return;
		setPending(stageId);
		try {
			await advanceToStage({
				orderId: order._id,
				stageId,
				...shipment,
				...(opts?.markCollected ? { markCollected: true } : {}),
				...(opts?.overrideRiderGate ? { overrideRiderGate: true } : {}),
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Rethrow so the mark-shipped dialog stays open for a retry (the toast
			// above is the user-facing message; plain button paths swallow it).
			throw err;
		} finally {
			setPending(null);
		}
	}

	async function handleCancel(cancellationNote?: string) {
		if (!order) return;
		setPending("cancel");
		try {
			await updateStatus({
				orderId: order._id,
				status: "cancelled",
				cancellationNote,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Rethrow so the confirm dialog stays open for a retry; the toast above
			// is the user-facing message (ConfirmDialog swallows this).
			throw err;
		} finally {
			setPending(null);
		}
	}

	async function handleDelete() {
		if (!order) return;
		setPending("delete");
		try {
			await deleteOrder({ orderId: order._id });
			// The order no longer exists — leave the detail page before its query
			// resolves to null. Toast confirms the irreversible action landed.
			toast.success(`Order #${order.shortId} deleted permanently`);
			await navigate({ to: "/app/orders" });
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Rethrow so the confirm dialog stays open for a retry.
			throw err;
		} finally {
			setPending(null);
		}
	}

	async function handleMarkPaymentReceived() {
		if (!order) return;
		setConfirmingPayment(true);
		try {
			// Marking payment on a pending order auto-confirms it too, which
			// would otherwise also fire the generic "Order confirmed" toast.
			if (order.status === "pending") suppressNextOrderConfirmedToast();
			await markPaymentReceived({
				orderId: order._id,
				paymentMethod: paymentMethodChoice,
			});
			toast.success("Payment confirmed", {
				description: "The buyer sees it on their order page.",
			});
			setConfirmPaymentOpen(false);
			setPaymentMethodChoice(undefined);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setConfirmingPayment(false);
		}
	}

	function buildAskForProofWaUrl(): string | null {
		if (!order?.customer.waPhone) return null;
		const text = `Hi! Could you re-share the payment screenshot for ${order.shortId}? — ${order.customer.name ? `Thanks ${order.customer.name}!` : "Thanks!"}`;
		return `https://wa.me/${order.customer.waPhone}?text=${encodeURIComponent(text)}`;
	}

	const askForProofUrl = buildAskForProofWaUrl();

	const isPinned = order.pinnedAt !== undefined;
	const pinTargetId = order._id;
	async function togglePin() {
		setPinBusy(true);
		try {
			await setPinned({ orderId: pinTargetId, pinned: !isPinned });
			toast.success(isPinned ? "Unpinned" : "Pinned to the top of your inbox");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPinBusy(false);
		}
	}

	// One pin control, rendered in both the desktop header and the mobile header
	// row — the same button, so the two can't drift.
	const pinButton = (
		<Button
			type="button"
			variant={isPinned ? "secondary" : "outline"}
			size="icon"
			className="size-10 shrink-0 rounded-xl lg:size-9"
			aria-pressed={isPinned}
			aria-label={isPinned ? "Unpin this order" : "Pin this order"}
			// The tooltip is where the rule is stated — the feature is otherwise
			// invisible until the seller has used it once.
			title={
				isPinned
					? "Pinned — stays on top of your inbox until you unpin it"
					: "Pin to the top of your inbox"
			}
			disabled={pinBusy}
			onClick={() => void togglePin()}
		>
			<Pin
				className={cn(
					"size-4.5",
					isPinned && "text-accent-emphasis dark:text-accent",
				)}
				fill={isPinned ? "currentColor" : "none"}
				aria-hidden="true"
			/>
		</Button>
	);

	return (
		<div className="flex flex-col gap-5 lg:max-w-3xl">
			<PageHeader
				title={`#${order.shortId}`}
				subtitle={new Date(order._creationTime).toLocaleString(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
				})}
				back={{ to: "/app/orders", label: "Orders" }}
				actions={
					<>
						{pinButton}
						{/* Label first: it's the operational step (the parcel is going
						    out now); the receipt is bookkeeping, any time after. */}
						{canPrintLabel(order) ? (
							<PrintLabelButton shortId={order.shortId} />
						) : null}
						<ReceiptDownloadButton
							shortId={order.shortId}
							label="Download receipt"
						/>
					</>
				}
			/>
			{/* Order header (mobile) — back button, title, status at a glance. The
			    payment situation gets its own state card below, not a header pill. */}
			<div className="flex items-center gap-3 lg:hidden">
				<Link
					to="/app/orders"
					aria-label="Back to orders"
					className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
				>
					<ArrowLeft className="size-5" />
				</Link>
				<div className="min-w-0 flex-1">
					<h2 className="truncate font-heading text-lg font-extrabold leading-tight">
						Order{" "}
						<span className="font-mono text-base font-medium">
							#{order.shortId}
						</span>
					</h2>
					<p className="text-xs text-muted-foreground">
						{new Date(order._creationTime).toLocaleString(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
						{order.channel === "whatsapp" ? " · via WhatsApp" : ""}
						{/* Where the order came from, when that isn't the default. A claim link
						    (86eyq0epn) was keyed by the seller at a locked price and completed by
						    the buyer — worth saying on the one screen the seller opens to work the
						    order, since the inbox Source filter is the only other place it shows. */}
						{order.source === "claim" ? " · Claim link" : ""}
					</p>
				</div>
				{pinButton}
				<StatusBadge
					status={order.status}
					label={displayStatusLabel(
						order,
						currentStage
							? stageLabel(currentStage, "en")
							: resolveStatusLabel(order.status, statusLabelOpts),
					)}
				/>
			</div>

			{/* A booking request's stage control IS approve/decline (S3): the
			    stepper can't move it (the server refuses), so its slot holds the
			    request card until the seller answers. Once resolved without an
			    approval, a quiet note keeps the WHY visible on the cancelled order. */}
			{order.status === "booking_requested" ? (
				<BookingRequestCard order={order} />
			) : order.bookingResolution !== undefined ? (
				<BookingResolutionNote
					resolution={order.bookingResolution}
					reason={order.cancellationNote}
				/>
			) : null}

			{/* Security deposit (S5): the amber return card once the stay checks
			    out, the settled outcome after, refund context on a paid cancel. */}
			<SecurityDepositCard order={order} />
			{order.status === "booking_requested" ? null : (
			<OrderProgressStepper
				stages={stages}
				currentIndex={currentIdx}
				cancelled={order.status === "cancelled"}
				action={
					nextStage ? (
						(() => {
							// Advancing into production (packed or later) is blocked while
							// the mockup gate is closed — mirrors the server.
							const blocked =
								anchorOrdinal(nextStage.anchor) >= anchorOrdinal("packed") &&
								mockupGated;
							// A live rider booking with a working webhook drives shipped
							// (pickup) and delivered (drop-off) on its own — the manual
							// advance is disabled-with-reason, with a confirm-gated escape
							// below so a dead webhook never strands the order.
							const riderManaged =
								!blocked &&
								riderHandlingTrip &&
								isRiderManagedTransition(nextStage.anchor, order.status);
							// Collection: the goods aren't with the seller yet, so no production
							// stage can be true. Never overlaps riderManaged (that one is off on
							// collection orders) — same order the server checks them in.
							const collectionPending =
								!blocked &&
								awaitingCollection &&
								anchorOrdinal(nextStage.anchor) >= anchorOrdinal("packed");
							const riderMoment =
								nextStage.anchor === "delivered"
									? "the rider drops off"
									: "the rider picks up";
							// First move out of pending into a confirmed-anchored stage
							// keeps the familiar "Confirm Order" verb; everything else
							// reads "Mark as {stage}".
							const advanceLabel =
								order.status === "pending" && nextStage.anchor === "confirmed"
									? "Confirm Order"
									: `Mark as ${stageLabel(nextStage, "en")}`;
							return (
								<div className="flex flex-col gap-2">
									<button
										type="button"
										onClick={() => {
											// Marking a delivery order shipped is THE moment the
											// seller decides how it goes out, so prompt first: a
											// parcel seller for courier + tracking (optional; it lands
											// on the buyer's order page), a rider vendor for the
											// booking they may not have made yet. Skipped when
											// tracking is already attached AND when a rider booking
											// is active (belt-and-braces: booking mirrors its
											// shareLink onto carrierTrackingUrl, but a booked order
											// must never be re-prompted even if that link is
											// missing). Webhook-driven orders never reach here at
											// all — the button is disabled. Collection stores skip
											// the prompt entirely: their rider trip is buyer→store
											// (booked from the Collection card at confirm time), so
											// offering "book a rider" at the shipped moment would
											// dispatch ANOTHER collection — the return leg is its
											// own order (86eyg0n8e, Leg 2 out of scope).
											if (
												nextStage.anchor === "shipped" &&
												order.deliveryMethod === "delivery" &&
												!collectionService &&
												!hasActiveRiderBooking &&
												!order.trackingNo &&
												!order.carrierTrackingUrl
											) {
												// A rider vendor who CAN book goes straight to the
												// booking modal on the card below — the same one
												// prompt-on-packed opens, with the live price,
												// vehicle switch and variance. An intermediate
												// "how is this going out?" prompt in front of it
												// was pure chrome for them. The parcel form (and
												// the blocked-reason copy, which the booking modal
												// can't show because there's nothing to quote)
												// still belong to MarkShippedDialog.
												if (
													lalamoveVendor &&
													dispatchInfo?.blockReason === null
												) {
													setBookRequestToken((t) => t + 1);
													return;
												}
												setShipDialogOpen(true);
												return;
											}
											void handleAdvance(nextStage.id).catch(() => {});
										}}
										disabled={
											pending !== null ||
											blocked ||
											riderManaged ||
											collectionPending
										}
										className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-[15px] font-bold text-background transition-opacity hover:opacity-95 disabled:opacity-55"
									>
										{pending === nextStage.id ? (
											"Updating…"
										) : blocked ? (
											`${advanceLabel} — awaiting mockup`
										) : collectionPending ? (
											`${advanceLabel} — awaiting collection`
										) : riderManaged ? (
											`${advanceLabel} — automatic`
										) : (
											<>
												{advanceLabel}
												<ArrowRight className="size-4.5" />
											</>
										)}
									</button>
									{collectionPending ? (
										<p className="text-xs leading-relaxed text-muted-foreground">
											This order is still with your customer — send a rider to
											collect it, and you can move it on once the items are with
											you.{" "}
											<button
												type="button"
												onClick={() => setConfirmCollectedOpen(true)}
												disabled={pending !== null}
												className="font-medium underline underline-offset-2"
											>
												I already have the items
											</button>{" "}
											if you collected them yourself.
										</p>
									) : riderManaged ? (
										<p className="text-xs leading-relaxed text-muted-foreground">
											{riderWebhookReporting ? (
												<>
													A Lalamove rider is on this order — it moves to{" "}
													<b>{stageLabel(nextStage, "en")}</b> on its own when{" "}
													{riderMoment}.
												</>
											) : (
												<>
													A Lalamove rider is booked for this order — it moves
													to <b>{stageLabel(nextStage, "en")}</b> on its own
													once {riderMoment}, as long as your Lalamove webhook
													is set up.
												</>
											)}{" "}
											<button
												type="button"
												onClick={() => setConfirmManualAdvanceOpen(true)}
												disabled={pending !== null}
												className="font-medium underline underline-offset-2"
											>
												Update manually
											</button>{" "}
											{riderWebhookReporting
												? "if the automatic update didn't arrive."
												: "to move it yourself instead."}
										</p>
									) : null}
									{/* The buyer gets ONE WhatsApp per order (the confirmation),
									    so a status move is silent on their phone — say so where
									    the seller taps, or they'll assume it was sent. */}
									<p className="text-xs leading-relaxed text-muted-foreground">
										Moving the order along updates the buyer&apos;s order page —
										it doesn&apos;t send them a WhatsApp.
									</p>
								</div>
							);
						})()
					) : order.status === "delivered" ? (
						<p className="text-sm font-medium text-accent-emphasis">
							Completed — nothing left to do 🎉
						</p>
					) : undefined
				}
			/>
			)}

			{/* Confirmation push failed (86eyf1rck). Amber like the payment claim: it
			    needs the seller's eyes. Two causes, two different things for the
			    seller to do — blaming the buyer's number when the fault was ours
			    would send them chasing a customer for no reason. Clears itself once
			    the buyer is reached (manual send, or they correct their number). */}
			{order.confirmationPushStatus === "failed" &&
			order.status !== "cancelled" ? (
				<section
					{...MASK_PII}
					className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/50"
				>
					<MessageCircle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">
							{order.confirmationPushFailureKind === "system"
								? "Buyer's confirmation didn't go out"
								: "Couldn't reach the buyer on WhatsApp"}
						</p>
						{order.confirmationPushFailureKind === "system" ? (
							<p className="mt-1 text-sm text-amber-950 dark:text-amber-100">
								A WhatsApp problem on our side stopped the confirmation for this
								order — the buyer's number{" "}
								<b>{formatPhone(order.customer.waPhone ?? "")}</b> looks fine,
								so no need to chase them about it. The order is confirmed and
								they can see and pay for it on their order page. Message them
								yourself if you'd like to confirm it personally.
							</p>
						) : (
							<p className="mt-1 text-sm text-amber-950 dark:text-amber-100">
								The confirmation to{" "}
								<b>{formatPhone(order.customer.waPhone ?? "")}</b> didn't
								deliver — that number may have a typo or no WhatsApp. It's the
								only message this order sends, so they have nothing in chat to
								come back to. Their order page offers an &ldquo;Update my
								number&rdquo; fix; if they reach you another way, check the
								number with them.
							</p>
						)}
					</div>
				</section>
			) : null}

			{/* An authentic online payment the server refused to auto-apply (PR #178
			    review, finding 1). Amber like the confirmation-push note: money has
			    moved, the order is NOT paid, and only a human can close the gap.
			    Until now the seller's only signal was an email — on a product whose
			    whole premise is that sellers don't read email. Clears itself the
			    moment any receive path settles the order (applyPaymentReceived). */}
			{order.gatewayPaymentIssue ? (
				<section className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/50">
					<HandCoins className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">
							{order.gatewayPaymentIssue.kind === "paid_after_cancel"
								? "Paid after you cancelled"
								: "Online payment doesn't match this order"}
						</p>
						{order.gatewayPaymentIssue.kind === "paid_after_cancel" ? (
							<p className="mt-1 text-sm text-amber-950 dark:text-amber-100">
								<b>
									{formatPrice(
										order.gatewayPaymentIssue.paidAmountSen,
										order.gatewayPaymentIssue.paidCurrency,
									)}
								</b>{" "}
								came through online after this order was cancelled, so nothing
								was applied to it. Refund it from your HitPay dashboard using
								the reference below. The customer has been told not to pay
								again.
							</p>
						) : (
							<p className="mt-1 text-sm text-amber-950 dark:text-amber-100">
								The customer paid{" "}
								<b>
									{formatPrice(
										order.gatewayPaymentIssue.paidAmountSen,
										order.gatewayPaymentIssue.paidCurrency,
									)}
								</b>{" "}
								online, but this order&apos;s total is{" "}
								<b>{formatPrice(order.total, order.currency)}</b> — usually a
								checkout link opened before the price changed. It was <b>not</b>{" "}
								confirmed automatically. Check it in your HitPay dashboard:
								accept it with &ldquo;Mark payment received&rdquo; below, or
								refund it there. The customer has been told not to pay again.
							</p>
						)}
						<div className="mt-2 flex items-start justify-between gap-2">
							<p className="min-w-0 break-all font-mono text-xs text-amber-900/80 dark:text-amber-200/80">
								Ref {order.gatewayPaymentIssue.paymentId}
							</p>
							<CopyButton
								value={order.gatewayPaymentIssue.paymentId}
								ariaLabel="Copy payment reference"
								successMessage="Payment reference copied"
								className="-my-2"
							/>
						</div>
						{/* The exit for the seller who REFUNDED rather than accepted.
						    Online payment is blocked while this notice stands (so the
						    customer can't be charged twice), so without a way to retire
						    it a refund would leave them unable to pay at all. Names the
						    consequence rather than just "Dismiss". */}
						<Button
							variant="outline"
							size="sm"
							disabled={pending !== null}
							onClick={async () => {
								setPending("clear-gateway-issue");
								try {
									await clearGatewayPaymentIssue({ orderId: order._id });
									toast.success("Payment notice cleared");
								} catch (err) {
									toast.error(convexErrorMessage(err));
								} finally {
									setPending(null);
								}
							}}
							className="mt-3 border-amber-300 bg-transparent text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/50"
						>
							Mark as resolved
						</Button>
						<p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-200/70">
							Clears this notice and lets the customer pay online again — use it
							once you&apos;ve refunded them.
						</p>
					</div>
				</section>
			) : null}

			{/* Shopper's note + optional custom-line reference photo — front-and-centre
			    so it isn't missed when fulfilling. Plain text, escaped by React. */}
			{order.customerNote || order.customerImageStorageId ? (
				<section
					{...MASK_PII}
					className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4"
				>
					<StickyNote className="size-5 shrink-0 text-amber-600" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
							{order.customerNote ? "Note from customer" : "From customer"}
						</p>
						{order.customerNote ? (
							<p className="mt-1 whitespace-pre-line break-words text-sm text-amber-950">
								{order.customerNote}
							</p>
						) : null}
						{order.customerImageStorageId ? (
							customerImageUrl ? (
								<ZoomableImage
									src={customerImageUrl}
									alt="Customer reference photo"
									caption="Customer reference photo"
									// Buyer-supplied, order-owned — erased on hard delete.
									sensitive
									wrapperClassName="mt-2 block w-fit overflow-hidden rounded-xl border border-amber-300 bg-white"
									className="block max-h-56 w-auto object-contain"
								/>
							) : (
								<div className="mt-2 h-24 w-32 animate-pulse rounded-xl bg-amber-200/50" />
							)
						) : null}
					</div>
				</section>
			) : null}

			{/* Delivery charge to confirm — the out-of-range "arrange via WhatsApp"
			    state (86extzdr8). Amber like the payment claim: it needs the
			    seller's action before the buyer can be asked to pay. */}
			{deliveryFeePending ? <SetDeliveryFeeCard order={order} /> : null}

			{/* Payment claim — the amber "needs your eyes" state card, actionable
			    when the shopper has tapped "I've paid". */}
			{paymentStatus === "claimed" ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/50">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
							<Hourglass className="size-4" />
							<p className="text-xs font-semibold uppercase tracking-widest">
								Payment claimed
							</p>
						</div>
						<span className="font-mono text-[15px] font-bold tabular-nums">
							{formatPrice(order.total, order.currency)}
						</span>
					</div>

					<div className="flex flex-col gap-2 rounded-xl bg-background/80 p-3">
						<div className="flex items-start justify-between gap-3">
							<span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
								Reference
							</span>
							<span className="break-all text-right text-sm font-medium">
								{order.paymentReference ?? (
									<em className="font-normal text-muted-foreground">
										not provided
									</em>
								)}
							</span>
						</div>
						{order.paymentClaimedAt ? (
							<div className="flex items-center justify-between gap-3">
								<span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
									Submitted
								</span>
								<span className="text-sm">
									{formatRelative(order.paymentClaimedAt)}
								</span>
							</div>
						) : null}
					</div>

					{order.paymentProofStorageId ? (
						proofUrl ? (
							<a
								href={proofUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="block overflow-hidden rounded-xl border border-amber-200 bg-background dark:border-amber-800"
							>
								{/* Fixed-height frame (was max-h with auto height) so the
								    skeleton has a real box to show while this — a real
								    photo upload with no prior placeholder — loads. */}
								<AppImage
									src={proofUrl}
									alt="Payment receipt"
									aspect="h-64 w-full"
									objectFit="contain"
									// A buyer's bank screenshot. Order-owned, erased on hard
									// delete — must never sit on a public edge cache.
									sensitive
								/>
							</a>
						) : (
							<div className="flex items-center justify-center rounded-xl border border-amber-200 bg-background p-4 text-xs text-muted-foreground dark:border-amber-800">
								Loading screenshot…
							</div>
						)
					) : (
						<p className="text-sm text-amber-900/90 dark:text-amber-200/90">
							No screenshot attached. Cross-check the amount and reference in
							your bank app.
						</p>
					)}

					<div className="flex flex-col gap-2">
						<Button
							onClick={() => setConfirmPaymentOpen(true)}
							isLoading={confirmingPayment}
							disabled={confirmingPayment}
							className="h-11 w-full"
						>
							Mark payment received
						</Button>
						{askForProofUrl ? (
							<Button asChild variant="secondary" className="h-11 w-full">
								<a
									href={askForProofUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									<MessageCircle className="size-4" />
									Ask for proof on WhatsApp
								</a>
							</Button>
						) : null}
					</div>
				</section>
			) : null}

			{/* Unpaid → retailer can confirm directly without waiting for shopper claim. */}
			{paymentStatus === "unpaid" && order.status !== "cancelled" ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center gap-2">
						<HandCoins className="size-4 text-amber-600" />
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Payment
						</p>
					</div>
					<p className="text-sm text-muted-foreground">
						{mockupGated
							? `Payment is locked until the custom item is sorted — ${
									order.mockupStatus === "submitted"
										? "the buyer is reviewing the mockup"
										: "send the buyer a mockup to approve"
								}. The buyer is only asked to pay once they approve (or you proceed without approval below).`
							: deliveryFeePending
								? "Payment is locked until you set the delivery charge above — the buyer is only asked to pay once the total is final."
								: `The customer hasn't tapped "I've paid" yet. If you've already seen the money in your bank app, mark it received here.`}
					</p>
					{/* While the mockup gate is closed (or the delivery charge is still
					    pending) the buyer hasn't been asked to pay and the price may not
					    be final, so the seller can't mark payment received yet. */}
					<Button
						onClick={() => setConfirmPaymentOpen(true)}
						isLoading={confirmingPayment}
						disabled={confirmingPayment || mockupGated || deliveryFeePending}
						variant="secondary"
						className="h-11 w-full"
					>
						<BadgeCheck className="size-4" />
						{mockupGated
							? "Awaiting mockup approval"
							: deliveryFeePending
								? "Set the delivery charge first"
								: "Mark payment received"}
					</Button>
					{/* The manual payment reminder (86eyd63r8, revised 8 Aug): Kedaipal
					    never chases automatically — the seller gets a window-boxed
					    button instead. Hidden before day 11 (a control that's dead for
					    10 days is noise — the line below names the unlock day), live
					    on days 11–14 at most once per 24h, and closed for good after
					    day 14. The eligibility mirrors the server's
					    manualReminderEligibility exactly, so the disabled reasons here
					    can never disagree with the mutation's lock. */}
					{!mockupGated && !deliveryFeePending
						? (() => {
								const eligibility = manualReminderEligibility(
									{
										status: order.status,
										paymentStatus: order.paymentStatus,
										mockupStatus: order.mockupStatus,
										mockupWaivedAt: order.mockupWaivedAt,
										deliveryFeePending: order.deliveryFeePending,
										lastManualReminderAt: order.lastManualReminderAt,
										createdAt: order.createdAt,
										customer: { waPhone: order.customer.waPhone },
									},
									Date.now(),
								);
								const blocked = eligibility.ok ? undefined : eligibility;
								if (blocked?.reason === "too_early") {
									return (
										<p className="border-t border-border pt-3 text-xs text-muted-foreground">
											Kedaipal doesn't chase payment for you — how to pay is
											always on the buyer's order page. If this is still unpaid
											on day 11, a "Send payment reminder" button unlocks here (
											{blocked.unlockAt
												? formatUntil(blocked.unlockAt)
												: "later"}
											); until then, nudge them yourself with the WhatsApp
											button below.
										</p>
									);
								}
								if (blocked?.reason === "window_closed") {
									return (
										<p className="border-t border-border pt-3 text-xs text-muted-foreground">
											The reminder window has closed — this order is past day 14
											unpaid, which is beyond a nudge. Settle it with the buyer
											directly (the WhatsApp button below), then mark payment
											received — or cancel the order.
										</p>
									);
								}
								if (blocked?.reason === "no_contact") {
									return (
										<p className="border-t border-border pt-3 text-xs text-muted-foreground">
											No buyer WhatsApp number on file, so there's nobody to
											remind — how to pay stays on the order page.
										</p>
									);
								}
								const onCooldown = blocked?.reason === "cooldown";
								return (
									<div className="flex flex-col gap-2 border-t border-border pt-3">
										<Button
											onClick={async () => {
												setSendingReminder(true);
												try {
													const res = await sendPaymentReminder({ shortId });
													if (res.ok) {
														toast.success("Payment reminder sent", {
															description:
																"Amount, reference and the order-page link — you can send the next one in 24 hours.",
														});
													} else {
														toast.error("Reminder not sent", {
															description:
																res.reason === "cooldown"
																	? "You've already reminded this buyer in the last 24 hours."
																	: res.reason === "window_closed"
																		? "The day-14 reminder window has closed."
																		: "This order can't be reminded right now.",
														});
													}
												} finally {
													setSendingReminder(false);
												}
											}}
											isLoading={sendingReminder}
											disabled={sendingReminder || onCooldown}
											variant="outline"
											className="h-11 w-full"
										>
											<MessageCircle className="size-4" />
											{onCooldown
												? `Reminded — next ${blocked?.retryAt ? formatUntil(blocked.retryAt) : "in 24h"}`
												: "Send payment reminder on WhatsApp"}
										</Button>
										<p className="text-xs text-muted-foreground">
											{onCooldown
												? "Once per day, and only until day 14 — after that it's a conversation, not a nudge."
												: "Sends the amount, transfer reference and their order-page link. Once per day until day 14. If the buyer has never replied on WhatsApp, Meta may not deliver it — the chat button below always works."}
										</p>
									</div>
								);
							})()
						: null}
				</section>
			) : null}

			{/* Received → read-only confirmation. */}
			{paymentStatus === "received" ? (
				<section className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
					<BadgeCheck className="size-5 shrink-0 text-emerald-700" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
							Payment received
						</p>
						<p className="text-sm text-emerald-900">
							{order.gatewayPaymentId
								? // Auto-confirmed by the HitPay webhook (86eyb6z3a) — say so,
									// since nobody on the team pressed the button.
									`Paid online via HitPay${order.paymentReceivedAt ? ` ${formatRelative(order.paymentReceivedAt)}` : ""}`
								: order.paymentReceivedAt
									? `Confirmed ${formatRelative(order.paymentReceivedAt)}`
									: "Confirmed by you"}
							{order.paymentMethod
								? ` · ${paymentMethodLabel(order.paymentMethod)}`
								: ""}
						</p>
						{order.gatewayPaymentId ? (
							// The seller is the side that pastes this into HitPay's
							// dashboard search (to refund or reconcile), so the copy
							// affordance belongs here at least as much as on the buyer's
							// page — it was the buyer-only half of "one number both sides
							// quote". `break-all` over `truncate`: a half-shown reference
							// can't be matched against a dashboard entry.
							<div className="mt-1 flex items-start justify-between gap-2">
								<p className="min-w-0 break-all font-mono text-xs text-emerald-800/80">
									Ref {order.gatewayPaymentId}
								</p>
								<CopyButton
									value={order.gatewayPaymentId}
									ariaLabel="Copy payment reference"
									successMessage="Payment reference copied"
									// Layout only — no colour override, so the primitive's
									// own "Copied" green still lands on tap.
									className="-my-2"
								/>
							</div>
						) : null}
					</div>
				</section>
			) : null}

			{/* Customer — CRM context inline (order count, lifetime spend) with
			    WhatsApp as the hero contact action. The avatar row deep-links to
			    the full profile when one exists. */}
			<section
				{...MASK_PII}
				className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
			>
				{(() => {
					const avatarRow = (
						<>
							<span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground font-heading text-[15px] font-extrabold text-background">
								{order.customer.name ? (
									initials(order.customer.name)
								) : (
									<User className="size-5" />
								)}
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="truncate text-[15px] font-semibold">
									{orderCustomerLabel(order.customer)}
								</span>
								<span className="truncate text-[12.5px] text-muted-foreground">
									{order.customer.waPhone
										? formatPhone(order.customer.waPhone)
										: "No phone captured"}
									{crmCustomer
										? ` · ${crmCustomer.orderCount} order${crmCustomer.orderCount === 1 ? "" : "s"} · ${formatPriceCompact(crmCustomer.totalSpent, order.currency)}`
										: ""}
								</span>
							</span>
						</>
					);
					return order.customerId ? (
						<Link
							to="/app/customers/$customerId"
							params={{ customerId: order.customerId }}
							className="-m-1 flex items-center gap-3 rounded-xl p-1 transition-colors hover:bg-muted/60"
							aria-label="View customer profile"
						>
							{avatarRow}
							{/* Starter: the profile link lands on the customers upgrade
							    wall — badge it so the tap is never a surprise (the CRM
							    stats line above stays hidden for the same reason). */}
							{crmLocked ? <ProBadge className="shrink-0" /> : null}
							<ChevronRight className="size-4.5 shrink-0 text-muted-foreground/60" />
						</Link>
					) : (
						<div className="flex items-center gap-3">{avatarRow}</div>
					);
				})()}
				{/* Where this buyer came from (86eyq0eq9). Sits in the CUSTOMER card
				    because it answers the other half of "who is this?" — the channel
				    that produced them — and it's the only per-order place the fact
				    lives. Always rendered, including for Direct: an absent row would
				    read as "not tracked" rather than "arrived untagged". */}
				{(() => {
					const bucket = attributionBucket(order);
					const brand = BRAND_GLYPHS[bucket];
					const inner = (
						<>
							{brand ? (
								<brand.Icon className={cn("size-4", brand.colorClass)} />
							) : null}
							<span className="text-sm font-medium">{sourceLabel(bucket)}</span>
						</>
					);
					return (
						<div className="flex items-center gap-2 border-t border-border pt-3">
							<span className="text-xs text-muted-foreground">Came from</span>
							{inboxFilterLocked ? (
								<span className="ml-auto flex items-center gap-1.5">
									{inner}
								</span>
							) : (
								<Link
									to="/app/orders"
									search={{ asrc: [bucket] }}
									aria-label={`See every order from ${sourceLabel(bucket)}`}
									className="tap-target -mr-2 ml-auto flex items-center justify-end gap-1.5 rounded-lg px-2 transition-colors hover:bg-muted/60"
								>
									{inner}
									<ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
								</Link>
							)}
						</div>
					);
				})()}
				{order.customer.waPhone ? (
					<div className="flex gap-2">
						<a
							href={`https://wa.me/${order.customer.waPhone}`}
							target="_blank"
							rel="noopener noreferrer"
							className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 text-sm font-bold text-accent-emphasis transition-colors hover:bg-accent/20"
						>
							<MessageCircle className="size-4.5" />
							WhatsApp
						</a>
						<a
							href={`tel:+${order.customer.waPhone}`}
							aria-label={`Call ${order.customer.name ?? "customer"}`}
							className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
						>
							<Phone className="size-4.5" />
						</a>
					</div>
				) : null}
			</section>

			{/* Delivery method. Two stacked rows, not one — the date badge, time
			    and Reschedule control all competed for one line on mobile and
			    wrapped mid-badge (Zaki's 19 Aug screenshot); the date row now
			    owns the card's full width under a separator. */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
						{isBooking ? (
							<CalendarRange className="size-4 text-muted-foreground" />
						) : isSelfCollect ? (
							<Package className="size-4 text-muted-foreground" />
						) : (
							<Truck className="size-4 text-muted-foreground" />
						)}
					</div>
					<div className="flex min-w-0 flex-col">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Fulfillment
						</p>
						<p className="text-sm font-medium">
							{isBooking
								? order.bookingCheckIn !== undefined &&
									order.bookingCheckOut !== undefined
									? bookingFulfilmentLine(order)
									: "Booking"
								: isSelfCollect
									? order.pickupSnapshot?.locationType === "drop_off"
										? "Drop-off"
										: "Self Collect"
									: collectionService
										? "Collection"
										: "Delivery"}
						</p>
					</div>
					{/* Seller reschedule (86eyp5qd1) — renders only inside the
					    reschedule window (pre-shipped, non-counter, not collected). */}
					{/* Not on a booking: this dialog moves `fulfilmentDate` only,
					    while a stay's real dates are bookingCheckIn/Out under a
					    capacity check — rescheduling one without the other would
					    desync them. Changing a stay's dates is decline + re-request
					    until the booking-aware reschedule ships. */}
					{isBooking ? null : (
						<div className="ml-auto shrink-0">
							<RescheduleFulfilmentDialog order={order} />
						</div>
					)}
				</div>
				{order.fulfilmentDate !== undefined && order.source !== "counter" ? (
					<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border pt-3">
						<span className="text-xs text-muted-foreground">
							{isBooking
								? "Check-in"
								: isSelfCollect
									? order.pickupSnapshot?.locationType === "drop_off"
										? "Meet on"
										: "Collect on"
									: collectionService
										? "Collect on"
										: "Deliver on"}
						</span>
						<FulfilmentDateBadge
							epoch={order.fulfilmentDate}
							size="md"
							muted={isTerminal || order.collectedAt !== undefined}
						/>
						{order.fulfilmentTimeMinutes !== undefined ? (
							<span className="text-sm font-medium whitespace-nowrap">
								{formatFulfilmentTime(order.fulfilmentTimeMinutes)}
							</span>
						) : null}
					</div>
				) : null}
			</section>

			{/* Items */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Items
				</p>
				<ul className="flex flex-col divide-y divide-border">
					{order.items.map((item, i) => (
						<li
							key={item.variantId ?? `${item.productId}-${i}`}
							className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
						>
							{/* Thumbnail (86eyrtz74) — variant photo, else the product's.
							    A packing aid, not a record: the image is deliberately not
							    frozen onto the order, so a replaced photo shows the new one
							    and a deleted one degrades to AppImage's fallback box rather
							    than a broken image or a collapsed row. Fixed size so the
							    name never gets squeezed to two characters on a phone. */}
							<AppImage
								src={itemImageUrls?.[i] ?? undefined}
								alt={item.name}
								sizes="44px"
								className="size-11 shrink-0 rounded-xl border border-border object-cover"
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">
									{item.name}
									{item.variantLabel ? (
										<span className="ml-1.5 font-normal text-muted-foreground">
											{item.variantLabel}
										</span>
									) : null}
								</p>
								<p className="text-xs text-muted-foreground">
									{item.quantity} × {formatPrice(item.price, order.currency)}
								</p>
							</div>
							<p className="shrink-0 text-sm font-semibold tabular-nums">
								{formatPrice(item.price * item.quantity, order.currency)}
							</p>
						</li>
					))}
				</ul>
				{order.mockupQuotedAmount != null && order.mockupQuotedAmount > 0 ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>
							Custom work
							{order.mockupStatus === "approved" ? "" : " (proposed)"}
						</span>
						<span className="tabular-nums">
							{formatPrice(order.mockupQuotedAmount, order.currency)}
						</span>
					</div>
				) : null}
				{/* Frozen per-location pickup fee — mirrors the buyer's tracking
				    page so both sides reconcile the same breakdown. */}
				{order.pickupFee && order.pickupFee > 0 ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>
							Pickup fee
							{order.pickupSnapshot?.label
								? ` — ${order.pickupSnapshot.label}`
								: ""}
						</span>
						<span className="tabular-nums">
							{formatPrice(order.pickupFee, order.currency)}
						</span>
					</div>
				) : null}
				{/* Frozen delivery charge — annotated with how it was priced (band
				    distance / zone + weight / manual) so the number is auditable at
				    a glance. */}
				{order.deliveryFee && order.deliveryFee > 0 ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>
							Delivery fee
							{order.deliverySnapshot?.mode === "radius" &&
							order.deliverySnapshot.distanceKm !== undefined
								? ` — ${order.deliverySnapshot.distanceKm} km`
								: order.deliverySnapshot?.mode === "weight"
									? ` — ${[
											order.deliverySnapshot.zoneName,
											order.deliverySnapshot.chargeableKg !== undefined
												? `${order.deliverySnapshot.chargeableKg} kg`
												: undefined,
										]
											.filter(Boolean)
											.join(" · ")}`
									: order.deliverySnapshot?.mode === "manual"
										? " — set by you"
										: ""}
						</span>
						<span className="tabular-nums">
							{formatPrice(order.deliveryFee, order.currency)}
						</span>
					</div>
				) : null}
				{deliveryFeePending ? (
					<div className="flex items-center justify-between gap-3 px-3 text-sm text-amber-700 dark:text-amber-400">
						<span>Delivery charge</span>
						<span className="text-right font-medium">
							To be set — see above
						</span>
					</div>
				) : null}
				{/* Refundable deposit inside the total — held money, returned after
				    check-out (the card above tracks the return). */}
				{order.securityDeposit && order.securityDeposit > 0 ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>Security deposit (refundable)</span>
						<span className="tabular-nums">
							{formatPrice(order.securityDeposit, order.currency)}
						</span>
					</div>
				) : null}
				<div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-bold">
					<span>Total</span>
					<span className="tabular-nums">
						{formatPrice(order.total, order.currency)}
						{deliveryFeePending ? (
							<span className="font-medium text-muted-foreground">
								{" "}
								+ delivery
							</span>
						) : null}
					</span>
				</div>
			</section>

			{/* Pickup location (self-collect orders only) — reads frozen snapshot
			    so a later retailer edit never rewrites historical order info. */}
			{isSelfCollect && order.pickupSnapshot ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							{order.pickupSnapshot.locationType === "drop_off"
								? "Meet at"
								: "Pick up at"}
						</p>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => {
									if (!order.pickupSnapshot) return;
									const text = formatPickupInline(order.pickupSnapshot);
									navigator.clipboard
										.writeText(text)
										.then(() => toast.success("Pickup info copied"))
										.catch(() =>
											toast.error("Couldn't copy — please copy manually"),
										);
								}}
								className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="Copy pickup info"
							>
								<Copy className="size-3.5" />
								Copy
							</button>
							{(() => {
								const mapsUrl = deriveMapsUrl(order.pickupSnapshot);
								return mapsUrl ? (
									<a
										href={mapsUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-accent hover:bg-accent/10"
										aria-label="Open in Maps"
									>
										<MapPin className="size-3.5" />
										Maps
									</a>
								) : null;
							})()}
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<p className="text-sm font-semibold leading-tight">
							{order.pickupSnapshot.label}
						</p>
						<p className="text-sm text-muted-foreground whitespace-pre-line">
							{order.pickupSnapshot.address}
						</p>
						{order.pickupSnapshot.notes ? (
							<p className="mt-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-foreground whitespace-pre-line">
								{order.pickupSnapshot.notes}
							</p>
						) : null}
					</div>
				</section>
			) : null}

			{/* Notify store manager (self-collect orders only) — copy-button hands
			    the seller a ready-to-forward message for whoever runs the pickup
			    location. Fixed format for v1; per-retailer override is future work. */}
			{isSelfCollect && order.pickupSnapshot ? (
				<NotifyManagerCard
					shortId={order.shortId}
					location={order.pickupSnapshot}
					pickupLocationId={order.pickupLocationId}
					customerName={order.customer.name}
					customerWaPhone={order.customer.waPhone}
					items={order.items}
					total={order.total}
					currency={order.currency}
				/>
			) : null}

			{/* Lalamove dispatch (delivery orders): one-tap "Book delivery" with
			    re-quote confirm, live job card (driver/plate/tracking), failed-
			    booking rebook, and disabled-with-reason states. 86eyb5hrf. */}
			{!isSelfCollect ? (
				<BookDeliveryCard
					order={order}
					bookRequestToken={bookRequestToken}
					// The way out of that modal when this one is going by hand. The
					// card renders it ONLY on the manual-advance path, so the packed
					// prompt and the card's own button stay a plain book-or-not.
					advanceWithoutRider={
						nextStage
							? {
									label: `${stageLabel(nextStage, "en")} without a rider`,
									onConfirm: () => {
										void handleAdvance(nextStage.id);
									},
								}
							: undefined
					}
					onAdvanceBookUnavailable={() => setShipDialogOpen(true)}
				/>
			) : null}

			{/* Delivery address (delivery orders only). Collection orders relabel:
			    this is where the rider COLLECTS, not where anything is delivered
			    (frozen order.deliveryDirection, 86eyg0n8e). */}
			{!isSelfCollect && order.deliveryAddress ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							{order.deliveryDirection === "collection"
								? "Collect From"
								: "Delivery Address"}
						</p>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => {
									if (!order.deliveryAddress) return;
									const text = formatAddressInline(order.deliveryAddress);
									navigator.clipboard
										.writeText(text)
										.then(() => toast.success("Address copied"))
										.catch(() =>
											toast.error("Couldn't copy — please copy manually"),
										);
								}}
								className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="Copy address"
							>
								<Copy className="size-3.5" />
								Copy
							</button>
							<a
								href={
									deriveMapsUrl(order.deliveryAddress) ??
									`https://maps.google.com/?q=${encodeURIComponent(
										formatAddressInline(order.deliveryAddress),
									)}`
								}
								target="_blank"
								rel="noopener noreferrer"
								className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-accent hover:bg-accent/10"
								aria-label="Open in Maps"
							>
								<MapPin className="size-3.5" />
								Maps
							</a>
						</div>
					</div>
					<DeliveryAddressDisplay address={order.deliveryAddress} />
				</section>
			) : null}

			{/* Shipment tracking — manual courier + tracking number (86eyehvk4) */}
			{/* Read-only only while a rider is actually handling this delivery
			    (booked, or bookable right now). If booking is blocked — Starter
			    downgrade, pinless legacy address, phone-less counter order — the
			    parcel that went out instead still needs its consignment number, so
			    the manual entry stays. See ShipmentTrackingCard. */}
			{showCarrierSection ? (
				<ShipmentTrackingCard
					order={order}
					readOnly={
						lalamoveVendor &&
						(dispatchInfo?.blockReason === null || hasActiveRiderBooking)
					}
				/>
			) : null}

			{order.mockupStatus !== undefined ? <MockupCard order={order} /> : null}

			{/* Rare actions (receipt, cancel, delete) collapse behind one quiet
			    trigger — the stepper above already carries the main transition. The
			    trigger + its menu share ONE bordered container so the panel reads as
			    the trigger's own dropdown, not a detached card. Delete is admin-only
			    now, so a plain seller's desktop panel would hold only Cancel — hidden
			    on desktop for a terminal order (receipt lives in the header there) so
			    it never opens to an empty divider; mobile keeps its receipt row. */}
			<section
				className={`overflow-hidden rounded-xl border border-border bg-card${
					hasDestructiveAction ? "" : " lg:hidden"
				}`}
			>
				<button
					type="button"
					onClick={() => setMoreOpen((x) => !x)}
					aria-expanded={moreOpen}
					className="flex h-12 w-full items-center justify-center gap-1.5 px-4 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
				>
					More actions
					<ChevronDown
						className={`size-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
						aria-hidden="true"
					/>
				</button>
				{moreOpen ? (
					// Menu items flow directly below the trigger, inside the same border:
					// equal-height, left-aligned ghost rows; the destructive actions
					// (Cancel / Delete) sit below a divider, set apart from the receipt.
					<>
						{/* Separates the trigger header from its menu items. */}
						<hr className="border-border" />
						{/* Label + receipt on mobile (desktop has both in the PageHeader
						    actions). Label first, same reasoning as the header. */}
						{canPrintLabel(order) ? (
							<PrintLabelButton
								shortId={order.shortId}
								variant="ghost"
								size="default"
								className="h-12 w-full justify-start gap-2.5 rounded-none px-4 text-sm font-medium lg:hidden"
							/>
						) : null}
						<ReceiptDownloadButton
							shortId={order.shortId}
							label="Download receipt"
							variant="ghost"
							size="default"
							className="h-12 w-full justify-start gap-2.5 rounded-none px-4 text-sm font-medium lg:hidden"
						/>
						{/* Neutral → destructive divider, mobile-only (desktop's header rule
						    above already leads in). Skipped when nothing destructive follows
						    (terminal order + plain seller) so it never dangles below receipt. */}
						{hasDestructiveAction ? (
							<hr className="border-border lg:hidden" />
						) : null}
						{!isTerminal ? (
							<Button
								onClick={() => setConfirmCancelOpen(true)}
								disabled={pending !== null}
								variant="ghost"
								className="h-12 w-full justify-start gap-2.5 rounded-none px-4 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
							>
								<Ban className="size-4" aria-hidden="true" />
								{pending === "cancel" ? "Updating…" : "Cancel Order"}
							</Button>
						) : null}
						{/* Permanent hard delete — Kedaipal admins only (own store or
						    act-as). Hidden for a plain seller, who cancels instead; the
						    server enforces the same rule. Any status; irreversible. */}
						{canHardDelete ? (
							<>
								<Button
									onClick={() => setConfirmDeleteOpen(true)}
									disabled={pending !== null}
									variant="ghost"
									className="h-12 w-full justify-start gap-2.5 rounded-none px-4 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
								>
									<Trash2 className="size-4" aria-hidden="true" />
									{pending === "delete" ? "Deleting…" : "Delete permanently"}
								</Button>
								<p className="border-t border-border bg-muted/30 px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">
									Kedaipal admin only — sellers don't see this. Deleting removes
									this order and its records for good, and is recorded in the
									admin log.
								</p>
							</>
						) : null}
					</>
				) : null}
			</section>

			{nextStage ? (
				<MarkShippedDialog
					open={shipDialogOpen}
					onOpenChange={setShipDialogOpen}
					advanceLabel={`Mark as ${stageLabel(nextStage, "en")}`}
					onConfirm={(fields) => handleAdvance(nextStage.id, fields)}
					// A rider vendor gets the blocked-rider notice, never the
					// parcel-courier form — and never a booking CTA, because a
					// bookable order never reaches this dialog (the advance opens
					// the dispatch card's booking modal instead).
					lalamoveVendor={lalamoveVendor}
					riderBlockReason={dispatchInfo?.blockReason ?? null}
				/>
			) : null}

			{nextStage ? (
				<ConfirmDialog
					open={confirmManualAdvanceOpen}
					onOpenChange={setConfirmManualAdvanceOpen}
					title={`Mark as ${stageLabel(nextStage, "en")} manually?`}
					description={`A Lalamove rider is handling this order, and its status updates automatically from the rider's progress. Marking it manually moves the order on the buyer's order page now${
						nextStage.anchor === "shipped"
							? " — before pickup, and without the live-tracking link"
							: ""
					}. The buyer isn't sent a WhatsApp either way. Only do this if the automatic update didn't come through.`}
					confirmLabel={`Mark as ${stageLabel(nextStage, "en")}`}
					cancelLabel="Keep automatic"
					onConfirm={() =>
						handleAdvance(nextStage.id, undefined, { overrideRiderGate: true })
					}
				/>
			) : null}

			{/* The rider is now pointless — the goods are already with the seller.
			    Asked, never automatic: Lalamove can charge a cancellation fee once
			    a driver is assigned, so the spend stays the seller's decision. */}
			<ConfirmDialog
				open={confirmCancelRiderOpen}
				onOpenChange={setConfirmCancelRiderOpen}
				title="Cancel the rider booking?"
				description="You've marked this order as collected, but a Lalamove rider is still booked to pick it up — they'll turn up for items you already have. Cancelling stops that; Lalamove may charge a fee if a driver was already assigned."
				confirmLabel={cancellingRider ? "Cancelling…" : "Cancel the rider"}
				cancelLabel="Keep the booking"
				destructive
				onConfirm={async () => {
					setCancellingRider(true);
					try {
						const result = await cancelRiderBooking({
							shortId: order.shortId,
						});
						if (result.ok) toast.success("Lalamove booking cancelled.");
						else toast.error(result.message ?? "Couldn't cancel the booking.");
					} finally {
						setCancellingRider(false);
					}
				}}
			/>

			{/* Collection escape: the seller has the items without a rider having
			    reported it. Confirming records the arrival, so this asks once —
			    every later stage moves freely. */}
			{nextStage ? (
				<ConfirmDialog
					open={confirmCollectedOpen}
					onOpenChange={setConfirmCollectedOpen}
					title="Do you already have the items?"
					description={`Confirm only if your customer's items are physically with you — no rider has reported collecting them. This marks the order as collected, so you can move it through your stages from here.${
						hasActiveRiderBooking
							? " A rider is still booked for this order — we'll ask whether to cancel them next."
							: ""
					}`}
					confirmLabel="Yes, I have the items"
					cancelLabel="Not yet"
					onConfirm={async () => {
						await handleAdvance(nextStage.id, undefined, {
							markCollected: true,
						});
						// Only after the collection is actually recorded — a failed
						// advance must not leave the seller cancelling a rider for
						// an order that never moved.
						if (hasActiveRiderBooking) setConfirmCancelRiderOpen(true);
					}}
				/>
			) : null}

			<ConfirmDialog
				open={confirmCancelOpen}
				onOpenChange={setConfirmCancelOpen}
				title={`Cancel order #${order.shortId}?`}
				description={
					hasActiveRiderBooking
						? `Stock is restored and this can't be undone. The customer is NOT sent a WhatsApp — the reason you give below is what they see on their order page. ⚠️ A Lalamove rider booking is still active on this order — cancel it from the ${dispatchCardName} card too, or you may pay for a wasted trip.`
						: "Stock is restored and this can't be undone. The customer is NOT sent a WhatsApp — the reason you give below is what they see on their order page."
				}
				confirmLabel="Cancel order"
				cancelLabel="Keep order"
				destructive
				reason={{
					label: "Why are you cancelling?",
					placeholder: isBooking
						? "e.g. The site flooded after last night's storm"
						: "e.g. Out of stock — sorry!",
					// A guest planned around these dates, so a cancelled booking owes
					// them the same explanation a declined request gives. The server
					// enforces this too.
					required: isBooking,
					maxLength: 200,
					helper: "The customer sees this on their order page.",
				}}
				onConfirm={handleCancel}
			/>

			<ConfirmDialog
				open={confirmDeleteOpen}
				onOpenChange={setConfirmDeleteOpen}
				title={`Delete order #${order.shortId} permanently?`}
				description={
					paymentStatus === "received" || order.status === "delivered"
						? `This order is paid/completed — deleting erases it from your sales records, receipts and CSV exports. Stock isn't affected and the customer is NOT notified. This can't be undone.${
								hasActiveRiderBooking
									? ` ⚠️ A Lalamove rider booking is still active — cancel it from the ${dispatchCardName} card FIRST or the rider still shows up.`
									: ""
							}`
						: `This erases the order, its timeline and any uploaded images for good.${
								hasActiveRiderBooking
									? ` ⚠️ A Lalamove rider booking is still active — cancel it from the ${dispatchCardName} card FIRST or the rider still shows up.`
									: ""
							}${
								order.status === "cancelled"
									? ""
									: " Reserved stock is returned and your totals are adjusted."
							} The customer is NOT notified. This can't be undone.`
				}
				confirmLabel="Delete permanently"
				cancelLabel="Keep order"
				destructive
				confirmPhrase="DELETE"
				onConfirm={handleDelete}
			/>

			<Dialog
				open={confirmPaymentOpen}
				onOpenChange={(o) => {
					if (!o) setConfirmPaymentOpen(false);
				}}
			>
				<DialogContent showCloseButton={false} className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Mark #{order.shortId} as paid?</DialogTitle>
						<DialogDescription>
							This marks the payment as received; the customer sees it on their
							order page and isn't sent a WhatsApp. Make sure you've checked the
							amount in your bank app first — this can't be undone here.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<p className="text-xs font-medium text-muted-foreground">
							How did they pay? <span className="font-normal">(optional)</span>
						</p>
						<div className="flex flex-wrap gap-2">
							{paymentMethodChoices.map((m) => {
								const active = paymentMethodChoice === m;
								return (
									<button
										key={m}
										type="button"
										onClick={() =>
											setPaymentMethodChoice(active ? undefined : m)
										}
										className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
											active
												? "border-accent bg-accent/10 text-foreground"
												: "border-border text-muted-foreground hover:bg-muted"
										}`}
									>
										{PAYMENT_METHOD_LABELS[m]}
									</button>
								);
							})}
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setConfirmPaymentOpen(false)}
						>
							Cancel
						</Button>
						<Button
							isLoading={confirmingPayment}
							disabled={confirmingPayment}
							onClick={handleMarkPaymentReceived}
						>
							Mark payment received
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// Mirror of MOCKUP_WAIVE_GRACE_MS in convex/orders.ts — drives when the
// "proceed without approval" escape becomes available in the UI.
const MOCKUP_WAIVE_GRACE_MS = 48 * 60 * 60 * 1000;
// Mirror of MAX_MOCKUP_IMAGES in convex/orders.ts.
const MAX_MOCKUP_IMAGES = 5;

/**
 * Amber action card for a fee-pending delivery order (86extzdr8): the charge
 * couldn't be resolved automatically on an "arrange" store — radius mode:
 * beyond the bands / no map pin; lalamove mode: no live quote / no map pin;
 * weight mode (86eyeea1n): unserved state / overweight / unweighable cart.
 * The explanation keys on the order's FROZEN `deliveryFeePendingReason` (a
 * Lalamove store must never read "outside your delivery bands"). The seller
 * agrees the charge with the buyer in chat, enters it here (0 = deliver
 * free), and the order's ONE held WhatsApp confirmation goes out with the
 * final total (86eyd63r8) — but only while the push is still `deferred`. A
 * legacy order (no push) already had its single message, so setting the fee
 * there just updates the buyer's order page; the copy branches on that so it
 * never promises a message that won't be sent.
 * The missing_weights copy names the FIX (set parcel weights), not just the
 * state — it's the one reason the seller can make never happen again.
 */
const FEE_PENDING_REASON_COPY: Record<
	NonNullable<Doc<"orders">["deliveryFeePendingReason"]> | "unknown",
	string
> = {
	out_of_range:
		"This address is outside your delivery bands, so no charge was applied yet.",
	no_coords:
		"The buyer's address has no map pin, so no charge could be worked out yet.",
	unquotable:
		"A live Lalamove price couldn't be fetched for this address, so no charge was applied yet.",
	no_state:
		"The order has no delivery address yet, so no zone could be matched for the charge.",
	unserved_state:
		"The buyer's state isn't in any of your delivery zones, so no charge was applied yet.",
	over_bands:
		"This order weighs more than your heaviest weight band, so no charge was applied yet.",
	missing_weights:
		"Some items have no parcel weight set, so the charge couldn't be calculated — add weights in Products to price future orders automatically.",
	custom_item:
		"This order includes a custom item, so its weight isn't known until you've agreed the details.",
	// Orders from before the reason was stored — stay mode-neutral.
	unknown: "No delivery charge could be applied to this order automatically.",
};

function SetDeliveryFeeCard({ order }: { order: Doc<"orders"> }) {
	const setDeliveryFee = useMutation(api.orders.setDeliveryFee);
	const [feeInput, setFeeInput] = useState("");
	const [saving, setSaving] = useState(false);

	const chatUrl = order.customer.waPhone
		? `https://wa.me/${order.customer.waPhone}?text=${encodeURIComponent(
				`Hi${order.customer.name ? ` ${order.customer.name}` : ""}! About the delivery charge for your order ${order.shortId} —`,
			)}`
		: null;

	async function save(fee: number) {
		setSaving(true);
		try {
			await setDeliveryFee({ orderId: order._id, fee });
			toast.success(fee > 0 ? "Delivery charge set" : "Set to free delivery", {
				description: "The buyer sees the new total on their order page.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function handleSet() {
		const rm = parsePriceInput(feeInput.trim().length > 0 ? feeInput : "0");
		if (rm === null || rm < 0) {
			toast.error("Not a valid amount — numbers only, e.g. 15.00");
			return;
		}
		void save(Math.round(rm * 100));
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/50">
			<div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
				<Truck className="size-4" />
				<p className="text-xs font-semibold uppercase tracking-widest">
					Delivery charge to confirm
				</p>
			</div>
			<p className="text-sm text-amber-900/90 dark:text-amber-200/90">
				{FEE_PENDING_REASON_COPY[order.deliveryFeePendingReason ?? "unknown"]}{" "}
				Agree it with the buyer on WhatsApp, then set it here — the new total
				shows on their order page, where their confirmation message already sent
				them. No further WhatsApp goes out. Enter 0 to deliver free.
			</p>
			<div className="flex items-end gap-2">
				<div className="relative flex-1">
					<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
						{currencySymbol(order.currency)}
					</span>
					<input
						type="text"
						inputMode="decimal"
						value={feeInput}
						onChange={(e) => setFeeInput(e.target.value)}
						onBlur={() => setFeeInput(normalizePriceInput(feeInput))}
						placeholder="15.00"
						aria-label="Delivery charge"
						className="h-11 w-full rounded-lg border border-amber-300 bg-background pl-11 pr-3 text-sm dark:border-amber-800"
					/>
				</div>
				<Button
					onClick={handleSet}
					isLoading={saving}
					disabled={saving}
					className="h-11 shrink-0"
				>
					Set charge
				</Button>
			</div>
			{chatUrl ? (
				<Button asChild variant="secondary" className="h-11 w-full">
					<a href={chatUrl} target="_blank" rel="noopener noreferrer">
						<MessageCircle className="size-4" />
						Discuss with buyer on WhatsApp
					</a>
				</Button>
			) : null}
		</section>
	);
}

function MockupCard({ order }: { order: Doc<"orders"> }) {
	const generateUploadUrl = useMutation(api.orders.generateMockupUploadUrl);
	const discardMockupUploads = useMutation(api.orders.discardMockupUploads);
	const submitMockup = useMutation(api.orders.submitMockup);
	const updateMockupQuote = useMutation(api.orders.updateMockupQuote);
	const waiveMockup = useMutation(api.orders.waiveMockup);
	const mockupUrls = useQuery(
		convexQuery(api.orders.getMockupUrls, { shortId: order.shortId }),
	).data;
	const [uploading, setUploading] = useState(false);
	const [waiving, setWaiving] = useState(false);
	const [savingPrice, setSavingPrice] = useState(false);
	// Quote for the custom work (major-unit string as typed). Seeded from the
	// order's current quote so re-sends/edits keep the last value.
	const [priceInput, setPriceInput] = useState(
		order.mockupQuotedAmount != null
			? (order.mockupQuotedAmount / 100).toFixed(2)
			: "",
	);

	const status = order.mockupStatus;
	const waived = order.mockupWaivedAt != null;

	// Parse the typed quote into minor units. Empty = no quote sent (made-to-order
	// items with a fixed storefront price don't need one). Invalid → undefined.
	function parsedQuote(): number | undefined {
		const trimmed = priceInput.trim();
		if (trimmed === "") return undefined;
		if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
		return Math.round(Number.parseFloat(trimmed) * 100);
	}

	async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
		const files = e.target.files;
		if (!files || files.length === 0) return;
		if (files.length > MAX_MOCKUP_IMAGES) {
			toast.error(`Up to ${MAX_MOCKUP_IMAGES} images at a time`);
			e.target.value = "";
			return;
		}
		if (priceInput.trim() !== "" && parsedQuote() === undefined) {
			toast.error("Enter a valid price (e.g. 120 or 120.50) or clear it");
			e.target.value = "";
			return;
		}
		setUploading(true);
		// Hoisted so the catch can clean up blobs already uploaded before a failure.
		const storageIds: string[] = [];
		try {
			// Prepare the whole set first. A mockup the BUYER can't open is the
			// mirror of an unreadable payment proof — they're asked to approve a
			// design that renders as a broken box — so nothing is uploaded until
			// every file has been proven decodable. See lib/image-upload.ts.
			const prepared: { blob: Blob; contentType: string }[] = [];
			for (const file of Array.from(files)) {
				const result = await prepareImageUpload(file);
				if (!result.ok) {
					toast.error(result.message);
					setUploading(false);
					return;
				}
				prepared.push(result);
			}
			// Upload each selected image, then send them together as the mockup set
			// (replacing any previous one). Sequential keeps it simple + ordered.
			for (const item of prepared) {
				const url = await generateUploadUrl({ orderId: order._id });
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": item.contentType },
					body: item.blob,
				});
				if (!res.ok) throw new Error("Upload failed");
				const { storageId } = (await res.json()) as { storageId: string };
				storageIds.push(storageId);
			}
			await submitMockup({
				orderId: order._id,
				storageIds,
				quotedAmount: parsedQuote(),
			});
			toast.success(
				storageIds.length > 1
					? `${storageIds.length} mockups sent to the buyer for approval`
					: "Mockup sent to the buyer for approval",
				{
					description:
						"They'll see it on their order page — no WhatsApp goes out.",
				},
			);
		} catch (err) {
			// If some images uploaded but submit never landed (a mid-loop failure, or
			// submitMockup itself threw), those blobs are unreferenced — delete them
			// so they don't orphan. Best-effort; a cleanup failure is non-fatal.
			if (storageIds.length > 0) {
				void discardMockupUploads({ orderId: order._id, storageIds }).catch(
					() => {},
				);
			}
			toast.error(convexErrorMessage(err));
		} finally {
			setUploading(false);
			e.target.value = "";
		}
	}

	// Update the quote without re-uploading. Uses updateMockupQuote (not
	// submitMockup) so it doesn't re-ping the buyer or reset the 48h waiver clock
	// — the buyer sees the new price live on their tracking page. Only available
	// once a mockup exists.
	async function handleSavePrice() {
		const quote = parsedQuote();
		if (priceInput.trim() !== "" && quote === undefined) {
			toast.error("Enter a valid price (e.g. 120 or 120.50)");
			return;
		}
		if (!order.mockupImageStorageId) return;
		setSavingPrice(true);
		try {
			await updateMockupQuote({ orderId: order._id, quotedAmount: quote });
			toast.success("Price updated — the buyer sees it on their order page");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSavingPrice(false);
		}
	}

	async function handleWaive() {
		setWaiving(true);
		try {
			await waiveMockup({ orderId: order._id });
			toast.success("Proceeding without buyer approval");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setWaiving(false);
		}
	}

	const needsMockup = status === "pending" || status === "changes_requested";
	const canWaive =
		!waived &&
		status !== "approved" &&
		order.mockupSubmittedAt != null &&
		Date.now() - order.mockupSubmittedAt >= MOCKUP_WAIVE_GRACE_MS;
	// When the time-based waiver unlocks: 48h after the mockup was sent.
	const waiveUnlockLabel =
		order.mockupSubmittedAt != null
			? new Date(
					order.mockupSubmittedAt + MOCKUP_WAIVE_GRACE_MS,
				).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
			: "";

	const badge = waived
		? { label: "Proceeding — no approval", cls: "bg-muted text-foreground" }
		: status === "approved"
			? { label: "Approved by buyer", cls: "bg-emerald-50 text-emerald-700" }
			: status === "submitted"
				? { label: "Awaiting buyer", cls: "bg-blue-50 text-blue-700" }
				: { label: "Mockup needed", cls: "bg-amber-50 text-amber-800" };

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Mockup approval
				</p>
				<span
					className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
				>
					{badge.label}
				</span>
			</div>

			{status === "changes_requested" && order.mockupChangeNote ? (
				// MASK_PII: the note is the buyer's own free text.
				<div
					{...MASK_PII}
					className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
				>
					<span className="font-medium">Buyer requested changes:</span>{" "}
					{order.mockupChangeNote}
				</div>
			) : null}

			{mockupUrls && mockupUrls.length > 0 ? (
				<div
					className={mockupUrls.length === 1 ? "" : "grid grid-cols-3 gap-2"}
				>
					{mockupUrls.map((url) => (
						<a
							key={url}
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="block overflow-hidden rounded-xl border border-border bg-white"
						>
							<AppImage
								src={url}
								alt="Current mockup"
								// Order-owned blob — erased on hard delete.
								sensitive
								aspect={
									mockupUrls.length === 1
										? "h-64 w-full"
										: "aspect-square w-full"
								}
								objectFit={mockupUrls.length === 1 ? "contain" : "cover"}
							/>
						</a>
					))}
				</div>
			) : order.mockupImageStorageId ? (
				<div className="rounded-xl border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
					Loading mockup…
				</div>
			) : null}

			{status === "submitted" ? (
				<p className="text-sm text-muted-foreground">
					Sent to the buyer — waiting for them to approve or request changes on
					their order page.
				</p>
			) : null}
			{status === "approved" ? (
				<p className="flex items-center gap-1.5 text-sm text-emerald-700">
					<CheckCircle2 className="size-4" /> Approved — you can pack this
					order.
				</p>
			) : null}
			{waived ? (
				<p className="text-sm text-muted-foreground">
					You chose to proceed without the buyer's approval.
				</p>
			) : null}

			{status !== "approved" ? (
				<div className="flex flex-col gap-1.5">
					<label htmlFor="mockup-quote" className="text-sm font-medium">
						Custom item price{" "}
						<span className="font-normal text-muted-foreground">
							(optional — for quote-on-request items)
						</span>
					</label>
					<div className="flex items-center gap-2">
						<div className="relative flex-1">
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
								{order.currency}
							</span>
							<Input
								id="mockup-quote"
								inputMode="decimal"
								placeholder="120.00"
								value={priceInput}
								onChange={(e) => setPriceInput(e.target.value)}
								className="h-11 pl-12"
							/>
						</div>
						{order.mockupImageStorageId ? (
							<Button
								type="button"
								variant="secondary"
								onClick={handleSavePrice}
								disabled={savingPrice}
								className="h-11 shrink-0"
							>
								{savingPrice ? "…" : "Save price"}
							</Button>
						) : null}
					</div>
					<p className="text-xs text-muted-foreground">
						Sent with the mockup. The buyer approves the design and price
						together; the order total updates automatically.
					</p>
				</div>
			) : null}

			{needsMockup || status === "submitted" ? (
				<div className="flex flex-col gap-1">
					<label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
						<ImagePlus className="size-4" />
						{uploading
							? "Sending…"
							: status === "submitted"
								? "Replace mockup"
								: "Upload & send mockup"}
						<input
							type="file"
							accept={IMAGE_ACCEPT}
							multiple
							disabled={uploading}
							onChange={handleUpload}
							className="hidden"
						/>
					</label>
					<p className="text-center text-xs text-muted-foreground">
						Up to {MAX_MOCKUP_IMAGES} images — e.g. different designs, angles,
						or one per item. Sending replaces the current set. The buyer sees it
						on their order page — no WhatsApp goes out.
					</p>
				</div>
			) : null}

			{canWaive ? (
				<Button
					variant="secondary"
					onClick={handleWaive}
					disabled={waiving}
					className="h-11 w-full"
				>
					{waiving ? "…" : "Proceed without approval"}
				</Button>
			) : status === "submitted" && !waived ? (
				<p className="text-xs text-muted-foreground">
					Waiting on the buyer to approve. If they haven't responded by{" "}
					<span className="font-medium text-foreground">
						{waiveUnlockLabel}
					</span>{" "}
					(48 hours after you sent the mockup), a{" "}
					<span className="font-medium text-foreground">
						“Proceed without approval”
					</span>{" "}
					button appears here — letting you start production without their
					sign-off so the order is never stuck waiting.
				</p>
			) : null}
		</section>
	);
}

function formatPickupInline(snapshot: PickupSnapshot): string {
	const lines = [snapshot.label, snapshot.address];
	const mapsUrl = deriveMapsUrl(snapshot);
	if (mapsUrl) lines.push(mapsUrl);
	if (snapshot.notes) lines.push(snapshot.notes);
	return lines.join("\n");
}

function buildNotifyManagerMessage({
	shortId,
	location,
	customerName,
	customerWaPhone,
	items,
	total,
	currency,
}: {
	shortId: string;
	location: PickupSnapshot;
	customerName: string | undefined;
	customerWaPhone: string | undefined;
	items: ReadonlyArray<{
		name: string;
		quantity: number;
		price: number;
		variantLabel?: string;
	}>;
	total: number;
	currency: string;
}): string {
	const lines: string[] = [];
	lines.push(`📦 New pickup order ${shortId} — ${location.label}`);
	const customerLine = customerName
		? customerWaPhone
			? `Customer: ${customerName} (${formatPhone(customerWaPhone)})`
			: `Customer: ${customerName}`
		: customerWaPhone
			? `Customer: ${formatPhone(customerWaPhone)}`
			: "Customer: Anonymous";
	lines.push(customerLine);
	lines.push("");
	lines.push("Items:");
	for (const item of items) {
		const name = item.variantLabel
			? `${item.name} (${item.variantLabel})`
			: item.name;
		lines.push(
			`• ${item.quantity}× ${name} (${formatPrice(item.price * item.quantity, currency)})`,
		);
	}
	lines.push("");
	lines.push(`Total: ${formatPrice(total, currency)}`);
	lines.push("");
	lines.push("Please prepare for collection.");
	return lines.join("\n");
}

function NotifyManagerCard({
	shortId,
	location,
	pickupLocationId,
	customerName,
	customerWaPhone,
	items,
	total,
	currency,
}: {
	shortId: string;
	location: PickupSnapshot;
	/**
	 * Used to fetch the LIVE pickup location row so the seller's "Notify"
	 * button always routes to the current manager — not whoever happened to
	 * be on the snapshot at order creation. Undefined for legacy orders
	 * placed before the multi-location feature shipped.
	 */
	pickupLocationId: Id<"pickupLocations"> | undefined;
	customerName: string | undefined;
	customerWaPhone: string | undefined;
	items: ReadonlyArray<{
		name: string;
		quantity: number;
		price: number;
		variantLabel?: string;
	}>;
	total: number;
	currency: string;
}) {
	const [copied, setCopied] = useState(false);
	// Fetch live manager contact. Skipped when there's no pickupLocationId on
	// the order (legacy orders), in which case we fall back to the snapshot-
	// only Copy flow.
	const liveLocation = useQuery(
		convexQuery(
			api.pickupLocations.getOwnedById,
			pickupLocationId ? { pickupLocationId } : "skip",
		),
	).data;
	const managerName = liveLocation?.managerName?.trim();
	const managerWaPhone = liveLocation?.managerWaPhone?.trim();
	// Phone is the gate — without it there's no wa.me link to open. Name is
	// purely cosmetic (button label); when absent the button renders with a
	// generic label so the seller still gets the one-tap benefit.
	const hasManagerPhone = Boolean(managerWaPhone && managerWaPhone.length > 0);

	const message = buildNotifyManagerMessage({
		shortId,
		location,
		customerName,
		customerWaPhone,
		items,
		total,
		currency,
	});

	const notifyHref = hasManagerPhone
		? `https://wa.me/${managerWaPhone}?text=${encodeURIComponent(message)}`
		: undefined;
	const notifyLabel = managerName
		? `Notify ${managerName} on WhatsApp`
		: "Notify on WhatsApp";

	function handleCopy() {
		navigator.clipboard
			.writeText(message)
			.then(() => {
				setCopied(true);
				toast.success("Message copied — paste it in your store chat");
				setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => toast.error("Couldn't copy — please copy manually"));
	}

	return (
		// MASK_PII: the composed message renders the buyer's name + phone verbatim.
		<section
			{...MASK_PII}
			className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
		>
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Notify store manager
				</p>
				<button
					type="button"
					onClick={handleCopy}
					className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Copy notify-manager message"
				>
					<Copy className="size-3.5" />
					{copied ? "Copied!" : "Copy"}
				</button>
			</div>
			<pre className="whitespace-pre-wrap wrap-break-words rounded-lg bg-muted/40 px-3 py-2.5 font-sans text-xs leading-relaxed text-foreground">
				{message}
			</pre>
			{notifyHref ? (
				<a
					href={notifyHref}
					target="_blank"
					rel="noopener noreferrer"
					className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
				>
					<MessageCircle className="size-4" />
					{notifyLabel}
				</a>
			) : (
				<p className="text-xs text-muted-foreground">
					Tap copy and forward to whoever runs this pickup spot. You can edit it
					before sending. Add a manager number in{" "}
					<Link
						to="/app/settings"
						search={{ tab: "fulfilment" }}
						className="font-medium text-accent underline-offset-2 hover:underline"
					>
						Settings → Fulfilment
					</Link>{" "}
					for a one-tap button here.
				</p>
			)}
		</section>
	);
}
