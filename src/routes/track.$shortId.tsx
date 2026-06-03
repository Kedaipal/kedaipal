import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	BadgeCheck,
	CheckCircle,
	Clock,
	ExternalLink,
	HandCoins,
	Hourglass,
	MapPin,
	Package,
	Pencil,
	Store,
	Truck,
	XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../convex/_generated/api";
import { AddressEditDialog } from "../components/storefront/address-edit-dialog";
import { DeliveryAddressDisplay } from "../components/storefront/delivery-address-display";
import { IvePaidDialog } from "../components/storefront/ive-paid-dialog";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { formatPrice } from "../lib/format";
import { deriveMapsUrl } from "../lib/google-address";

type PaymentStatus = "unpaid" | "claimed" | "received";

type PaymentCfg = {
	label: string;
	icon: ReactNode;
	tone: string;
};

function getPaymentConfig(status: PaymentStatus): PaymentCfg {
	switch (status) {
		case "received":
			return {
				label: "Payment Confirmed",
				icon: <BadgeCheck className="size-5" />,
				tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
			};
		case "claimed":
			return {
				label: "Payment Submitted",
				icon: <Hourglass className="size-5" />,
				tone: "border-blue-200 bg-blue-50 text-blue-700",
			};
		default:
			return {
				label: "Payment Unpaid",
				icon: <HandCoins className="size-5" />,
				tone: "border-amber-200 bg-amber-50 text-amber-800",
			};
	}
}

function formatRelativeTime(epochMs: number | undefined): string {
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

export const Route = createFileRoute("/track/$shortId")({
	loader: async ({ params }) => {
		const client = getConvexHttpClient();
		const order = await client.query(api.orders.get, {
			shortId: params.shortId,
		});
		if (!order) throw notFound();
		return { shortId: params.shortId };
	},
	head: ({ params }) => ({
		meta: [
			{ title: `Order ${params.shortId} — Kedaipal` },
			{ name: "robots", content: "noindex" },
		],
		links: [{ rel: "canonical", href: `${SITE_URL}/track/${params.shortId}` }],
	}),
	notFoundComponent: OrderNotFound,
	component: TrackingRoute,
});

type DeliveryMethod = "delivery" | "self_collect";

type StatusCfg = { label: string; icon: ReactNode; color: string };

function getStatusConfig(method: DeliveryMethod): Record<string, StatusCfg> {
	return {
		pending: {
			label: "Order Received",
			icon: <Clock className="size-5" />,
			color: "text-amber-500",
		},
		confirmed: {
			label: "Confirmed",
			icon: <CheckCircle className="size-5" />,
			color: "text-blue-500",
		},
		packed: {
			label: "Packed",
			icon: <Package className="size-5" />,
			color: "text-violet-500",
		},
		shipped: {
			label: method === "self_collect" ? "Ready for Pickup" : "On the Way",
			icon:
				method === "self_collect" ? (
					<Store className="size-5" />
				) : (
					<Truck className="size-5" />
				),
			color: "text-orange-500",
		},
		delivered: {
			label: method === "self_collect" ? "Collected" : "Delivered",
			icon: <CheckCircle className="size-5" />,
			color: "text-green-500",
		},
		cancelled: {
			label: "Cancelled",
			icon: <XCircle className="size-5" />,
			color: "text-destructive",
		},
	};
}

const STATUS_ORDER = [
	"pending",
	"confirmed",
	"packed",
	"shipped",
	"delivered",
] as const;

function OrderNotFound() {
	const { shortId } = Route.useParams();
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<h1 className="text-2xl font-bold">Order not found</h1>
			<p className="text-sm text-muted-foreground">
				No order with ID{" "}
				<span className="font-mono font-semibold">{shortId}</span>.
			</p>
		</main>
	);
}

function TrackingSkeleton() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-12 pt-10">
			<Skeleton className="h-3 w-16" />
			<Skeleton className="mt-3 h-8 w-32" />
			<Skeleton className="mt-1 h-4 w-44" />

			{/* Status card */}
			<div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
				<Skeleton className="h-5 w-5 rounded-full" />
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-3 w-12" />
					<Skeleton className="h-4 w-24" />
				</div>
			</div>

			{/* Timeline */}
			<div className="mt-6 flex flex-col gap-0">
				{[0, 1, 2, 3, 4].map((n) => (
					<div key={n} className="flex gap-3">
						<div className="flex flex-col items-center">
							<Skeleton className="h-8 w-8 rounded-full" />
							{n < 4 ? (
								<Skeleton className="w-0.5 flex-1" style={{ minHeight: 28 }} />
							) : null}
						</div>
						<div className="pb-6 pt-1">
							<Skeleton className="h-4 w-24" />
						</div>
					</div>
				))}
			</div>

			{/* Items */}
			<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<Skeleton className="h-3 w-10" />
				{[0, 1, 2].map((n) => (
					<div
						key={n}
						className="flex items-center justify-between gap-3 py-2.5"
					>
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-20" />
						</div>
						<Skeleton className="h-4 w-16" />
					</div>
				))}
				<Skeleton className="h-10 w-full rounded-xl" />
			</section>
		</main>
	);
}

