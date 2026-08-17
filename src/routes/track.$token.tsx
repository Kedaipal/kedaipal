import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	BadgeCheck,
	CalendarDays,
	CheckCircle,
	Clock,
	ExternalLink,
	HandCoins,
	Hourglass,
	ImageIcon,
	Loader2,
	MapPin,
	MessageCircle,
	Package,
	Pencil,
	Send,
	StickyNote,
	Store,
	Truck,
	XCircle,
} from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { isSafeTrackingUrl } from "../../convex/lib/couriers";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentDateTime,
} from "../../convex/lib/fulfilmentDate";
import { describeGatewayMethods } from "../../convex/lib/hitpay";
import { isMockupGateClosed } from "../../convex/lib/order";
import { paymentMethodLabel } from "../../convex/lib/paymentMethod";
import { ReceiptDownloadButton } from "../components/order/receipt-download-button";
import { AddressEditDialog } from "../components/storefront/address-edit-dialog";
import { DeliveryAddressDisplay } from "../components/storefront/delivery-address-display";
import { ManualPaymentDialog } from "../components/storefront/manual-payment-dialog";
import { AppImage } from "../components/ui/app-image";
import { Button } from "../components/ui/button";
import { CopyButton } from "../components/ui/copy-button";
import { MyPhoneInput } from "../components/ui/my-phone-input";
import { Skeleton } from "../components/ui/skeleton";
import { ZoomableImage } from "../components/ui/zoomable-image";
import { getConvexHttpClient } from "../lib/convex-server";
import { convexErrorMessage, formatMyMobile, formatPrice } from "../lib/format";
import {
	deriveMapsUrl,
	googleMapsNavUrl,
	wazeNavUrl,
} from "../lib/google-address";
import {
	anchorOrdinal,
	type Locale,
	type OrderStatus,
	resolveCurrentStage,
	resolveStages,
	resolveStatusLabel,
	type StatusLabels,
	stageDescription,
	stageLabel,
} from "../lib/orderStatus";
import { ssrRead } from "../lib/ssr-read";
import { createWaAutoOpen, isWhatsAppWebview } from "../lib/wa-auto-open";
import { buildOrderWaMessage, waOrderUrl } from "../lib/wa-order-message";

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

type GatewayPaymentIssue = {
	kind: "amount_mismatch" | "paid_after_cancel";
	paidAmountSen: number;
	paidCurrency: string;
	paymentId: string;
	at: number;
};

/**
 * Copy for an authentic online payment the order couldn't apply (PR #178
 * review, finding 1). Before this the buyer saw a plain "unpaid" card with
 * Pay-now still armed right after their money left — an invitation to pay
 * twice. One author for both render sites (inside the payment card while the
 * order is live, standalone once it's cancelled or already claimed).
 *
 * Both variants end on "don't pay again" and name the store as the party
 * acting, because there is nothing useful the BUYER can do here — re-paying
 * makes it worse, and the resolution is a human reconciling in HitPay.
 */
function gatewayIssueCopy(
	issue: GatewayPaymentIssue,
	storeName: string,
	orderTotal: number,
	orderCurrency: string,
): { heading: string; body: string } {
	const store = storeName || "The store";
	const paid = formatPrice(issue.paidAmountSen, issue.paidCurrency);
	if (issue.kind === "paid_after_cancel") {
		return {
			heading: "We received a payment for a cancelled order",
			body: `Your ${paid} payment went through after this order was cancelled, so it hasn't been applied to anything. ${store} has been notified and will arrange a refund with you — please don't pay again.`,
		};
	}
	return {
		heading: "We're checking your payment",
		body: `Your ${paid} payment came through, but this order's total is now ${formatPrice(orderTotal, orderCurrency)}, so it hasn't been confirmed automatically. ${store} has been notified and will settle the difference with you — please don't pay again.`,
	};
}

/** The payment reference both sides quote — same chip the confirmed card
 * shows, so a buyer reads one number whether the payment landed or stalled. */
function GatewayIssueReference({ paymentId }: { paymentId: string }) {
	return (
		<div className="rounded-lg border border-black/5 bg-white/60 px-2.5 py-1.5">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[10px] font-medium uppercase tracking-wider opacity-70">
					Payment ref
				</p>
				<CopyButton
					value={paymentId}
					ariaLabel="Copy payment reference"
					successMessage="Payment reference copied"
				/>
			</div>
			<p className="break-all font-mono text-xs">{paymentId}</p>
		</div>
	);
}

export const Route = createFileRoute("/track/$token")({
	// ?send=1 — set only by checkout's post-create navigation: auto-fire the
	// "Send on WhatsApp" handoff once the page mounts. The component strips it
	// (replace) before navigating away, so refresh / back-from-WhatsApp never
	// re-triggers the redirect.
	validateSearch: (
		search: Record<string, unknown>,
	): { send?: 1; status?: string; reference?: string } => ({
		send: search.send === 1 || search.send === "1" ? 1 : undefined,
		// HitPay redirect-return params (86eyb6z3a): their PRESENCE triggers a
		// server-side verify against HitPay's status API; the values themselves
		// are display-only and never trusted.
		status: typeof search.status === "string" ? search.status : undefined,
		reference:
			typeof search.reference === "string" ? search.reference : undefined,
	}),
	loader: async ({ params }): Promise<{ shortId: string | null }> => {
		const read = await ssrRead(() =>
			getConvexHttpClient().query(api.orders.get, { token: params.token }),
		);
		// Transient upstream failure ≠ bad token: this loader only feeds head()
		// meta — the page's real data is the client's reactive query — so a blip
		// soft-degrades to the shell instead of dead-ending the buyer's WhatsApp
		// link on an error page (86eyheqzv). Only a definitive null (the query
		// answered: no such token) is a 404.
		if (!read.ok) return { shortId: null };
		if (!read.value) throw notFound();
		// Surface only the human-readable shortId to the page head — never echo the
		// secret token into a title/canonical that could leak via referrer/history.
		return { shortId: read.value.shortId };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData?.shortId
					? `Order ${loaderData.shortId} — Kedaipal`
					: "Your order — Kedaipal",
			},
			// noindex + no canonical: the URL carries a capability token, so it must
			// never be indexed or advertised.
			{ name: "robots", content: "noindex" },
		],
	}),
	notFoundComponent: OrderNotFound,
	component: TrackingRoute,
});

type DeliveryMethod = "delivery" | "self_collect" | "booking";

type StatusCfg = { label: string; icon: ReactNode; color: string };

// Icons + colors are fixed per canonical status; only the text is retailer-
// customizable. Labels resolve at render time (override → method preset → base
// default) so a relabel is retroactive across all in-flight orders.
function getStatusConfig(
	method: DeliveryMethod,
	labels: StatusLabels | undefined,
	locale: Locale,
): Record<string, StatusCfg> {
	const label = (status: OrderStatus) =>
		resolveStatusLabel(status, { labels, deliveryMethod: method, locale });
	return {
		pending: {
			label: label("pending"),
			icon: <Clock className="size-5" />,
			color: "text-amber-500",
		},
		booking_requested: {
			label: label("booking_requested"),
			icon: <Clock className="size-5" />,
			color: "text-amber-500",
		},
		confirmed: {
			label: label("confirmed"),
			icon: <CheckCircle className="size-5" />,
			color: "text-blue-500",
		},
		packed: {
			label: label("packed"),
			icon: <Package className="size-5" />,
			color: "text-violet-500",
		},
		shipped: {
			label: label("shipped"),
			icon:
				method === "self_collect" ? (
					<Store className="size-5" />
				) : (
					<Truck className="size-5" />
				),
			color: "text-orange-500",
		},
		delivered: {
			label: label("delivered"),
			icon: <CheckCircle className="size-5" />,
			color: "text-green-500",
		},
		cancelled: {
			label: label("cancelled"),
			icon: <XCircle className="size-5" />,
			color: "text-destructive",
		},
	};
}

