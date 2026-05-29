import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	BadgeCheck,
	ChevronLeft,
	ChevronRight,
	Copy,
	ExternalLink,
	HandCoins,
	Hourglass,
	MapPin,
	MessageCircle,
	Package,
	Truck,
	User,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import {
	DeliveryAddressDisplay,
	formatAddressInline,
} from "../components/storefront/delivery-address-display";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import type { PickupSnapshot } from "../../convex/lib/whatsappCopy";
import { formatPhone } from "../lib/customer";
import { convexErrorMessage, formatPrice } from "../lib/format";
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

type Transition =
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";
type DeliveryMethod = "delivery" | "self_collect";

const NEXT_STATUS: Record<string, Transition[]> = {
	pending: ["confirmed", "cancelled"],
	confirmed: ["packed", "cancelled"],
	packed: ["shipped", "cancelled"],
	shipped: ["delivered"],
	delivered: [],
	cancelled: [],
};

const DELIVERY_TRANSITION_LABELS: Record<Transition, string> = {
	confirmed: "Confirm Order",
	packed: "Mark as Packed",
	shipped: "Mark as Shipped",
	delivered: "Mark as Delivered",
	cancelled: "Cancel Order",
};

const SELF_COLLECT_TRANSITION_LABELS: Record<Transition, string> = {
	confirmed: "Confirm Order",
	packed: "Mark as Packed",
	shipped: "Ready for Pickup",
	delivered: "Mark as Collected",
	cancelled: "Cancel Order",
};

function getTransitionLabels(
	method: DeliveryMethod,
): Record<Transition, string> {
	return method === "self_collect"
		? SELF_COLLECT_TRANSITION_LABELS
		: DELIVERY_TRANSITION_LABELS;
}

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