function TrackingRoute() {
	const { shortId } = Route.useParams();
	const order = useQuery(api.orders.get, { shortId });
	const [editingAddress, setEditingAddress] = useState(false);
	const [claimingPayment, setClaimingPayment] = useState(false);

	if (order === undefined) {
		return <TrackingSkeleton />;
	}
	if (order === null) {
		return <OrderNotFound />;
	}

	const deliveryMethod = (order.deliveryMethod ?? "delivery") as DeliveryMethod;
	const isSelfCollect = deliveryMethod === "self_collect";
	const statusConfig = getStatusConfig(deliveryMethod);
	const config = statusConfig[order.status];
	const isCancelled = order.status === "cancelled";
	const canEditAddress = order.status === "pending" && !isSelfCollect;
	const paymentStatus = (order.paymentStatus ?? "unpaid") as PaymentStatus;
	const paymentConfig = getPaymentConfig(paymentStatus);

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-12 pt-10">
			{/* Header */}
			<p className="text-xs font-semibold uppercase tracking-widest text-accent">
				Kedaipal
			</p>
			<h1 className="mt-3 font-mono text-2xl font-bold tracking-tight">
				#{order.shortId}
			</h1>
			<p className="mt-0.5 text-sm text-muted-foreground">
				{new Date(order._creationTime).toLocaleString(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
				})}
			</p>

			{/* Current status card */}
			<div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
				<span className={config?.color}>{config?.icon}</span>
				<div>
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Status
					</p>
					<p className="font-semibold">{config?.label ?? order.status}</p>
				</div>
			</div>

			{/* Payment card — independent of fulfilment status. Hidden once cancelled. */}
			{!isCancelled ? (
				<section
					className={`mt-4 flex flex-col gap-3 rounded-2xl border p-4 ${paymentConfig.tone}`}
				>
					<div className="flex items-center gap-3">
						{paymentConfig.icon}
						<div className="min-w-0 flex-1">
							<p className="text-xs font-semibold uppercase tracking-widest opacity-80">
								Payment
							</p>
							<p className="font-semibold">{paymentConfig.label}</p>
						</div>
						{paymentStatus === "received" && order.paymentReceivedAt ? (
							<p className="shrink-0 text-xs opacity-80">
								{formatRelativeTime(order.paymentReceivedAt)}
							</p>
						) : null}
					</div>

					{paymentStatus === "unpaid" ? (
						<Button
							onClick={() => setClaimingPayment(true)}
							className="h-12 w-full text-base"
						>
							I've paid
						</Button>
					) : null}

					{paymentStatus === "claimed" ? (
						<div className="flex items-center justify-between gap-3 text-sm">
							<p className="opacity-80">
								Awaiting store confirmation
								{order.paymentClaimedAt
									? ` · ${formatRelativeTime(order.paymentClaimedAt)}`
									: ""}
							</p>
							<button
								type="button"
								onClick={() => setClaimingPayment(true)}
								className="shrink-0 font-medium underline-offset-2 hover:underline"
							>
								Update proof
							</button>
						</div>
					) : null}
				</section>
			) : null}

			{/* Progress timeline — not shown for cancelled orders */}
			{!isCancelled ? (
				<div className="mt-6 flex flex-col gap-0">
					{STATUS_ORDER.map((s, i) => {
						const reached = STATUS_ORDER.indexOf(
							order.status as (typeof STATUS_ORDER)[number],
						);
						const isDone = i <= reached;
						const isCurrent = s === order.status;
						const sc = statusConfig[s];
						return (
							<div key={s} className="flex gap-3">
								{/* spine */}
								<div className="flex flex-col items-center">
									<div
										className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
											isDone
												? "border-accent bg-accent text-accent-foreground"
												: "border-border bg-card text-muted-foreground"
										}`}
									>
										{sc?.icon}
									</div>
									{i < STATUS_ORDER.length - 1 ? (
										<div
											className={`w-0.5 flex-1 transition-colors ${isDone && !isCurrent ? "bg-accent" : "bg-border"}`}
											style={{ minHeight: 28 }}
										/>
									) : null}
								</div>
								{/* label */}
								<div className="pb-6 pt-1">
									<p
										className={`text-sm font-medium ${isCurrent ? "text-foreground" : isDone ? "text-foreground/70" : "text-muted-foreground"}`}
									>
										{sc?.label}
									</p>
								</div>
							</div>
						);
					})}
				</div>
			) : null}

			{/* Carrier tracking CTA — only for delivery orders */}
			{!isSelfCollect && order.carrierTrackingUrl ? (
				<a
					href={order.carrierTrackingUrl}
					target="_blank"
					rel="noreferrer"
					className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
				>
					<Truck className="size-4" />
					Track with carrier
					<ExternalLink className="size-3" />
				</a>
			) : null}

			{/* Pickup location — shown for self-collect orders that have a snapshot.
			    Reads the frozen snapshot (not the live pickupLocations row) so a
			    retailer edit after the order was placed never rewrites history. */}
			{isSelfCollect && order.pickupSnapshot ? (
				<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Pick up at
					</p>
					<div className="flex items-start gap-2">
						<MapPin
							className="size-4 shrink-0 text-accent mt-0.5"
							aria-hidden="true"
						/>
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<p className="text-sm font-semibold leading-tight">
								{order.pickupSnapshot.label}
							</p>
							<p className="text-xs text-muted-foreground whitespace-pre-line">
								{order.pickupSnapshot.address}
							</p>
						</div>
					</div>
					<PickupNavButtons snapshot={order.pickupSnapshot} />
					{order.pickupSnapshot.notes ? (
						<p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-foreground whitespace-pre-line">
							{order.pickupSnapshot.notes}
						</p>
					) : null}
				</section>
			) : null}

			{/* Delivery address — shown for delivery orders that have an address */}
			{!isSelfCollect && order.deliveryAddress ? (
				<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Deliver to
						</p>
						{canEditAddress ? (
							<button
								type="button"
								onClick={() => setEditingAddress(true)}
								className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
							>
								<Pencil className="size-3" />
								Edit
							</button>
						) : null}
					</div>
					<DeliveryAddressDisplay address={order.deliveryAddress} />
					{(() => {
						const mapsUrl = deriveMapsUrl(order.deliveryAddress);
						return mapsUrl ? (
							<a
								href={mapsUrl}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1.5 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
							>
								<MapPin className="size-3.5" />
								Open pinned location
							</a>
						) : null;
					})()}
					{!canEditAddress ? (
						<p className="text-xs text-muted-foreground">
							Contact the store to change this address.
						</p>
					) : null}
				</section>
			) : null}

			{/* Delivery method */}
			<div className="mt-4 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm font-medium text-muted-foreground">
				{isSelfCollect ? (
					<Package className="size-4" />
				) : (
					<Truck className="size-4" />
				)}
				{isSelfCollect ? "Self Collect" : "Delivery"}
			</div>

			<AddressEditDialog
				open={editingAddress}
				onClose={() => setEditingAddress(false)}
				shortId={order.shortId}
				currentAddress={order.deliveryAddress}
				retailerId={order.retailerId}
			/>

			<IvePaidDialog
				open={claimingPayment}
				onClose={() => setClaimingPayment(false)}
				shortId={order.shortId}
				hasExistingClaim={paymentStatus === "claimed"}
			/>

			{/* Items */}
			<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
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
				<div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-bold">
					<span>Total</span>
					<span className="tabular-nums">
						{formatPrice(order.total, order.currency)}
					</span>
				</div>
			</section>
		</main>
	);
}

/**
 * Navigation buttons for a self-collect pickup. When we have lat/lng (Google
 * autocomplete-captured locations) we render TWO buttons — Waze and Google
 * Maps — so the buyer can pick their preferred app. Legacy snapshots without
 * coordinates fall back to the single "Open in maps" link the retailer
 * pasted.
 */
function PickupNavButtons({
	snapshot,
}: {
	snapshot: NonNullable<
		ReturnType<typeof useQuery<typeof api.orders.get>>
	>["pickupSnapshot"];
}) {
	if (!snapshot) return null;
	const { latitude, longitude, mapsUrl } = snapshot;
	const hasCoords =
		typeof latitude === "number" && typeof longitude === "number";

	if (hasCoords) {
		const wazeUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
		const googleUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
		return (
			<div className="grid grid-cols-2 gap-2">
				<a
					href={wazeUrl}
					target="_blank"
					rel="noreferrer"
					className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/5"
				>
					<MapPin className="size-3.5 text-accent" aria-hidden="true" />
					Open in Waze
				</a>
				<a
					href={googleUrl}
					target="_blank"
					rel="noreferrer"
					className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/5"
				>
					<MapPin className="size-3.5 text-accent" aria-hidden="true" />
					Open in Google Maps
				</a>
			</div>
		);
	}
	if (mapsUrl) {
		return (
			<a
				href={mapsUrl}
				target="_blank"
				rel="noreferrer"
				className="flex items-center gap-1.5 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
			>
				<ExternalLink className="size-3.5" />
				Open in maps
			</a>
		);
	}
	return null;
}
