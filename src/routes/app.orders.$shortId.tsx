import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	BadgeCheck,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Copy,
	ExternalLink,
	HandCoins,
	Hourglass,
	ImagePlus,
	MapPin,
	MessageCircle,
	Package,
	StickyNote,
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
import type { PickupSnapshot } from "../../convex/lib/whatsappCopy";
import { FulfilmentDateBadge } from "../components/dashboard/fulfilment-date-badge";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
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
import { formatPhone } from "../lib/customer";
import { convexErrorMessage, formatPrice } from "../lib/format";
import { deriveMapsUrl } from "../lib/google-address";
import {
	anchorOrdinal,
	resolveCurrentStage,
	resolveStages,
	resolveStatusLabel,
	stageLabel,
} from "../lib/orderStatus";
import { suppressNextOrderConfirmedToast } from "../lib/orderToastSuppression";
import { StatusBadge } from "./app.orders.index";

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

function paymentBadge(status: PaymentStatus): {
	label: string;
	icon: ReactNode;
	className: string;
} {
	switch (status) {
		case "received":
			return {
				label: "Paid",
				icon: <BadgeCheck className="size-3.5" />,
				className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
			};
		case "claimed":
			return {
				label: "Payment claimed",
				icon: <Hourglass className="size-3.5" />,
				className: "bg-blue-50 text-blue-700 ring-blue-200",
			};
		default:
			return {
				label: "Unpaid",
				icon: <HandCoins className="size-3.5" />,
				className: "bg-amber-50 text-amber-800 ring-amber-200",
			};
	}
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

function OrderProgressTimeline({
	stages,
	currentIndex,
	cancelled,
}: {
	stages: ReturnType<typeof resolveStages>;
	currentIndex: number;
	cancelled: boolean;
}) {
	return (
		<section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Order progress
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{cancelled
							? "This order was cancelled."
							: currentIndex < 0
								? "Waiting for seller confirmation."
								: `${currentIndex + 1} of ${stages.length} steps completed or active.`}
					</p>
				</div>
			</div>
			<ol className="mt-4 grid gap-2 sm:grid-cols-4">
				{stages.map((stage, index) => {
					const active = !cancelled && index === currentIndex;
					const done = !cancelled && currentIndex >= 0 && index < currentIndex;
					return (
						<li
							key={stage.id}
							className={`rounded-xl border px-3 py-2 ${
								active
									? "border-accent bg-accent/10 text-foreground"
									: done
										? "border-emerald-200 bg-emerald-50 text-emerald-800"
										: "border-border bg-background text-muted-foreground"
							}`}
						>
							<div className="flex items-center gap-2">
								<span
									className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
										active
											? "bg-accent text-accent-foreground"
											: done
												? "bg-emerald-600 text-white"
												: "bg-muted text-muted-foreground"
									}`}
								>
									{done ? <CheckCircle2 className="size-3.5" /> : index + 1}
								</span>
								<span className="min-w-0 truncate text-xs font-semibold">
									{stageLabel(stage, "en")}
								</span>
							</div>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

function OrderDetailRoute() {
	const { shortId } = Route.useParams();
	const order = useQuery(api.orders.get, { shortId });
	const updateStatus = useMutation(api.orders.updateStatus);
	const advanceToStage = useMutation(api.orders.advanceToStage);
	const setCarrierUrl = useMutation(api.orders.setCarrierTrackingUrl);
	const markPaymentReceived = useMutation(api.orders.markPaymentReceived);
	const proofUrl = useQuery(
		api.orders.getPaymentProofUrl,
		order?.paymentProofStorageId ? { orderId: order._id } : "skip",
	);
	const customerImageUrl = useQuery(
		api.orders.getCustomerImageUrl,
		order?.customerImageStorageId ? { shortId } : "skip",
	);
	// Holds the id of the in-flight advance target ("cancel" for cancellation).
	const [pending, setPending] = useState<string | null>(null);
	const [carrierInput, setCarrierInput] = useState<string | null>(null);
	const [savingCarrier, setSavingCarrier] = useState(false);
	const [confirmingPayment, setConfirmingPayment] = useState(false);
	const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);
	const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
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
	const showCarrierSection =
		!isSelfCollect && !["pending", "cancelled"].includes(order.status);
	const editingCarrier = carrierInput !== null;
	const paymentStatus = (order.paymentStatus ?? "unpaid") as PaymentStatus;
	const paymentBadgeCfg = paymentBadge(paymentStatus);
	// Production (any packed-or-later stage) is blocked while a mockup is required
	// but not yet approved/waived. Shared gate — same source as the server.
	const mockupGated = isMockupGateClosed(order);

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
			/>
			{/* Back nav (mobile only) */}
			<Link
				to="/app/orders"
				className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
			>
				<ChevronLeft className="size-4" />
				Orders
			</Link>

			{/* Order header */}
			<div className="flex items-start justify-between gap-3">
				<div className="lg:hidden">
					<h2 className="font-mono text-2xl font-bold tracking-tight">
						#{order.shortId}
					</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{new Date(order._creationTime).toLocaleString(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
					</p>
				</div>
				<div className="flex flex-col items-start gap-1.5">
					<StatusBadge
						status={order.status}
						label={
							currentStage
								? stageLabel(currentStage, "en")
								: resolveStatusLabel(order.status, statusLabelOpts)
						}
					/>
					<span
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${paymentBadgeCfg.className}`}
					>
						{paymentBadgeCfg.icon}
						{paymentBadgeCfg.label}
					</span>
				</div>
			</div>

			<OrderProgressTimeline
				stages={stages}
				currentIndex={currentIdx}
				cancelled={order.status === "cancelled"}
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

			{/* Payment claim — actionable when shopper has tapped "I've paid". */}
			{paymentStatus === "claimed" ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
					<div className="flex items-center gap-2 text-blue-800">
						<Hourglass className="size-4" />
						<p className="text-xs font-semibold uppercase tracking-widest">
							Payment claim
						</p>
					</div>

					<div className="flex flex-col gap-2 rounded-xl bg-white/70 p-3">
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
								Amount expected
							</span>
							<span className="font-mono text-lg font-bold tabular-nums text-foreground">
								{formatPrice(order.total, order.currency)}
							</span>
						</div>
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
								className="block overflow-hidden rounded-xl border border-blue-200 bg-white"
							>
								<img
									src={proofUrl}
									alt="Payment receipt"
									className="block max-h-64 w-full object-contain"
								/>
							</a>
						) : (
							<div className="flex items-center justify-center rounded-xl border border-blue-200 bg-white p-4 text-xs text-muted-foreground">
								Loading screenshot…
							</div>
						)
					) : (
						<p className="text-sm text-blue-900/80">
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
							: `The customer hasn't tapped "I've paid" yet. If you've already seen the money in your bank app, mark it received here.`}
					</p>
					{/* While the mockup gate is closed the buyer hasn't been asked to pay
					    and the price may not be final, so the seller can't mark payment
					    received yet. Opens on approve / waive / removing the custom item. */}
					<Button
						onClick={() => setConfirmPaymentOpen(true)}
						isLoading={confirmingPayment}
						disabled={confirmingPayment || mockupGated}
						variant="secondary"
						className="h-11 w-full"
					>
						<BadgeCheck className="size-4" />
						{mockupGated ? "Awaiting mockup approval" : "Mark payment received"}
					</Button>
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

			{/* Customer — WhatsApp-branded card. Buyer with a waPhone gets the
			    chat-app treatment (green avatar, prominent "Open chat" CTA) so
			    the seller never misses the action. Anonymous buyers (no phone
			    captured) fall back to a neutral row with just the name. */}
			<section
				className={
					order.customer.waPhone
						? "flex flex-col gap-3 rounded-2xl border border-green-600/30 bg-linear-to-br from-green-500/5 to-green-500/10 p-4"
						: "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
				}
			>
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Customer
				</p>
				<div className="flex items-center gap-3">
					{order.customer.waPhone ? (
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
							<MessageCircle className="size-5" />
						</div>
					) : (
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
							<User className="size-5 text-muted-foreground" />
						</div>
					)}
					<div className="min-w-0 flex-1">
						<p className="font-semibold">
							{order.customer.name ?? "Anonymous"}
						</p>
						{order.customer.waPhone ? (
							<p className="font-mono text-xs text-muted-foreground">
								{formatPhone(order.customer.waPhone)} · via WhatsApp
							</p>
						) : null}
					</div>
				</div>
				{order.customer.waPhone ? (
					<a
						href={`https://wa.me/${order.customer.waPhone}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex h-11 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700"
					>
						<MessageCircle className="size-4" />
						Open chat in WhatsApp
					</a>
				) : null}
				{order.customerId ? (
					// View profile sits inside the same section so the two
					// related actions read as one customer block. Uses a card
					// background (vs the section's green tint) so it visually
					// separates from the WhatsApp action above without
					// breaking the cohesion.
					<Link
						to="/app/customers/$customerId"
						params={{ customerId: order.customerId }}
						className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						<span className="flex items-center gap-2">
							<User className="size-4 text-muted-foreground" />
							View customer profile
						</span>
						<ChevronRight className="size-4 text-muted-foreground" />
					</Link>
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
						{isSelfCollect ? "Self Collect" : "Delivery"}
					</p>
					{order.fulfilmentDate !== undefined ? (
						<div className="flex items-center gap-1.5">
							<span className="text-xs text-muted-foreground">
								{isSelfCollect ? "Collect on" : "Deliver on"}
							</span>
							<FulfilmentDateBadge epoch={order.fulfilmentDate} size="md" />
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
				<div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-bold">
					<span>Total</span>
					<span className="tabular-nums">
						{formatPrice(order.total, order.currency)}
					</span>
				</div>
			</section>

			{/* Pickup location (self-collect orders only) — reads frozen snapshot
			    so a later retailer edit never rewrites historical order info. */}
			{isSelfCollect && order.pickupSnapshot ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Pick up at
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

			{/* Stage actions — advance through the seller's stage list one step at a
			    time (synthesized defaults when unconfigured). Cancel stays available
			    until the order is terminal. */}
			{!isTerminal ? (
				<section className="flex flex-col gap-3">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Update Status
					</p>
					<div className="flex flex-col gap-2">
						{nextStage
							? (() => {
									// Advancing into production (packed or later) is blocked
									// while the mockup gate is closed — mirrors the server.
									const blocked =
										anchorOrdinal(nextStage.anchor) >=
											anchorOrdinal("packed") && mockupGated;
									// First move out of pending into a confirmed-anchored stage
									// keeps the familiar "Confirm Order" verb; everything else
									// reads "Mark as {stage}".
									const advanceLabel =
										order.status === "pending" &&
										nextStage.anchor === "confirmed"
											? "Confirm Order"
											: `Mark as ${stageLabel(nextStage, "en")}`;
									return (
										<Button
											onClick={() => handleAdvance(nextStage.id)}
											disabled={pending !== null || blocked}
											className="h-11 w-full"
										>
											{pending === nextStage.id
												? "Updating…"
												: blocked
													? `${advanceLabel} — awaiting mockup`
													: advanceLabel}
										</Button>
									);
								})()
							: null}
						<Button
							onClick={() => setConfirmCancelOpen(true)}
							disabled={pending !== null}
							variant="secondary"
							className="h-11 w-full"
						>
							{pending === "cancel" ? "Updating…" : "Cancel Order"}
						</Button>
					</div>
				</section>
			) : null}

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