function OrderDetailRoute() {
	const { shortId } = Route.useParams();
	const order = useQuery(api.orders.get, { shortId });
	const updateStatus = useMutation(api.orders.updateStatus);
	const setCarrierUrl = useMutation(api.orders.setCarrierTrackingUrl);
	const markPaymentReceived = useMutation(api.orders.markPaymentReceived);
	const proofUrl = useQuery(
		api.orders.getPaymentProofUrl,
		order?.paymentProofStorageId ? { orderId: order._id } : "skip",
	);
	const [pending, setPending] = useState<Transition | null>(null);
	const [carrierInput, setCarrierInput] = useState<string | null>(null);
	const [savingCarrier, setSavingCarrier] = useState(false);
	const [confirmingPayment, setConfirmingPayment] = useState(false);

	if (order === undefined) {
		return <OrderDetailSkeleton />;
	}
	if (order === null) {
		return <p className="text-sm text-destructive">Order not found.</p>;
	}

	const deliveryMethod = (order.deliveryMethod ?? "delivery") as DeliveryMethod;
	const isSelfCollect = deliveryMethod === "self_collect";
	const transitionLabels = getTransitionLabels(deliveryMethod);
	const transitions = NEXT_STATUS[order.status] ?? [];
	const showCarrierSection =
		!isSelfCollect && !["pending", "cancelled"].includes(order.status);
	const editingCarrier = carrierInput !== null;
	const paymentStatus = (order.paymentStatus ?? "unpaid") as PaymentStatus;
	const paymentBadgeCfg = paymentBadge(paymentStatus);

	async function handleTransition(next: Transition) {
		if (!order) return;
		setPending(next);
		try {
			await updateStatus({ orderId: order._id, status: next });
		} catch (err) {
			toast.error(convexErrorMessage(err));
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
			await markPaymentReceived({ orderId: order._id });
			toast.success("Payment confirmed — customer notified on WhatsApp");
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
				<div className="flex flex-col items-end gap-1.5">
					<StatusBadge status={order.status} />
					<span
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${paymentBadgeCfg.className}`}
					>
						{paymentBadgeCfg.icon}
						{paymentBadgeCfg.label}
					</span>
				</div>
			</div>

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
								rel="noreferrer"
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
							onClick={handleMarkPaymentReceived}
							isLoading={confirmingPayment}
							disabled={confirmingPayment}
							className="h-11 w-full"
						>
							Mark payment received
						</Button>
						{askForProofUrl ? (
							<Button asChild variant="secondary" className="h-11 w-full">
								<a href={askForProofUrl} target="_blank" rel="noreferrer">
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
						The customer hasn't tapped "I've paid" yet. If you've already seen
						the money in your bank app, mark it received here.
					</p>
					<Button
						onClick={handleMarkPaymentReceived}
						isLoading={confirmingPayment}
						disabled={confirmingPayment}
						variant="secondary"
						className="h-11 w-full"
					>
						<BadgeCheck className="size-4" />
						Mark payment received
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
						</p>
					</div>
				</section>
			) : null}

			{/* Customer */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Customer
				</p>
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
						<User className="size-4 text-muted-foreground" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="font-medium">{order.customer.name ?? "Anonymous"}</p>
						{order.customer.waPhone ? (
							<p className="font-mono text-xs text-muted-foreground">
								{order.customer.waPhone}
							</p>
						) : null}
					</div>
					{order.customer.waPhone ? (
						<a
							href={`https://wa.me/${order.customer.waPhone}`}
							target="_blank"
							rel="noreferrer"
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-600 transition-colors hover:bg-green-500/20"
							aria-label="Message on WhatsApp"
						>
							<MessageCircle className="size-4" />
						</a>
					) : null}
				</div>
				{order.customerId ? (
					<Link
						to="/app/customers/$customerId"
						params={{ customerId: order.customerId }}
						className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
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
				<div>
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Fulfillment
					</p>
					<p className="text-sm font-medium">
						{isSelfCollect ? "Self Collect" : "Delivery"}
					</p>
				</div>
			</section>

			{/* Items */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Items
				</p>
				<ul className="flex flex-col divide-y divide-border">
					{order.items.map((item) => (
						<li
							key={item.productId}
							className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{item.name}</p>
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
							{order.pickupSnapshot.mapsUrl ? (
								<a
									href={order.pickupSnapshot.mapsUrl}
									target="_blank"
									rel="noreferrer"
									className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-accent hover:bg-accent/10"
									aria-label="Open in Maps"
								>
									<MapPin className="size-3.5" />
									Maps
								</a>
							) : null}
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
									order.deliveryAddress.mapsUrl ??
									`https://maps.google.com/?q=${encodeURIComponent(
										formatAddressInline(order.deliveryAddress),
									)}`
								}
								target="_blank"
								rel="noreferrer"
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
							<input
								// biome-ignore lint/a11y/noAutofocus: intentional UX — input appears on user action
								autoFocus
								type="url"
								value={carrierInput}
								onChange={(e) => setCarrierInput(e.target.value)}
								placeholder="https://www.spx.my/track?..."
								className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
							rel="noreferrer"
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

			{/* Status actions */}
			{transitions.length > 0 ? (
				<section className="flex flex-col gap-3">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Update Status
					</p>
					<div className="flex flex-col gap-2">
						{transitions.map((t) => (
							<Button
								key={t}
								onClick={() => handleTransition(t)}
								disabled={pending !== null}
								variant={t === "cancelled" ? "secondary" : "default"}
								className="h-11 w-full"
							>
								{pending === t ? "Updating…" : transitionLabels[t]}
							</Button>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}

function formatPickupInline(snapshot: PickupSnapshot): string {
	const lines = [snapshot.label, snapshot.address];
	if (snapshot.mapsUrl) lines.push(snapshot.mapsUrl);
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
	items: ReadonlyArray<{ name: string; quantity: number; price: number }>;
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
		lines.push(
			`• ${item.quantity}× ${item.name} (${formatPrice(item.price * item.quantity, currency)})`,
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
	items: ReadonlyArray<{ name: string; quantity: number; price: number }>;
	total: number;
	currency: string;
}) {
	const [copied, setCopied] = useState(false);
	const message = buildNotifyManagerMessage({
		shortId,
		location,
		customerName,
		customerWaPhone,
		items,
		total,
		currency,
	});

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
					className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-accent hover:bg-accent/10"
					aria-label="Copy notify-manager message"
				>
					<Copy className="size-3.5" />
					{copied ? "Copied!" : "Copy message"}
				</button>
			</div>
			<pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-2.5 font-sans text-xs leading-relaxed text-foreground">
				{message}
			</pre>
			<p className="text-xs text-muted-foreground">
				Tap copy and forward to whoever runs this pickup spot. You can edit it
				before sending.
			</p>
		</section>
	);
}