function OrderNotFound() {
	// Intentionally does NOT echo the URL token — it's a capability, and the link
	// may simply be stale. Keep the message generic.
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
			<h1 className="text-2xl font-bold">Order not found</h1>
			<p className="text-sm text-muted-foreground">
				This tracking link is invalid or has expired. Please use the latest link
				from your WhatsApp chat with the store.
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
	const { token } = Route.useParams();
	const {
		send,
		status: returnStatus,
		reference: returnReference,
	} = Route.useSearch();
	const navigate = Route.useNavigate();
	const order = useQuery(convexQuery(api.orders.get, { token })).data;
	// Only subscribe to payment methods when the "How to pay" section can actually
	// render. Skipping for cancelled / already-paid / mockup-gated orders avoids a
	// second order+retailer read+subscription on this hot public path. (Kept a
	// separate query rather than folding into orders.get so the seller's
	// orders.get path doesn't pay for retailer + QR-URL resolution it never uses.)
	const showPaymentSection =
		order != null &&
		order.status !== "cancelled" &&
		(order.paymentStatus ?? "unpaid") !== "received" &&
		!isMockupGateClosed(order) &&
		order.deliveryFeePending !== true;
	const paymentInfo = useQuery(
		convexQuery(
			api.orders.getPaymentMethods,
			showPaymentSection ? { token } : "skip",
		),
	).data;
	const paymentMethods = paymentInfo?.methods ?? [];
	// The seller's HitPay checkout can take THIS order's payment right now
	// (86eyb6z3a) — connection on, price holds clear, payment still open.
	const gatewayAvailable = paymentInfo?.gatewayAvailable === true;
	// Name only the rails this account actually has enabled (probed truth);
	// null falls back to a generic line rather than promising methods the
	// seller never switched on.
	const gatewayMethodsLabel = describeGatewayMethods(
		paymentInfo?.gatewayMethods,
	);
	const [editingAddress, setEditingAddress] = useState(false);
	// The manual-payment sheet (methods + I've-paid proof in one door) — opened
	// by the payment card's primary button on manual stores, the bank-transfer
	// fallback on gateway stores, and "Update proof" on a claimed order.
	const [claimingPayment, setClaimingPayment] = useState(false);
	const createGatewayCheckout = useAction(api.hitpay.createCheckout);
	const verifyGatewayCheckout = useAction(api.hitpay.verifyCheckout);
	const [payingNow, setPayingNow] = useState(false);
	// Landing back from HitPay's checkout (?status&reference appended to the
	// redirect): show a "confirming" state while ONE server-side verify runs —
	// the params themselves are never trusted, and the reactive order query
	// flips the card the moment the webhook or the verify records the payment.
	const gatewayReturn =
		returnStatus !== undefined || returnReference !== undefined;
	const [confirmingGateway, setConfirmingGateway] = useState(gatewayReturn);
	const verifiedOnReturn = useRef(false);
	useEffect(() => {
		if (!gatewayReturn || verifiedOnReturn.current) return;
		verifiedOnReturn.current = true;
		// Strip the return params immediately (replace) so refresh/back lands on
		// a plain tracking URL instead of re-firing the verify.
		navigate({ search: {}, replace: true });
		verifyGatewayCheckout({ token })
			.catch(() => undefined)
			.finally(() => setConfirmingGateway(false));
	}, [gatewayReturn, navigate, verifyGatewayCheckout, token]);

	async function handlePayNow() {
		setPayingNow(true);
		try {
			const { url } = await createGatewayCheckout({ token });
			// Same-tab on purpose: the WhatsApp in-app browser has no tab UI, and
			// HitPay redirects straight back here when the payment settles.
			window.location.assign(url);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setPayingNow(false);
		}
	}

	if (order === undefined) {
		return <TrackingSkeleton />;
	}
	if (order === null) {
		return <OrderNotFound />;
	}

	const deliveryMethod = (order.deliveryMethod ?? "delivery") as DeliveryMethod;
	const isSelfCollect = deliveryMethod === "self_collect";
	// Booking kind (S3): the page speaks stay language — range card, request
	// states, and no payment surface until the seller approves.
	const isBooking = deliveryMethod === "booking";
	const ms = order.retailerLocale === "ms";
	// Collection service (86eyg0n8e, frozen at order create): the rider picks
	// up FROM this buyer's address — every "Deliver…" label flips to collection
	// wording so the page never claims something is being sent to them.
	const isCollection = order.deliveryDirection === "collection";
	const statusConfig = getStatusConfig(
		deliveryMethod,
		order.statusLabels,
		order.retailerLocale,
	);
	const config = statusConfig[order.status];
	const isCancelled = order.status === "cancelled";
	// Pending-only, deliberately — and that now excludes fee-pending orders,
	// since the confirmation push commits them as `confirmed` at create
	// (86eyfq0w5). Locked call (Zaki, 31 Jul): a `deliveryFeePending` order is
	// one the SELLER is actively pricing (often alongside a mockup), so letting
	// the buyer move the destination underneath would invalidate the quote
	// they're mid-way through settling. Out-of-range buyers go through the
	// store ("Contact the store to change this address"), not a silent
	// re-price. Don't "fix" this by widening the gate without re-deciding it.
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
	// Second, independent payment hold (86extzdr8): the seller still has to
	// confirm the delivery charge (out-of-range "arrange" order), so the total
	// isn't final and "I've paid" stays held — same posture as the mockup gate.
	const deliveryFeeHeld = order.deliveryFeePending === true;
	// An authentic online payment the server refused to auto-apply (PR #178
	// review, finding 1). It outranks the mockup/delivery-fee holds in the
	// payment card: those say "the price isn't final yet", but here the buyer's
	// money has ALREADY moved, and telling them to wait for a price while
	// leaving Pay-now armed is how they end up paying twice.
	const gatewayIssue = order.gatewayPaymentIssue;
	const gatewayIssueUnresolved =
		gatewayIssue !== undefined && paymentStatus !== "received";
	// The payment card is hidden entirely on a cancelled order, and its
	// `claimed` branch has no room for this — so those cases get a card of
	// their own rather than losing the notice.
	const gatewayIssueInPaymentCard =
		gatewayIssueUnresolved && !isCancelled && paymentStatus === "unpaid";
	const gatewayIssueStandalone =
		gatewayIssueUnresolved && !gatewayIssueInPaymentCard;

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

	// Phase 2: the timeline IS the seller's full ordered stage list (their config,
	// or the synthesized defaults — same code path), led by the "order received"
	// (pending) node. Every stage is visible; the current one is highlighted with
	// its description inline. For custom orders a virtual mockup node is spliced
	// in at the production boundary (before the first packed-or-later stage).
	const stageLocale = order.retailerLocale;
	const stages = resolveStages({
		orderStages: order.orderStages,
		labels: order.statusLabels,
		deliveryMethod,
	});
	const currentStage = resolveCurrentStage(
		{ status: order.status, currentStageId: order.currentStageId },
		stages,
	);
	const stageIdx = currentStage
		? stages.findIndex((s) => s.id === currentStage.id)
		: -1;
	// Combined position into the rendered list: 0 = pending node, 1..N = stages.
	// A booking request sits at position 0 too — its "received" node reads
	// "Awaiting Approval" (below) until the seller answers.
	const currentPos =
		order.status === "pending" || order.status === "booking_requested"
			? 0
			: stageIdx >= 0
				? stageIdx + 1
				: 0;

	const timelineNodes: Array<{
		key: string;
		label: string;
		icon: ReactNode;
		description?: string;
		isDone: boolean;
		isCurrent: boolean;
	}> = [
		{
			key: "pending",
			// A booking's first beat is the request, not "Order Received" — reuse
			// the swept status label so a seller's locale flows through.
			label: isBooking
				? statusConfig.booking_requested.label
				: statusConfig.pending.label,
			icon: statusConfig.pending.icon,
			isDone: true, // any order on this page has at least been received
			isCurrent: currentPos === 0,
		},
	];
	for (const [i, stage] of stages.entries()) {
		const pos = i + 1;
		timelineNodes.push({
			key: stage.id,
			label: stageLabel(stage, stageLocale),
			icon: statusConfig[stage.anchor]?.icon,
			description:
				pos === currentPos ? stageDescription(stage, stageLocale) : undefined,
			isDone: pos <= currentPos,
			isCurrent: pos === currentPos,
		});
	}
	if (order.mockupStatus !== undefined) {
		// While the gate is closed the mockup is the active step, not the stage.
		if (mockupGateClosed && currentPos >= 1 && timelineNodes[currentPos]) {
			timelineNodes[currentPos].isCurrent = false;
		}
		const firstProd = stages.findIndex(
			(s) => anchorOrdinal(s.anchor) >= anchorOrdinal("packed"),
		);
		const insertAt = firstProd >= 0 ? firstProd + 1 : timelineNodes.length;
		timelineNodes.splice(insertAt, 0, {
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
			isCurrent: mockupGateClosed && currentPos >= 1,
		});
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

			{/* Confirmation state for storefront orders (86eyf1rck). The order is
			    already committed in every branch below — none of this blocks the
			    buyer from reading the order or paying, because the confirmation
			    MESSAGE failing is not a reason to withhold their receipt.
			      - pending → the legacy Send card: on the pre-push flow checkout
			        can't open wa.me itself (popup blockers eat window.open after the
			        awaited createOrder — see src/lib/wa-order-message.ts), so the
			        buyer sends from here.
			      - push "sending" → quiet "on its way" line (attempts, incl. retries,
			        are in flight; nothing is asked of the buyer).
			      - push "sent" → "Order placed ✓" success card.
			      - push "failed" → cause-aware card: an unreachable number offers the
			        repair (edit it), a system fault only informs.
			      - push "recovered" → nothing (we've reached them).
			    Counter orders bind via QR scan and never render any of these. */}
			{order.checkoutPhone &&
			(order.source ?? "storefront") === "storefront" ? (
				order.status === "pending" ? (
					<SendOrderCard
						order={order}
						checkoutPhone={order.checkoutPhone}
						autoSend={send === 1}
						onAutoSendConsumed={() =>
							// Drop ?send=1 from the URL (and history, via replace) the moment
							// the auto-attempt starts, so back/refresh lands on a plain
							// tracking URL instead of re-firing the redirect.
							navigate({ search: {}, replace: true })
						}
					/>
				) : order.confirmationPushStatus === "failed" ? (
					<PushFailedCard token={token} order={order} />
				) : order.confirmationPushStatus === "sending" ? (
					<PushSendingCard
						ms={order.retailerLocale === "ms"}
						waPhone={order.customer.waPhone}
					/>
				) : order.confirmationPushStatus === "deferred" &&
					order.status === "confirmed" ? (
					// Confirmed-only, like the `sent` arm: the card promises a future
					// message, which is false on a cancelled order (belt — cancel also
					// clears the stamp) and stale noise once fulfilment moves on.
					<PushDeferredCard ms={order.retailerLocale === "ms"} />
				) : order.confirmationPushStatus === "sent" &&
					order.status === "confirmed" ? (
					<ConfirmationSentCard
						ms={order.retailerLocale === "ms"}
						checkoutPhone={order.checkoutPhone}
					/>
				) : null
			) : null}

			{/* Booking request states (S3, design 86eym0pjg §2): the request's own
			    lifecycle, stated where the buyer lands. While awaiting, the payment
			    card below is suppressed — nothing is payable until the seller
			    approves, and an armed Pay button on a request would be a lie. */}
			{isBooking && order.status === "booking_requested" ? (
				<section className="mt-6 flex flex-col gap-2 rounded-2xl border border-amber-300 bg-card p-4 dark:border-amber-800">
					<span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
						<Clock className="size-3.5" aria-hidden />
						{ms ? "Menunggu kelulusan" : "Awaiting approval"}
					</span>
					<p className="font-heading text-lg font-extrabold leading-tight">
						{ms ? "Permintaan dihantar" : "Request sent"}
					</p>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{ms
							? `${order.storeName} biasanya mengesahkan dalam masa 24 jam — kami akan WhatsApp anda sama ada diterima atau tidak. Tiada bayaran dibuat lagi.`
							: `${order.storeName} usually confirms within 24 hours — we'll WhatsApp you either way. Nothing has been charged.`}
					</p>
				</section>
			) : null}
			{isBooking && order.bookingResolution !== undefined ? (
				<section className="mt-6 flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
					<span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
						{order.bookingResolution === "declined"
							? ms
								? "Permintaan ditolak"
								: "Request declined"
							: ms
								? "Permintaan tamat tempoh"
								: "Request expired"}
					</span>
					{order.bookingResolution === "declined" &&
					order.bookingDeclineReason ? (
						<blockquote className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
							“{order.bookingDeclineReason}”
						</blockquote>
					) : order.bookingResolution === "expired" ? (
						<p className="text-sm leading-relaxed text-muted-foreground">
							{ms
								? "Penjual tidak menjawab dalam masa 24 jam, jadi tarikh anda dilepaskan."
								: "The seller didn't respond within 24 hours, so your dates were released."}
						</p>
					) : null}
					<p className="text-sm font-medium">
						{ms ? "Tiada bayaran dibuat." : "Nothing was charged."}
					</p>
					{order.retailerSlug ? (
						<Link
							to="/$slug"
							params={{ slug: order.retailerSlug }}
							className="mt-1 inline-flex h-11 w-fit items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold transition-colors hover:bg-muted"
						>
							{ms ? "Cuba tarikh lain" : "Try different dates"}
						</Link>
					) : null}
				</section>
			) : null}

			{/* Current status card */}
			<div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
				<span className={config?.color}>{config?.icon}</span>
				<div>
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Status
					</p>
					<p className="font-semibold">
						{currentStage
							? stageLabel(currentStage, stageLocale)
							: (config?.label ?? order.status)}
					</p>
				</div>
			</div>

			{/* Payment card — independent of fulfilment status. Hidden once cancelled,
			    and held back on a booking REQUEST: nothing is payable until the seller
			    approves (the awaiting card above says so). */}
			{!isCancelled && order.status !== "booking_requested" ? (
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

					{/* Settlement detail — the rail the buyer paid on (TnG / FPX /
					    card…) and, for gateway settlements, the HitPay reference the
					    seller's order detail also shows (86eyjmhby), so both sides quote
					    one number when a payment question comes up.

					    Both are facets of the SAME fact ("this is how it was paid"), so
					    they're one child of the card's `gap-3` column with their own
					    tight spacing — as separate children the card's gap pushed the
					    ref far enough from "Paid via" to read as unrelated. The ref sits
					    on its own quiet surface because it's a value to copy, not prose:
					    tone-agnostic white/border (never a hardcoded emerald that could
					    disagree with `paymentConfig.tone`), and the mono string itself
					    drops the muted opacity so a 36-char id stays legible while its
					    label stays secondary to the "Payment Confirmed" headline. */}
					{paymentStatus === "received" &&
					(order.paymentMethod || order.gatewayPaymentId) ? (
						<div className="flex flex-col gap-1.5">
							{order.paymentMethod ? (
								<p className="text-xs opacity-80">
									Paid via {paymentMethodLabel(order.paymentMethod)}
								</p>
							) : null}
							{order.gatewayPaymentId ? (
								<div className="rounded-lg border border-black/5 bg-white/60 px-2.5 py-1.5">
									{/* Copy sits beside the LABEL, not the value, so the id gets
									    the chip's full width — a 36-char HitPay reference then
									    renders complete at 375px instead of truncating, and a
									    half-shown reference number can't be matched against a
									    banking-app entry, which is the whole job. `break-all`
									    only engages if an id ever outgrows one line. The Copy
									    text stays visible at every width: icon-only is a 38px
									    target, under the 44px mobile rule. */}
									<div className="flex items-center justify-between gap-2">
										<p className="text-[10px] font-medium uppercase tracking-wider opacity-70">
											Payment ref
										</p>
										<CopyButton
											value={order.gatewayPaymentId}
											ariaLabel="Copy payment reference"
											successMessage="Payment reference copied"
										/>
									</div>
									<p className="break-all font-mono text-xs">
										{order.gatewayPaymentId}
									</p>
								</div>
							) : null}
						</div>
					) : null}

					{paymentStatus === "unpaid" ? (
						gatewayIssueInPaymentCard && gatewayIssue ? (
							// Deliberately FIRST — and deliberately no Pay-now and no
							// bank-transfer fallback. Every payment affordance here is the
							// wrong move once the money has already left the buyer.
							(() => {
								const copy = gatewayIssueCopy(
									gatewayIssue,
									order.storeName,
									order.total,
									order.currency,
								);
								return (
									<>
										<Button disabled className="h-12 w-full text-base">
											{copy.heading}
										</Button>
										<p className="text-xs opacity-80">{copy.body}</p>
										<GatewayIssueReference paymentId={gatewayIssue.paymentId} />
									</>
								);
							})()
						) : mockupGateClosed ? (
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
						) : deliveryFeeHeld ? (
							<>
								<Button disabled className="h-12 w-full text-base">
									Awaiting delivery charge
								</Button>
								<p className="text-xs opacity-80">
									{order.storeName || "The seller"} is confirming your delivery
									charge on WhatsApp — payment opens with the final total right
									after.
								</p>
							</>
						) : confirmingGateway ? (
							// Just back from HitPay — one server-side verify is in flight.
							// If it (or the webhook) finds the payment, the reactive query
							// flips this card to Confirmed; otherwise the buttons return.
							<>
								<Button disabled isLoading className="h-12 w-full text-base">
									Confirming your payment…
								</Button>
								<p className="text-xs opacity-80">
									Checking with HitPay — this usually takes a few seconds.
								</p>
							</>
						) : gatewayAvailable ? (
							<>
								<Button
									onClick={handlePayNow}
									isLoading={payingNow}
									className="h-12 w-full text-base"
								>
									{payingNow
										? "Opening secure checkout…"
										: `Pay now · ${formatPrice(order.total, order.currency)}`}
								</Button>
								<p className="text-xs opacity-80">
									{gatewayMethodsLabel
										? `Pay by ${gatewayMethodsLabel} on `
										: "Pay in your banking or eWallet app on "}
									{order.storeName || "the store"}'s secure HitPay page — your
									order confirms automatically.
								</p>
								<button
									type="button"
									onClick={() => setClaimingPayment(true)}
									className="self-start text-sm font-medium underline-offset-2 hover:underline"
								>
									Paid by bank transfer instead? Tell the store
								</button>
							</>
						) : (
							<>
								<Button
									onClick={() => setClaimingPayment(true)}
									className="h-12 w-full text-base"
								>
									Pay now · {formatPrice(order.total, order.currency)}
								</Button>
								<p className="text-xs opacity-80">
									Bank transfer or QR — pay in your banking app, then attach the
									receipt so {order.storeName || "the store"} can confirm it.
								</p>
							</>
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

			{/* Unapplied online payment on an order whose payment card can't carry
			    the notice — cancelled (card hidden) or already claimed by hand. The
			    buyer's money moved either way, so the acknowledgement can't depend
			    on which card happens to render. */}
			{gatewayIssueStandalone && gatewayIssue
				? (() => {
						const copy = gatewayIssueCopy(
							gatewayIssue,
							order.storeName,
							order.total,
							order.currency,
						);
						return (
							<section className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
								<div className="flex items-center gap-3">
									<HandCoins className="size-5 shrink-0 text-amber-600" />
									<div className="min-w-0 flex-1">
										<p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
											Payment
										</p>
										<p className="font-semibold">{copy.heading}</p>
									</div>
								</div>
								<p className="text-xs opacity-80">{copy.body}</p>
								<GatewayIssueReference paymentId={gatewayIssue.paymentId} />
							</section>
						);
					})()
				: null}

			{/* Mockup approval — buyer reviews the seller's proof before production. */}
			{!isCancelled && order.mockupStatus !== undefined ? (
				<MockupReview token={token} order={order} />
			) : null}

			{/* Live collection rider (86eyg0n8e) — while a rider is actively on
			    the way to collect FROM this buyer. Reads the live job, so it
			    appears when the store books and vanishes when the trip ends —
			    deliberately a transient strip, not a status: the order's
			    lifecycle stays the seller's. */}
			{!isCancelled &&
			!order.collectionRider &&
			order.collectedAt !== undefined ? (
				<section className="mt-6 flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
					<Truck className="mt-0.5 size-5 shrink-0 text-accent" />
					<p className="text-sm text-foreground">
						{/* Provenance-neutral: `collectedAt` means "the goods are with
						    the seller", and the seller may have collected in person —
						    naming a rider would assert a trip that never happened. The
						    live strip below narrates the real trip when there is one. */}
						<span className="font-medium">Collected</span> — your items are with{" "}
						{order.storeName || "the store"}. They&apos;ll update this page as
						your order progresses.
					</p>
				</section>
			) : null}

			{!isCancelled && order.collectionRider ? (
				<section className="mt-6 flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent/5 p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Collection rider
					</p>
					<div className="flex items-start gap-3">
						<Truck className="mt-0.5 size-5 shrink-0 text-accent" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-foreground">
								{order.collectionRider.status === "assigning"
									? "Finding a rider to collect your items — this usually takes a few minutes."
									: order.collectionRider.status === "ongoing"
										? `${order.collectionRider.driverName ?? "Your rider"} is on the way to your address to collect.`
										: `Collected — your items are on the way to ${order.storeName || "the store"}.`}
							</p>
							{order.collectionRider.plateNumber &&
							order.collectionRider.status !== "picked_up" ? (
								<p className="mt-0.5 text-xs text-muted-foreground">
									Look for plate{" "}
									<span className="font-mono font-medium text-foreground">
										{order.collectionRider.plateNumber}
									</span>
									.
								</p>
							) : null}
						</div>
					</div>
					{isSafeTrackingUrl(order.collectionRider.shareLink) ? (
						<a
							href={order.collectionRider.shareLink}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-card px-4 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
						>
							Track your rider
							<ExternalLink className="size-3" />
						</a>
					) : null}
				</section>
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
							{/* label (+ the current stage's buyer-visible description) */}
							<div className="pb-6 pt-1">
								<p
									className={`text-sm font-medium ${node.isCurrent ? "text-foreground" : node.isDone ? "text-foreground/70" : "text-muted-foreground"}`}
								>
									{node.label}
								</p>
								{node.description ? (
									<p className="mt-0.5 text-xs text-muted-foreground">
										{node.description}
									</p>
								) : null}
							</div>
						</div>
					))}
				</div>
			) : null}

			{/* Shipment tracking — only for delivery orders. Courier + consignment
			    number render copyable even without a link (cold-chain couriers have
			    no public tracking page — the buyer pastes the number into the
			    courier's app/WhatsApp instead). The link is scheme-checked at the
			    href: write-time sanitize covers new values, but rows written before
			    it existed could hold a javascript:/data: URL, and this anchor is
			    the one buyer-facing surface where that would execute. */}
			{!isSelfCollect &&
			(order.courierName ||
				order.trackingNo ||
				isSafeTrackingUrl(order.carrierTrackingUrl)) ? (
				<div className="mt-6 flex flex-col gap-2">
					{order.courierName || order.trackingNo ? (
						<div className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-4">
							<div className="flex min-w-0 items-center gap-3">
								<Truck className="size-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									{order.courierName ? (
										<p className="truncate text-sm font-medium text-foreground">
											{order.courierName}
										</p>
									) : null}
									{order.trackingNo ? (
										<p className="truncate font-mono text-sm text-muted-foreground">
											{order.trackingNo}
										</p>
									) : null}
								</div>
							</div>
							{order.trackingNo ? (
								<CopyButton
									value={order.trackingNo}
									ariaLabel="Copy tracking number"
									successMessage="Tracking number copied"
								/>
							) : null}
						</div>
					) : null}
					{isSafeTrackingUrl(order.carrierTrackingUrl) ? (
						<a
							href={order.carrierTrackingUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
						>
							<Truck className="size-4" />
							Track with carrier
							<ExternalLink className="size-3" />
						</a>
					) : null}
				</div>
			) : null}

			{/* Rider drop-off photo (proof of delivery) — same shot the WhatsApp
			    delivered follow-up carried; only exists on delivered rider orders. */}
			{order.podImageUrls?.length ? (
				<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Delivery photo
					</p>
					<div className="flex flex-col gap-2">
						{order.podImageUrls.map((url) => (
							<a
								key={url}
								href={url}
								target="_blank"
								rel="noopener noreferrer"
								className="block overflow-hidden rounded-xl border border-border"
							>
								{/* Fixed-height frame (was max-h with auto height) so the
								    skeleton has a real box while a buyer on mobile data
								    waits for this to load. */}
								<AppImage
									src={url}
									alt="Proof of delivery"
									aspect="h-72 w-full"
								/>
							</a>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						Taken by your rider at drop-off.
					</p>
				</section>
			) : null}

			{/* The stay itself — a booking's equivalent of the address/pickup blocks.
			    Frozen at request (bookingCheckIn/Out never change after create). */}
			{isBooking &&
			order.bookingCheckIn !== undefined &&
			order.bookingCheckOut !== undefined ? (
				<section className="mt-6 flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						{ms ? "Penginapan anda" : "Your stay"}
					</p>
					<div className="flex flex-col gap-1.5 text-sm tabular-nums">
						<div className="flex items-baseline gap-1.5">
							<span className="font-medium">
								{ms ? "Daftar masuk" : "Check-in"}
							</span>
							<span className="flex-1 border-b-2 border-dotted border-border" />
							<span className="font-semibold">
								{formatFulfilmentDate(order.bookingCheckIn)}
							</span>
						</div>
						<div className="flex items-baseline gap-1.5">
							<span className="font-medium">
								{ms ? "Daftar keluar" : "Check-out"}
							</span>
							<span className="flex-1 border-b-2 border-dotted border-border" />
							<span className="font-semibold">
								{formatFulfilmentDate(order.bookingCheckOut)}
							</span>
						</div>
						<p className="text-xs text-muted-foreground">
							{Math.round(
								(order.bookingCheckOut - order.bookingCheckIn) / DAY_MS,
							)}{" "}
							{ms ? "malam" : "night(s)"} ·{" "}
							{order.items[0]?.name ?? (ms ? "penyenaraian" : "listing")}
						</p>
					</div>
				</section>
			) : null}

			{/* Pickup location — shown for self-collect orders that have a snapshot.
			    Reads the frozen snapshot (not the live pickupLocations row) so a
			    retailer edit after the order was placed never rewrites history. */}
			{isSelfCollect && order.pickupSnapshot ? (
				<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						{order.pickupSnapshot.locationType === "drop_off"
							? "Meet at"
							: "Pick up at"}
					</p>
					<div className="flex items-start gap-2">
						<MapPin
							className="size-4 shrink-0 text-accent mt-0.5"
							aria-hidden="true"
						/>
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<div className="flex flex-wrap items-center gap-2">
								<p className="text-sm font-semibold leading-tight">
									{order.pickupSnapshot.label}
								</p>
								<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
									{order.pickupSnapshot.locationType === "drop_off"
										? "Drop-off"
										: "Self-collect"}
								</span>
							</div>
							<p className="text-xs text-muted-foreground whitespace-pre-line">
								{order.pickupSnapshot.address}
							</p>
							{order.pickupSnapshot.scheduleNote ? (
								<p className="flex items-center gap-1 text-xs font-medium text-accent">
									<Clock className="size-3 shrink-0" aria-hidden="true" />
									<span className="line-clamp-2">
										{order.pickupSnapshot.scheduleNote}
									</span>
								</p>
							) : null}
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

			{/* Delivery address — shown for delivery orders that have an address.
			    Collection orders: this is where the rider collects FROM. */}
			{!isSelfCollect && order.deliveryAddress ? (
				<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
					<div className="flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							{isCollection ? "Collect from" : "Deliver to"}
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
								rel="noopener noreferrer"
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
				{isSelfCollect
					? order.pickupSnapshot?.locationType === "drop_off"
						? "Drop-off"
						: "Self Collect"
					: isCollection
						? "Collection from your address"
						: "Delivery"}
			</div>

			{/* Fulfilment date the buyer chose — reassures them the seller has it. */}
			{order.fulfilmentDate !== undefined ? (
				<div className="mt-2 flex items-center gap-2 rounded-xl bg-accent/5 px-3 py-2 text-sm font-medium text-foreground">
					<CalendarDays className="size-4 text-accent" />
					{isSelfCollect
						? order.pickupSnapshot?.locationType === "drop_off"
							? "Meet on "
							: "Collect on "
						: isCollection
							? order.collectedAt !== undefined
								? "Collected on "
								: "We collect on "
							: "Delivery on "}
					<span className="font-semibold">
						{formatFulfilmentDateTime(
							order.fulfilmentDate,
							order.fulfilmentTimeMinutes,
						)}
					</span>
				</div>
			) : null}

			<AddressEditDialog
				open={editingAddress}
				onClose={() => setEditingAddress(false)}
				token={token}
				currentAddress={order.deliveryAddress}
				retailerId={order.retailerId}
				subtotal={order.subtotal}
				fulfilmentDate={order.fulfilmentDate}
				fulfilmentTimeMinutes={order.fulfilmentTimeMinutes}
				collectsFromCustomer={isCollection}
			/>

			<ManualPaymentDialog
				open={claimingPayment}
				onClose={() => setClaimingPayment(false)}
				token={token}
				shortId={order.shortId}
				storeName={order.storeName || "the store"}
				methods={paymentMethods}
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
				{/* Frozen per-location pickup fee — its own line so the buyer can
				    reconcile the total against the item prices. Hidden when free. */}
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
				{/* Frozen delivery charge — same reconciliation rule as the pickup fee. */}
				{order.deliveryFee && order.deliveryFee > 0 ? (
					<div className="flex items-center justify-between px-3 text-sm text-muted-foreground">
						<span>{isCollection ? "Collection fee" : "Delivery fee"}</span>
						<span className="tabular-nums">
							{formatPrice(order.deliveryFee, order.currency)}
						</span>
					</div>
				) : null}
				{deliveryFeeHeld ? (
					<div className="flex items-center justify-between gap-3 px-3 text-sm text-muted-foreground">
						<span>Delivery charge</span>
						<span className="text-right">To be confirmed</span>
					</div>
				) : null}
				<div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-bold">
					<span>Total</span>
					<span className="tabular-nums">
						{formatPrice(order.total, order.currency)}
						{deliveryFeeHeld ? (
							<span className="font-medium text-muted-foreground">
								{" "}
								+ delivery
							</span>
						) : null}
					</span>
				</div>
				{deliveryFeeHeld ? (
					<p className="px-3 text-xs text-muted-foreground">
						Your address is outside the store&apos;s standard delivery zones —
						they&apos;ll confirm the delivery charge with you on WhatsApp and
						it&apos;ll be added to this total.
					</p>
				) : null}
				{/* Buyer self-serves a PDF receipt — generated on demand from this
				    order, no delivery/email needed. */}
				<ReceiptDownloadButton
					token={token}
					label="Download receipt (PDF)"
					variant="outline"
					className="w-full"
				/>
			</section>

			{/* Echo the shopper's note so they can confirm it was received. Plain
			    text, escaped by React; newlines preserved. Hidden when absent. */}
			{order.customerNote ? (
				<section className="mt-4 flex gap-3 rounded-2xl border border-border bg-card p-4">
					<StickyNote className="size-5 shrink-0 text-accent" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Your note
						</p>
						<p className="mt-1 whitespace-pre-line break-words text-sm">
							{order.customerNote}
						</p>
					</div>
				</section>
			) : null}

			{/* Contact the store directly. Buyers otherwise only ever hear from the
			    shared Kedaipal WABA — this opens a chat to the vendor's own number
			    with the order ref pre-filled. Hidden when the store has no number. */}
			{order.retailerWaPhone ? (
				<a
					href={`https://wa.me/${order.retailerWaPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
						order.retailerLocale === "ms"
							? `Hai ${order.storeName}, saya ada pertanyaan tentang pesanan ${order.shortId}.`
							: `Hi ${order.storeName}, I have a question about my order ${order.shortId}.`,
					)}`}
					target="_blank"
					rel="noopener noreferrer"
					className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
				>
					<MessageCircle className="size-4" />
					{order.retailerLocale === "ms"
						? `Hubungi ${order.storeName || "kedai"}`
						: `Message ${order.storeName || "the store"}`}
				</a>
			) : null}
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
		FunctionReturnType<typeof api.orders.get>
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
					rel="noopener noreferrer"
					className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/5"
				>
					<MapPin className="size-3.5 text-accent" aria-hidden="true" />
					Open in Waze
				</a>
				<a
					href={googleUrl}
					target="_blank"
					rel="noopener noreferrer"
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
				rel="noopener noreferrer"
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
				rel="noopener noreferrer"
				className="flex items-center gap-1.5 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
			>
				<ExternalLink className="size-3.5" />
				Open in maps
			</a>
		);
	}
	return null;
}

type TrackedOrder = NonNullable<FunctionReturnType<typeof api.orders.get>>;

/**
 * Fresh-arrival success state for the confirmation-push flow (86eyf1rck): the
 * order committed at checkout and Kedaipal's WABA pushed the confirmation —
 * there is nothing left for the buyer to send, so this card says exactly that
 * (and offers a plain open-WhatsApp anchor for buyers who want the chat now).
 * No auto-redirect anywhere on this path.
 */
function ConfirmationSentCard({
	ms,
	checkoutPhone,
}: {
	ms: boolean;
	checkoutPhone: string;
}) {
	return (
		<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
			<div className="flex items-center gap-3">
				<CheckCircle className="size-5 shrink-0 text-accent" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						{ms ? "Pesanan diterima" : "Order placed"}
					</p>
					<p className="font-semibold">
						{ms
							? "Pengesahan dihantar ke WhatsApp anda"
							: "Confirmation sent to your WhatsApp"}
					</p>
				</div>
			</div>
			<p className="text-sm text-muted-foreground">
				{ms
					? "Tak perlu hantar apa-apa — semak WhatsApp anda untuk pengesahan dan cara membayar. Halaman ini sentiasa menunjukkan status terkini pesanan anda."
					: "Nothing to send — check your WhatsApp for the confirmation and how to pay. This page always shows your order's latest status."}
			</p>
			<Button asChild variant="outline" className="h-11 w-full">
				<a
					href={`https://wa.me/${checkoutPhone}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					<MessageCircle className="size-4" />
					{ms ? "Buka WhatsApp" : "Open WhatsApp"}
				</a>
			</Button>
		</section>
	);
}

/**
 * Order committed but its price isn't final yet (86eyfq0w5) — a mockup quote
 * or an arranged delivery fee is outstanding, so the WhatsApp confirmation
 * (whose template states the total) deliberately waits. Say so, or the
 * checkout promise of "confirmation lands in your WhatsApp" looks broken.
 * The mockup/fee sections further down the page carry the actual next step.
 */
function PushDeferredCard({ ms }: { ms: boolean }) {
	return (
		<section className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
			<CheckCircle className="size-5 shrink-0 text-accent" />
			<div className="min-w-0 flex-1">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					{ms ? "Pesanan diterima" : "Order placed"}
				</p>
				<p className="text-sm">
					{ms
						? "Kami akan hantar pengesahan WhatsApp anda sebaik sahaja harga disahkan."
						: "We'll send your WhatsApp confirmation as soon as your price is confirmed."}
				</p>
			</div>
		</section>
	);
}

/**
 * Confirmation push in flight (86eyf1rck), including retries. Deliberately a
 * quiet line rather than a spinner-and-progress affair: the order is confirmed,
 * nothing is required of the buyer, and the only reason to mention it at all is
 * that checkout promised a WhatsApp message — so silence here would read as the
 * promise being broken.
 */
function PushSendingCard({
	ms,
	waPhone,
}: {
	ms: boolean;
	waPhone: string | undefined;
}) {
	const pretty = waPhone ? formatMyMobile(waPhone) : "";
	return (
		<section className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
			<Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					{ms ? "Pesanan diterima" : "Order placed"}
				</p>
				<p className="text-sm">
					{ms
						? `Menghantar pengesahan ke WhatsApp ${pretty}…`
						: `Sending your confirmation to ${pretty} on WhatsApp…`}
				</p>
			</div>
		</section>
	);
}

/**
 * The confirmation push gave up (86eyf1rck). Two very different truths behind
 * one status, so two very different asks:
 *
 *  - `unreachable` — the number can't receive WhatsApp (typo'd, no account).
 *    Only the buyer can fix that, so the primary action is **editing the
 *    number**, which re-sends immediately. The wa.me send stays as a quiet
 *    secondary route (it also repairs the number, via the inbound path).
 *  - `system` — Meta or us. The buyer's number is fine and asking them to do
 *    anything would be passing our failure to them, so this state only informs.
 *
 * Amber, not the accent palette: this is a warning, and an earlier revision
 * rendered it in the mint success colour, which read as "all good".
 * Crucially it does NOT gate the page — the order is confirmed and the payment
 * block below stays reachable. Withholding a buyer's receipt because we
 * couldn't send a message would invert the whole point of the feature.
 */
function PushFailedCard({
	token,
	order,
}: {
	token: string;
	order: TrackedOrder;
}) {
	const ms = order.retailerLocale === "ms";
	const storeName = order.storeName || (ms ? "kedai" : "the store");
	const unreachable = order.confirmationPushFailureKind !== "system";
	const pretty = order.customer.waPhone
		? formatMyMobile(order.customer.waPhone)
		: "";
	const updatePhone = useMutation(api.orders.updateBuyerPhone);
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	// Focus on open rather than autoFocus: the field only mounts when the buyer
	// taps "Update my number", so this is a response to their action, not a
	// page-load surprise. One-shot — a callback ref would re-fire every keystroke.
	const phoneInputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (editing) phoneInputRef.current?.focus();
	}, [editing]);

	async function handleSave(e: FormEvent) {
		e.preventDefault();
		setBusy(true);
		try {
			await updatePhone({ token, waPhone: value.trim() });
			toast.success(
				ms
					? "Nombor dikemas kini — pengesahan sedang dihantar"
					: "Number updated — sending your confirmation now",
			);
			setEditing(false);
			setValue("");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/50">
			<div className="flex items-center gap-3">
				<MessageCircle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">
						{ms ? "Pesanan diterima" : "Order placed"}
					</p>
					<p className="font-semibold text-amber-950 dark:text-amber-100">
						{unreachable
							? ms
								? "Pengesahan WhatsApp tak sampai"
								: "Your WhatsApp confirmation didn't arrive"
							: ms
								? "Pengesahan WhatsApp tertunda"
								: "Your WhatsApp confirmation is delayed"}
					</p>
				</div>
			</div>
			<p className="text-sm text-amber-950/90 dark:text-amber-100/90">
				{unreachable
					? ms
						? `Kami tak dapat hantar ke ${pretty} — nombor itu mungkin tersilap taip atau tiada WhatsApp. Pesanan anda tetap disahkan dan butiran di bawah adalah muktamad.`
						: `We couldn't deliver it to ${pretty} — that number may have a typo, or no WhatsApp account. Your order is still confirmed and everything below is final.`
					: ms
						? `Masalah di pihak kami, bukan nombor anda. Pesanan anda telah disahkan dan ${storeName} sudah menerimanya — anda masih boleh membayar di bawah.`
						: `That's a problem on our side, not with your number. Your order is confirmed and ${storeName} already has it — you can still pay below.`}
			</p>

			{unreachable ? (
				editing ? (
					<form onSubmit={handleSave} className="flex flex-col gap-2">
						<label
							htmlFor="repair-wa-phone"
							className="text-xs font-medium text-amber-950 dark:text-amber-100"
						>
							{ms ? "Nombor WhatsApp anda" : "Your WhatsApp number"}
						</label>
						{/* Same plated control as the storefront checkout field this is
						    repairing — the buyer has already met it once, and it's the
						    only shape `assertValidMyMobile` behind it accepts. Its own
						    neutral chrome inside the amber card, so the control reads as
						    a control and not as part of the warning. */}
						<MyPhoneInput
							id="repair-wa-phone"
							ref={phoneInputRef}
							value={value}
							onChange={setValue}
							className="bg-white dark:bg-amber-950"
						/>
						<div className="flex gap-2">
							<Button
								type="submit"
								isLoading={busy}
								disabled={busy || value.trim().length === 0}
								className="h-11 flex-1"
							>
								{ms ? "Simpan & hantar" : "Save & resend"}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => setEditing(false)}
								disabled={busy}
								className="h-11"
							>
								{ms ? "Batal" : "Cancel"}
							</Button>
						</div>
					</form>
				) : (
					<Button
						type="button"
						onClick={() => {
							setValue("");
							setEditing(true);
						}}
						className="h-12 w-full text-base"
					>
						{ms ? "Kemas kini nombor" : "Update my number"}
					</Button>
				)
			) : null}

			{/* Secondary route, kept because it also repairs the number (the inbound
			    ORD message relinks the sender) and costs nothing to offer. Never the
			    primary ask — that would make our delivery problem the buyer's job. */}
			{order.checkoutPhone ? (
				<a
					href={`https://wa.me/${order.checkoutPhone}`}
					target="_blank"
					rel="noopener noreferrer"
					className="text-center text-xs font-medium text-amber-800 underline dark:text-amber-300"
				>
					{ms
						? "Atau mesej kami di WhatsApp"
						: "Or message us on WhatsApp instead"}
				</a>
			) : null}
		</section>
	);
}

/**
 * "Send your order on WhatsApp" — completes the storefront checkout handoff.
 * The wa.me message is rebuilt from the order's frozen snapshot on every
 * render, so this survives refreshes and lost sessions (no client state to
 * lose). The anchor is a real user gesture, so popup blockers never eat it;
 * the copy-link row is the belt-and-braces fallback for webviews that refuse
 * to open WhatsApp at all.
 *
 * `autoSend` (fresh arrival from checkout, ?send=1): the button starts in a
 * loading state and we same-tab navigate to wa.me after a short paint delay —
 * same-tab navigation is never popup-blocked, so desktop keeps its old
 * "one click → WhatsApp" feel and mobile finally gets it. If we're still on
 * the page after the watchdog (webview refused) — or the buyer comes back
 * from WhatsApp (pageshow/visibilitychange) — loading settles back to the
 * manual button + copy-link fallback.
 */
function SendOrderCard({
	order,
	checkoutPhone,
	autoSend,
	onAutoSendConsumed,
}: {
	order: TrackedOrder;
	checkoutPhone: string;
	autoSend: boolean;
	onAutoSendConsumed: () => void;
}) {
	const ms = order.retailerLocale === "ms";
	const storeName = order.storeName || (ms ? "kedai" : "the store");
	const message = buildOrderWaMessage({
		shortId: order.shortId,
		storeName: order.storeName,
		items: order.items,
		currency: order.currency,
		total: order.total,
		pickupFee: order.pickupFee,
		deliveryFee: order.deliveryFee,
		deliveryFeePending: order.deliveryFeePending,
		deliveryMethod: order.deliveryMethod,
		deliveryDirection: order.deliveryDirection,
		deliveryAddress: order.deliveryAddress,
		pickupSnapshot: order.pickupSnapshot,
		fulfilmentDate: order.fulfilmentDate,
		fulfilmentTimeMinutes: order.fulfilmentTimeMinutes,
		customerNote: order.customerNote,
		quotePending:
			order.mockupStatus !== undefined &&
			order.mockupStatus !== "approved" &&
			order.mockupWaivedAt == null,
	});
	const waUrl = waOrderUrl(checkoutPhone, message);
	// Inside WhatsApp's own in-app browser the wa.me auto-redirect hits a
	// "Continue to chat" interstitial + open-app prompt while the buyer is
	// ALREADY in WhatsApp — most bail there. Skip the auto-fire entirely and
	// render the manual button (a deliberate tap survives the interstitial far
	// better than a surprise redirect). Mount-only read: the UA can't change.
	const [inWaWebview] = useState(
		() =>
			typeof navigator !== "undefined" &&
			isWhatsAppWebview(navigator.userAgent),
	);
	const [sending, setSending] = useState(autoSend && !inWaWebview);

	// Auto-fire the handoff exactly once per checkout arrival. Mount-only by
	// design: `autoSend` is fixed at mount (the search param is stripped before
	// we leave) and `waUrl` is built from the order's frozen snapshot.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only auto-attempt, see above
	useEffect(() => {
		if (!autoSend) return;
		// Consume ?send=1 even when skipping (WA webview), so refresh/back
		// lands on a plain tracking URL either way.
		onAutoSendConsumed();
		if (inWaWebview) return;
		const ctrl = createWaAutoOpen({
			openUrl: () => window.location.assign(waUrl),
			onSettled: () => setSending(false),
		});
		// Returning from WhatsApp must never leave the button stuck loading:
		// bfcache restore fires pageshow (persisted only — the initial load's
		// pageshow can land after hydration and must not abort the attempt);
		// the app-switch round trip (wa.me's whatsapp:// hop) fires
		// visibilitychange back to visible.
		const onPageShow = (e: PageTransitionEvent) => {
			if (e.persisted) ctrl.settle();
		};
		const onVisibility = () => {
			if (!document.hidden) ctrl.settle();
		};
		window.addEventListener("pageshow", onPageShow);
		document.addEventListener("visibilitychange", onVisibility);
		ctrl.start();
		return () => {
			ctrl.cancel();
			window.removeEventListener("pageshow", onPageShow);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	return (
		<section className="mt-6 flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
			<div className="flex items-center gap-3">
				<Send className="size-5 shrink-0 text-accent" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						{ms ? "Satu langkah lagi" : "One last step"}
					</p>
					<p className="font-semibold">
						{ms
							? "Hantar pesanan anda di WhatsApp"
							: "Send your order on WhatsApp"}
					</p>
				</div>
			</div>
			<p className="text-sm text-muted-foreground">
				{ms
					? `Pesanan anda telah disimpan. Hantar di WhatsApp supaya ${storeName} boleh sahkan pesanan dan hubungi anda.`
					: `Your order is saved. Send it on WhatsApp so ${storeName} can confirm it and reach you.`}
			</p>
			{sending ? (
				<Button className="h-12 w-full text-base" disabled>
					<Loader2 className="size-5 animate-spin" />
					{ms ? "Membuka WhatsApp…" : "Opening WhatsApp…"}
				</Button>
			) : (
				<Button asChild className="h-12 w-full text-base">
					<a href={waUrl} target="_blank" rel="noopener noreferrer">
						<MessageCircle className="size-5" />
						{ms ? "Hantar di WhatsApp" : "Send on WhatsApp"}
					</a>
				</Button>
			)}
			{inWaWebview ? (
				// WA in-app browser: a wa.me link is exactly what just failed to open,
				// so the fallback copies the MESSAGE BODY — the buyer pastes it
				// straight into the store's chat they came from.
				<div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
					<p className="text-xs text-muted-foreground">
						{ms
							? "Butang tak berfungsi? Salin mesej pesanan dan tampal terus dalam chat WhatsApp."
							: "Button not working? Copy your order message and paste it into the WhatsApp chat."}
					</p>
					<CopyButton
						value={message}
						ariaLabel={ms ? "Salin mesej pesanan" : "Copy order message"}
						successMessage={
							ms ? "Mesej pesanan disalin" : "Order message copied"
						}
					/>
				</div>
			) : (
				<div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
					<p className="text-xs text-muted-foreground">
						{ms
							? "WhatsApp tak terbuka? Salin pautan dan buka dalam pelayar anda."
							: "WhatsApp didn't open? Copy the link and open it in your browser."}
					</p>
					<CopyButton
						value={waUrl}
						ariaLabel={ms ? "Salin pautan WhatsApp" : "Copy WhatsApp link"}
						successMessage={
							ms ? "Pautan WhatsApp disalin" : "WhatsApp link copied"
						}
					/>
				</div>
			)}
		</section>
	);
}

/** Buyer-facing mockup review: approve or request changes on the seller's proof. */
function MockupReview({
	token,
	order,
}: {
	token: string;
	order: TrackedOrder;
}) {
	const approve = useMutation(api.orders.approveMockup);
	const requestChanges = useMutation(api.orders.requestMockupChanges);
	const declineItem = useMutation(api.orders.declineMockupItem);
	const mockupUrls = useQuery(
		convexQuery(api.orders.getMockupUrls, { token }),
	).data;
	const [note, setNote] = useState("");
	const [showNote, setShowNote] = useState(false);
	const [confirmDecline, setConfirmDecline] = useState(false);
	const [busy, setBusy] = useState(false);

	const status = order.mockupStatus;
	const quoted = order.mockupQuotedAmount;

	async function handleApprove() {
		setBusy(true);
		try {
			await approve({ token });
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
			await declineItem({ token });
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
			await requestChanges({ token, note: note.trim() || undefined });
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

			{mockupUrls && mockupUrls.length > 0 ? (
				mockupUrls.length === 1 ? (
					<ZoomableImage
						src={mockupUrls[0]}
						alt="Your mockup"
						caption="Your mockup"
						wrapperClassName="block w-full overflow-hidden rounded-xl border border-border bg-white"
						className="block max-h-72 w-full object-contain"
					/>
				) : (
					<div className="grid grid-cols-2 gap-2">
						{mockupUrls.map((url, i) => (
							<ZoomableImage
								key={url}
								src={url}
								alt={`Your mockup ${i + 1}`}
								caption={`Your mockup ${i + 1}`}
								wrapperClassName="block w-full overflow-hidden rounded-xl border border-border bg-white"
								className="block aspect-square w-full object-cover"
							/>
						))}
					</div>
				)
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
