import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	BadgeCheck,
	CheckCircle,
	Clock,
	ExternalLink,
	HandCoins,
	Hourglass,
	ImageIcon,
	MapPin,
	Package,
	Pencil,
	Store,
	Truck,
	XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { isMockupGateClosed } from "../../convex/lib/order";
import { CopyButton } from "../components/ui/copy-button";
import { AddressEditDialog } from "../components/storefront/address-edit-dialog";
import { DeliveryAddressDisplay } from "../components/storefront/delivery-address-display";
import { IvePaidDialog } from "../components/storefront/ive-paid-dialog";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { convexErrorMessage, formatPrice } from "../lib/format";
import {
	deriveMapsUrl,
	googleMapsNavUrl,
	wazeNavUrl,
} from "../lib/google-address";

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
	const paymentInstructions = useQuery(api.orders.getPaymentInstructions, {
		shortId,
	});
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
	// While a custom item still awaits mockup approval, the price isn't final, so
	// the payment ask is held back (no live "I've paid" — see the bot flow too).
	// Gate opens on approval or seller waiver. Shared gate — same source as the
	// server (lib/order). `mockupGateOpen` is the distinct "actively opened"
	// concept used only for the receipt below.
	const mockupGateClosed = isMockupGateClosed(order);
	const mockupGateOpen =
		order.mockupStatus === "approved" || order.mockupWaivedAt != null;

	// Receipt reconciliation for the custom-work quote (order-level, minor units).
	// The made-to-order line is snapshotted at price 0, so the quote would
	// otherwise be invisible on the items list (a stray "RM 0.00" next to a
	// non-zero Total). Once the buyer locks it (approve/waive) we fold the quote
	// onto the single price-0 line so the receipt reads normally; while it's still
	// proposed — or can't be pinned to exactly one line — we show it as a separate
	// "Custom work" line instead, so the line prices always sum to Total.
	const customQuote = order.mockupQuotedAmount ?? 0;
	const zeroPricedLineIdx = order.items.reduce<number[]>((acc, it, i) => {
		if (it.price === 0) acc.push(i);
		return acc;
	}, []);
	const quoteLineIdx =
		customQuote > 0 && mockupGateOpen && zeroPricedLineIdx.length === 1
			? zeroPricedLineIdx[0]
			: null;
	const showCustomWorkLine = customQuote > 0 && quoteLineIdx === null;

	// Timeline nodes: the fulfilment statuses, with a virtual "mockup" step
	// spliced in right after Confirmed for custom orders so the buyer sees where
	// approval sits (and that it gates Packed). Non-custom orders get the plain
	// fulfilment list.
	const reachedIdx = STATUS_ORDER.indexOf(
		order.status as (typeof STATUS_ORDER)[number],
	);
	const timelineNodes: Array<{
		key: string;
		label: string;
		icon: ReactNode;
		isDone: boolean;
		isCurrent: boolean;
	}> = [];
	for (const [i, s] of STATUS_ORDER.entries()) {
		const sc = statusConfig[s];
		timelineNodes.push({
			key: s,
			label: sc?.label ?? s,
			icon: sc?.icon,
			isDone: i <= reachedIdx,
			// For a gated custom order the active step is the mockup, not Confirmed.
			isCurrent: s === order.status && !(s === "confirmed" && mockupGateClosed),
		});
		if (s === "confirmed" && order.mockupStatus !== undefined) {
			timelineNodes.push({
				key: "mockup",
				label: mockupGateOpen
					? "Mockup approved"
					: order.mockupStatus === "submitted"
						? "Pending mockup approval"
						: order.mockupStatus === "changes_requested"
							? "Pending mockup update"
							: "Pending mockup design",
				icon: <ImageIcon className="size-5" />,
				isDone: mockupGateOpen,
				isCurrent: mockupGateClosed && reachedIdx >= 1,
			});
		}
	}

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
						mockupGateClosed ? (
							<>
								<Button disabled className="h-12 w-full text-base">
									{order.mockupStatus === "submitted"
										? "Awaiting your mockup approval"
										: "Awaiting mockup"}
								</Button>
								<p className="text-xs opacity-80">
									{order.mockupStatus === "submitted"
										? "Approve the mockup below to unlock payment."
										: "Payment opens once you approve the seller's mockup."}
								</p>
							</>
						) : (
							<Button
								onClick={() => setClaimingPayment(true)}
								className="h-12 w-full text-base"
							>
								I've paid
							</Button>
						)
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

			{/* How to pay — the seller's bank/QR details with one-tap copy on the
			    account number (the MY bank-transfer friction point). Shown while a
			    payment is still due and not deferred behind a closed mockup gate;
			    hidden once received/cancelled or when nothing is configured. */}
			{!isCancelled &&
			!mockupGateClosed &&
			paymentStatus !== "received" &&
			paymentInstructions ? (
				<section className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						How to pay
					</p>
					{paymentInstructions.bankName ? (
						<div className="flex items-baseline justify-between gap-3 text-sm">
							<span className="text-muted-foreground">Bank</span>
							<span className="font-medium">{paymentInstructions.bankName}</span>
						</div>
					) : null}
					{paymentInstructions.bankAccountName ? (
						<div className="flex items-baseline justify-between gap-3 text-sm">
							<span className="text-muted-foreground">Name</span>
							<span className="text-right font-medium">
								{paymentInstructions.bankAccountName}
							</span>
						</div>
					) : null}
					{paymentInstructions.bankAccountNumber ? (
						<div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
							<div className="min-w-0">
								<p className="text-xs text-muted-foreground">Account number</p>
								<p className="break-all font-mono text-base font-semibold">
									{paymentInstructions.bankAccountNumber}
								</p>
							</div>
							<CopyButton
								value={paymentInstructions.bankAccountNumber}
								ariaLabel="Copy account number"
								successMessage="Account number copied"
							/>
						</div>
					) : null}
					{paymentInstructions.note ? (
						<p className="whitespace-pre-line break-words text-sm text-muted-foreground">
							{paymentInstructions.note}
						</p>
					) : null}
					{paymentInstructions.qrImageUrl ? (
						<div className="flex flex-col items-center gap-1.5 pt-1">
							<img
								src={paymentInstructions.qrImageUrl}
								alt="Payment QR code"
								className="max-h-56 w-auto rounded-lg border border-border bg-white"
							/>
							<p className="text-xs text-muted-foreground">Scan to pay</p>
						</div>
					) : null}
				</section>
			) : null}

			{/* Mockup approval — buyer reviews the seller's proof before production. */}
			{!isCancelled && order.mockupStatus !== undefined ? (
				<MockupReview shortId={order.shortId} order={order} />
			) : null}

			{/* Progress timeline — not shown for cancelled orders */}
			{!isCancelled ? (
				<div className="mt-6 flex flex-col gap-0">
					{timelineNodes.map((node, i) => (
						<div key={node.key} className="flex gap-3">
							{/* spine */}
							<div className="flex flex-col items-center">
								<div
									className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
										node.isDone
											? "border-accent bg-accent text-accent-foreground"
											: "border-border bg-card text-muted-foreground"
									}`}
								>
									{node.icon}
								</div>
								{i < timelineNodes.length - 1 ? (
									<div
										className={`w-0.5 flex-1 transition-colors ${node.isDone && !node.isCurrent ? "bg-accent" : "bg-border"}`}
										style={{ minHeight: 28 }}
									/>
								) : null}
							</div>
							{/* label */}
							<div className="pb-6 pt-1">
								<p
									className={`text-sm font-medium ${node.isCurrent ? "text-foreground" : node.isDone ? "text-foreground/70" : "text-muted-foreground"}`}
								>
									{node.label}
								</p>
							</div>
						</div>
					))}
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
					{order.items.map((item, i) => {
						// Folded quote: this single made-to-order line carries the
						// locked custom-work price instead of its RM0 snapshot.
						const isQuoteLine = i === quoteLineIdx;
						const lineTotal = isQuoteLine
							? customQuote
							: item.price * item.quantity;
						const unitPrice = isQuoteLine
							? customQuote / item.quantity
							: item.price;
						return (
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
										{item.quantity} × {formatPrice(unitPrice, order.currency)}
									</p>
								</div>
								<p className="shrink-0 text-sm font-semibold tabular-nums">
									{formatPrice(lineTotal, order.currency)}
								</p>
							</li>
						);
					})}
				</ul>
				{showCustomWorkLine ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>Custom work{mockupGateOpen ? "" : " (proposed)"}</span>
						<span className="tabular-nums">
							{formatPrice(customQuote, order.currency)}
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
	// Google opens on the NAMED place (placeId), consistent with the WhatsApp
	// confirm link. Waze gets `q=<name, address>` (so the mobile app can show the
	// name) plus `ll` coords to keep the pin exact (desktop web shows coords +
	// correct pin — Waze has no web named-place URL we can build). See wazeNavUrl.
	const googleUrl = googleMapsNavUrl(snapshot);
	const wazeQuery = [snapshot.label, snapshot.address]
		.filter((s) => s && s.trim().length > 0)
		.join(", ");
	const wazeUrl = wazeNavUrl({ ...snapshot, query: wazeQuery });

	if (googleUrl && wazeUrl) {
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
	// PlaceId without coords → Google only (Waze can't navigate without lat/lng).
	if (googleUrl) {
		return (
			<a
				href={googleUrl}
				target="_blank"
				rel="noreferrer"
				className="flex items-center gap-1.5 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
			>
				<ExternalLink className="size-3.5" />
				Open in Google Maps
			</a>
		);
	}
	// Legacy snapshot with only a retailer-pasted maps link.
	if (snapshot.mapsUrl) {
		return (
			<a
				href={snapshot.mapsUrl}
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

type TrackedOrder = NonNullable<
	ReturnType<typeof useQuery<typeof api.orders.get>>
>;

/** Buyer-facing mockup review: approve or request changes on the seller's proof. */
function MockupReview({
	shortId,
	order,
}: {
	shortId: string;
	order: TrackedOrder;
}) {
	const approve = useMutation(api.orders.approveMockup);
	const requestChanges = useMutation(api.orders.requestMockupChanges);
	const declineItem = useMutation(api.orders.declineMockupItem);
	const mockupUrl = useQuery(api.orders.getMockupUrl, { shortId });
	const [note, setNote] = useState("");
	const [showNote, setShowNote] = useState(false);
	const [confirmDecline, setConfirmDecline] = useState(false);
	const [busy, setBusy] = useState(false);

	const status = order.mockupStatus;
	const quoted = order.mockupQuotedAmount;

	async function handleApprove() {
		setBusy(true);
		try {
			await approve({ shortId });
			toast.success("Mockup approved — thank you!");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleDecline() {
		setBusy(true);
		try {
			await declineItem({ shortId });
			toast.success("Custom item removed from your order");
			setConfirmDecline(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleRequestChanges() {
		setBusy(true);
		try {
			await requestChanges({ shortId, note: note.trim() || undefined });
			toast.success("Sent — the seller will update your mockup");
			setShowNote(false);
			setNote("");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex items-center gap-3">
				<ImageIcon className="size-5 text-accent" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Mockup
					</p>
					<p className="font-semibold">
						{status === "approved"
							? "Mockup approved"
							: status === "submitted"
								? "Pending mockup approval"
								: status === "changes_requested"
									? "Pending mockup update"
									: "Pending mockup design"}
					</p>
				</div>
			</div>

			{order.mockupImageStorageId && mockupUrl ? (
				<a
					href={mockupUrl}
					target="_blank"
					rel="noreferrer"
					className="block overflow-hidden rounded-xl border border-border bg-white"
				>
					<img
						src={mockupUrl}
						alt="Your mockup"
						className="block max-h-72 w-full object-contain"
					/>
				</a>
			) : null}

			{quoted != null && quoted > 0 ? (
				<div className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3 text-sm">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">
							Custom item{status === "approved" ? "" : " (proposed)"}
						</span>
						<span className="font-semibold tabular-nums">
							{formatPrice(quoted, order.currency)}
						</span>
					</div>
					<div className="flex items-center justify-between border-t border-border pt-1">
						<span className="text-muted-foreground">Order total</span>
						<span className="font-semibold tabular-nums">
							{formatPrice(order.total, order.currency)}
						</span>
					</div>
				</div>
			) : null}

			{status === "pending" ? (
				<p className="text-sm text-muted-foreground">
					The seller is preparing your mockup — we'll show it here when it's
					ready to review.
				</p>
			) : null}
			{status === "changes_requested" ? (
				<p className="text-sm text-muted-foreground">
					The seller is updating your mockup based on your feedback.
				</p>
			) : null}
			{status === "approved" ? (
				<p className="text-sm text-emerald-700">
					Approved — the seller will start making your order.
				</p>
			) : null}

			{status === "submitted" ? (
				showNote ? (
					<div className="flex flex-col gap-2">
						<textarea
							value={note}
							onChange={(e) => setNote(e.target.value)}
							maxLength={500}
							rows={3}
							placeholder="What would you like changed? (optional)"
							className="w-full rounded-xl border border-border bg-background p-3 text-sm"
						/>
						<div className="flex gap-2">
							<Button
								onClick={handleRequestChanges}
								disabled={busy}
								className="h-11 flex-1"
							>
								Send changes
							</Button>
							<Button
								variant="secondary"
								onClick={() => setShowNote(false)}
								disabled={busy}
								className="h-11"
							>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<Button
							onClick={handleApprove}
							disabled={busy}
							className="h-12 w-full text-base"
						>
							Approve mockup
						</Button>
						<button
							type="button"
							onClick={() => setShowNote(true)}
							className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
						>
							Request changes
						</button>
					</div>
				)
			) : null}

			{/* Remove the custom item — available until it's approved. Drops the
			    custom line; any other items in the order carry on. Distinct from
			    "Request changes" (the mockup-revision loop). */}
			{status !== "approved" && !showNote ? (
				confirmDecline ? (
					<div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
						<p className="text-sm">
							Remove the custom item from your order? Any other items stay and
							proceed as normal. This can't be undone.
						</p>
						<div className="flex gap-2">
							<Button
								variant="destructive"
								onClick={handleDecline}
								disabled={busy}
								className="h-11 flex-1"
							>
								Yes, remove it
							</Button>
							<Button
								variant="secondary"
								onClick={() => setConfirmDecline(false)}
								disabled={busy}
								className="h-11"
							>
								Keep it
							</Button>
						</div>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setConfirmDecline(true)}
						className="self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
					>
						Remove this custom item
					</button>
				)
			) : null}
		</section>
	);
}
