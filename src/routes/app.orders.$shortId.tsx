import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	ArrowLeft,
	ArrowRight,
	BadgeCheck,
	Ban,
	Bell,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Copy,
	ExternalLink,
	HandCoins,
	Hourglass,
	ImagePlus,
	MapPin,
	MessageCircle,
	Package,
	Phone,
	StickyNote,
	Trash2,
	Truck,
	User,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { isMockupGateClosed } from "../../convex/lib/order";
import {
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
	paymentMethodLabel,
} from "../../convex/lib/paymentMethod";
import {
	type ManualReminderBlock,
	manualReminderEligibility,
} from "../../convex/lib/paymentReminder";
import type { PickupSnapshot } from "../../convex/lib/whatsappCopy";
import { FulfilmentDateBadge } from "../components/dashboard/fulfilment-date-badge";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { StatusBadge } from "../components/dashboard/status-badge";
import { ReceiptDownloadButton } from "../components/order/receipt-download-button";
import {
	DeliveryAddressDisplay,
	formatAddressInline,
} from "../components/storefront/delivery-address-display";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
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
import { formatPhone, orderCustomerLabel } from "../lib/customer";
import {
	convexErrorMessage,
	formatPrice,
	formatPriceCompact,
	normalizePriceInput,
	parsePriceInput,
} from "../lib/format";
import { deriveMapsUrl } from "../lib/google-address";
import {
	anchorOrdinal,
	displayStatusLabel,
	resolveCurrentStage,
	resolveStages,
	resolveStatusLabel,
	stageLabel,
} from "../lib/orderStatus";
import { suppressNextOrderConfirmedToast } from "../lib/orderToastSuppression";

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

type DeliveryMethod = "delivery" | "self_collect";

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

/** Human "in ~2h" / "in ~15m" for the manual-reminder cooldown countdown. */
function formatUntil(epochMs: number): string {
	const diff = epochMs - Date.now();
	if (diff <= 0) return "shortly";
	const minutes = Math.ceil(diff / 60_000);
	if (minutes < 60) return `in ~${minutes}m`;
	return `in ~${Math.ceil(minutes / 60)}h`;
}

/** Seller-facing reason a manual payment reminder couldn't be sent — used for
 * the error toast when the server rejects a send the button thought was OK. */
function manualReminderBlockMessage(
	reason: ManualReminderBlock | "not_found",
): string {
	switch (reason) {
		case "cancelled":
			return "This order was cancelled — nothing to remind about.";
		case "pending":
			return "This order hasn't been confirmed yet.";
		case "paid":
			return "This order is already paid.";
		case "claimed":
			return "The buyer already tapped “I've paid” — check for their payment.";
		case "mockup_gated":
			return "The buyer hasn't been asked to pay yet (mockup pending).";
		case "fee_pending":
			return "Set the delivery charge first — the total isn't final yet.";
		case "no_contact":
			return "No WhatsApp number on file for this buyer.";
		case "cooldown":
			return "You just reminded this buyer — try again a little later.";
		default:
			return "Couldn't send the reminder. Try again.";
	}
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
	const order = useQuery(api.orders.get, { shortId });
	const updateStatus = useMutation(api.orders.updateStatus);
	const advanceToStage = useMutation(api.orders.advanceToStage);
	const setCarrierUrl = useMutation(api.orders.setCarrierTrackingUrl);
	const markPaymentReceived = useMutation(api.orders.markPaymentReceived);
	const sendPaymentReminder = useAction(api.orders.sendPaymentReminder);
	const deleteOrder = useMutation(api.orders.deleteOrder);
	// Permanent hard delete is admin-only (Kedaipal support); a plain seller only
	// ever cancels. Hide the danger action unless this is an admin act-as session —
	// the server enforces the same rule, so this is discoverability, not the guard.
	const retailer = useDashboardRetailer();
	const canHardDelete = retailer?.actingAsAdmin === true;
	const proofUrl = useQuery(
		api.orders.getPaymentProofUrl,
		order?.paymentProofStorageId ? { orderId: order._id } : "skip",
	);
	const customerImageUrl = useQuery(
		api.orders.getCustomerImageUrl,
		order?.customerImageStorageId ? { shortId } : "skip",
	);
	// CRM context for the customer card ("8 orders · RM 1,240") — answers "who is
	// this?" without leaving the order.
	const crmCustomer = useQuery(
		api.customers.get,
		order?.customerId ? { customerId: order.customerId } : "skip",
	);
	// Holds the id of the in-flight advance target ("cancel" for cancellation).
	const [pending, setPending] = useState<string | null>(null);
	const [carrierInput, setCarrierInput] = useState<string | null>(null);
	const [savingCarrier, setSavingCarrier] = useState(false);
	const [confirmingPayment, setConfirmingPayment] = useState(false);
	const [sendingReminder, setSendingReminder] = useState(false);
	const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);
	const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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
	const editingCarrier = carrierInput !== null;
	const paymentStatus = (order.paymentStatus ?? "unpaid") as PaymentStatus;
	// Production (any packed-or-later stage) is blocked while a mockup is required
	// but not yet approved/waived. Shared gate — same source as the server.
	const mockupGated = isMockupGateClosed(order);
	// Delivery charge still to be confirmed (out-of-range "arrange" order, or
	// address without coordinates) — holds the buyer's payment ask + the seller's
	// mark-received until the seller sets it below. See orders.setDeliveryFee.
	const deliveryFeePending =
		order.deliveryFeePending === true && order.status !== "cancelled";
	// Manual "Send payment reminder" eligibility — the SAME predicate the server
	// enforces (single source of truth), so the button's disabled-with-reason
	// state can't disagree with what a tap would actually do. Recomputed each
	// render; the order refetches after a send, so the 6h cooldown kicks in live.
	const reminderEligibility = manualReminderEligibility(
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

	async function handleAdvance(stageId: string) {
		if (!order) return;
		setPending(stageId);
		try {
			await advanceToStage({ orderId: order._id, stageId });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPending(null);
		}
	}

	async function handleCancel() {
		if (!order) return;
		setPending("cancel");
		try {
			await updateStatus({ orderId: order._id, status: "cancelled" });
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

	async function handleSaveCarrier() {
		if (!order || carrierInput === null) return;
		setSavingCarrier(true);
		try {
			await setCarrierUrl({
				orderId: order._id,
				carrierTrackingUrl: carrierInput || undefined,
			});
			setCarrierInput(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSavingCarrier(false);
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
			toast.success("Payment confirmed — customer notified on WhatsApp");
			setConfirmPaymentOpen(false);
			setPaymentMethodChoice(undefined);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setConfirmingPayment(false);
		}
	}

	async function handleSendReminder() {
		if (!order) return;
		setSendingReminder(true);
		try {
			const res = await sendPaymentReminder({ shortId });
			if (res.ok) {
				const who = order.customer.name ?? "The buyer";
				toast.success("Payment reminder sent", {
					description: `${who} will receive it on WhatsApp.`,
				});
			} else {
				// The server re-checks state (the buyer may have paid in another tab,
				// or the cooldown boundary differs) — surface why nothing was sent.
				toast.error(manualReminderBlockMessage(res.reason ?? "not_found"));
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSendingReminder(false);
		}
	}

	function buildAskForProofWaUrl(): string | null {
		if (!order?.customer.waPhone) return null;
		const text = `Hi! Could you re-share the payment screenshot for ${order.shortId}? — ${order.customer.name ? `Thanks ${order.customer.name}!` : "Thanks!"}`;
		return `https://wa.me/${order.customer.waPhone}?text=${encodeURIComponent(text)}`;
	}

	const askForProofUrl = buildAskForProofWaUrl();

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
					<ReceiptDownloadButton
						shortId={order.shortId}
						label="Download receipt"
					/>
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
					</p>
				</div>
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
							// First move out of pending into a confirmed-anchored stage
							// keeps the familiar "Confirm Order" verb; everything else
							// reads "Mark as {stage}".
							const advanceLabel =
								order.status === "pending" && nextStage.anchor === "confirmed"
									? "Confirm Order"
									: `Mark as ${stageLabel(nextStage, "en")}`;
							return (
								<button
									type="button"
									onClick={() => handleAdvance(nextStage.id)}
									disabled={pending !== null || blocked}
									className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-[15px] font-bold text-background transition-opacity hover:opacity-95 disabled:opacity-55"
								>
									{pending === nextStage.id ? (
										"Updating…"
									) : blocked ? (
										`${advanceLabel} — awaiting mockup`
									) : (
										<>
											{advanceLabel}
											<ArrowRight className="size-4.5" />
										</>
									)}
								</button>
							);
						})()
					) : order.status === "delivered" ? (
						<p className="text-sm font-medium text-accent-emphasis">
							Completed — nothing left to do 🎉
						</p>
					) : undefined
				}
			/>

			{/* Shopper's note + optional custom-line reference photo — front-and-centre
			    so it isn't missed when fulfilling. Plain text, escaped by React. */}
			{order.customerNote || order.customerImageStorageId ? (
				<section className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
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
								<img
									src={proofUrl}
									alt="Payment receipt"
									className="block max-h-64 w-full object-contain"
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
					{/* Manual reminder — re-send the payment details on demand. Hidden
					    while payment isn't owed yet (mockup-gated or delivery charge
					    pending). Also recovers the case where the buyer never got the
					    first bot reply. */}
					{!mockupGated && !deliveryFeePending ? (
						<div className="flex flex-col gap-1.5 border-t border-border pt-3">
							<Button
								onClick={handleSendReminder}
								isLoading={sendingReminder}
								disabled={sendingReminder || !reminderEligibility.ok}
								variant="ghost"
								className="h-11 w-full"
							>
								<Bell className="size-4" />
								Send payment reminder
							</Button>
							<p className="text-xs text-muted-foreground">
								{!reminderEligibility.ok
									? reminderEligibility.reason === "no_contact"
										? "No WhatsApp number on file for this buyer yet."
										: reminderEligibility.reason === "cooldown"
											? `Reminded ${formatRelative(order.lastManualReminderAt)} — you can remind again ${formatUntil(
													reminderEligibility.retryAt ?? Date.now(),
												)}.`
											: "A reminder isn't available for this order right now."
									: order.lastManualReminderAt
										? `Last reminded ${formatRelative(
												order.lastManualReminderAt,
											)}. Re-sends the payment details to their WhatsApp.`
										: `Re-sends the payment details — amount, how to pay, and an "I've paid" button — to their WhatsApp. Handy if they never got the first reply. May not reach buyers you haven't messaged in 24h.`}
							</p>
						</div>
					) : null}
				</section>
			) : null}

			{/* Received → read-only confirmation. */}
			{paymentStatus === "received" ? (
				<section className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
					<BadgeCheck className="size-5 text-emerald-700" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
							Payment received
						</p>
						<p className="text-sm text-emerald-900">
							{order.paymentReceivedAt
								? `Confirmed ${formatRelative(order.paymentReceivedAt)}`
								: "Confirmed by you"}
							{order.paymentMethod
								? ` · ${paymentMethodLabel(order.paymentMethod)}`
								: ""}
						</p>
					</div>
				</section>
			) : null}

			{/* Customer — CRM context inline (order count, lifetime spend) with
			    WhatsApp as the hero contact action. The avatar row deep-links to
			    the full profile when one exists. */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
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
							<ChevronRight className="size-4.5 shrink-0 text-muted-foreground/60" />
						</Link>
					) : (
						<div className="flex items-center gap-3">{avatarRow}</div>
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

			{/* Delivery method */}
			<section className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
					{isSelfCollect ? (
						<Package className="size-4 text-muted-foreground" />
					) : (
						<Truck className="size-4 text-muted-foreground" />
					)}
				</div>
				<div className="flex flex-col gap-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Fulfillment
					</p>
					<p className="text-sm font-medium">
						{isSelfCollect
							? order.pickupSnapshot?.locationType === "drop_off"
								? "Drop-off"
								: "Self Collect"
							: "Delivery"}
					</p>
					{order.fulfilmentDate !== undefined && order.source !== "counter" ? (
						<div className="flex items-center gap-1.5">
							<span className="text-xs text-muted-foreground">
								{isSelfCollect
									? order.pickupSnapshot?.locationType === "drop_off"
										? "Meet on"
										: "Collect on"
									: "Deliver on"}
							</span>
							<FulfilmentDateBadge
								epoch={order.fulfilmentDate}
								size="md"
								muted={isTerminal}
							/>
						</div>
					) : null}
				</div>
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
				    distance / manual) so the number is auditable at a glance. */}
				{order.deliveryFee && order.deliveryFee > 0 ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>
							Delivery fee
							{order.deliverySnapshot?.mode === "radius" &&
							order.deliverySnapshot.distanceKm !== undefined
								? ` — ${order.deliverySnapshot.distanceKm} km`
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

			{/* Delivery address (delivery orders only) */}
			{!isSelfCollect && order.deliveryAddress ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Delivery Address
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

			{/* Carrier tracking */}
			{showCarrierSection ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Carrier Tracking
						</p>
						{!editingCarrier ? (
							<button
								type="button"
								onClick={() => setCarrierInput(order.carrierTrackingUrl ?? "")}
								className="text-xs text-accent hover:underline"
							>
								{order.carrierTrackingUrl ? "Edit" : "Add link"}
							</button>
						) : null}
					</div>

					{editingCarrier ? (
						<div className="flex flex-col gap-2">
							<Input
								autoFocus
								type="url"
								value={carrierInput}
								onChange={(e) => setCarrierInput(e.target.value)}
								placeholder="https://www.spx.my/track?..."
								className="h-10 w-full rounded-lg border-border px-3 text-sm"
							/>
							<p className="text-xs text-muted-foreground">
								SPX, Lalamove, NinjaVan, J&amp;T, etc. Sent to the customer via
								WhatsApp.
							</p>
							<div className="flex gap-2">
								<Button
									onClick={handleSaveCarrier}
									disabled={savingCarrier}
									className="h-9 flex-1 text-sm"
								>
									{savingCarrier ? "Saving…" : "Save"}
								</Button>
								<Button
									variant="secondary"
									onClick={() => setCarrierInput(null)}
									disabled={savingCarrier}
									className="h-9 text-sm"
								>
									Cancel
								</Button>
							</div>
						</div>
					) : order.carrierTrackingUrl ? (
						<a
							href={order.carrierTrackingUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-accent underline underline-offset-2"
						>
							<Truck className="size-4 shrink-0" />
							<span className="truncate">{order.carrierTrackingUrl}</span>
							<ExternalLink className="size-3 shrink-0" />
						</a>
					) : (
						<p className="text-sm text-muted-foreground">
							No tracking link added yet.
						</p>
					)}
				</section>
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
						{/* Receipt on mobile (desktop has it in the PageHeader actions). */}
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
						{/* Permanent hard delete — admin act-as only (Kedaipal support).
						    Hidden for a plain seller, who cancels instead; the server
						    enforces the same rule. Works in any status; irreversible. */}
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
									Deleting removes this order and its records for good — this
									can't be undone.
								</p>
							</>
						) : null}
					</>
				) : null}
			</section>

			<ConfirmDialog
				open={confirmCancelOpen}
				onOpenChange={setConfirmCancelOpen}
				title={`Cancel order #${order.shortId}?`}
				description="The customer is notified over WhatsApp, stock is restored, and this can't be undone."
				confirmLabel="Cancel order"
				cancelLabel="Keep order"
				destructive
				onConfirm={handleCancel}
			/>

			<ConfirmDialog
				open={confirmDeleteOpen}
				onOpenChange={setConfirmDeleteOpen}
				title={`Delete order #${order.shortId} permanently?`}
				description={
					paymentStatus === "received" || order.status === "delivered"
						? "This order is paid/completed — deleting erases it from your sales records, receipts and CSV exports. Stock isn't affected and the customer is NOT notified. This can't be undone."
						: `This erases the order, its timeline and any uploaded images for good.${
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
							This confirms payment was received and notifies the customer on
							WhatsApp. Make sure you've checked the amount in your bank app
							first — this can't be undone here.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<p className="text-xs font-medium text-muted-foreground">
							How did they pay? <span className="font-normal">(optional)</span>
						</p>
						<div className="flex flex-wrap gap-2">
							{ORDER_PAYMENT_METHODS.map((m) => {
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
 * Amber action card for a fee-pending delivery order (86extzdr8): the buyer's
 * address fell outside the seller's distance bands (or had no coordinates) on
 * an "arrange via WhatsApp" store. The seller agrees the charge with the buyer
 * in chat, enters it here (0 = deliver free), and the held payment ask goes
 * out on WhatsApp with the final total.
 */
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
			toast.success(
				fee > 0
					? "Delivery charge set — the buyer gets the payment request on WhatsApp."
					: "Set to free delivery — the buyer gets the payment request on WhatsApp.",
			);
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
				This address is outside your delivery bands, so no charge was applied
				yet. Agree it with the buyer on WhatsApp, then set it here — the payment
				request goes out with the final total. Enter 0 to deliver free.
			</p>
			<div className="flex items-end gap-2">
				<div className="relative flex-1">
					<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
						RM
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
	const mockupUrls = useQuery(api.orders.getMockupUrls, {
		shortId: order.shortId,
	});
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
			// Upload each selected image, then send them together as the mockup set
			// (replacing any previous one). Sequential keeps it simple + ordered.
			for (const file of Array.from(files)) {
				const url = await generateUploadUrl({ orderId: order._id });
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": file.type },
					body: file,
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
				<div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
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
							<img
								src={url}
								alt="Current mockup"
								className={
									mockupUrls.length === 1
										? "block max-h-64 w-full object-contain"
										: "block aspect-square w-full object-cover"
								}
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
							accept="image/*"
							multiple
							disabled={uploading}
							onChange={handleUpload}
							className="hidden"
						/>
					</label>
					<p className="text-center text-xs text-muted-foreground">
						Up to {MAX_MOCKUP_IMAGES} images — e.g. different designs, angles,
						or one per item. Sending replaces the current set.
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
		api.pickupLocations.getOwnedById,
		pickupLocationId ? { pickupLocationId } : "skip",
	);
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
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
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
