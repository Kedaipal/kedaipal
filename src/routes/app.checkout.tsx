import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowLeft,
	BadgeCheck,
	Banknote,
	CheckCircle2,
	ChevronDown,
	Clock,
	Minus,
	Plus,
	QrCode,
	Search,
	UserCheck,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../convex/lib/paymentMethod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { convexErrorMessage, formatPrice } from "../lib/format";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/app/checkout")({
	head: () => ({ meta: [{ title: "Counter Checkout — Kedaipal" }] }),
	component: CounterCheckoutRoute,
});

type SessionId = Id<"counterCheckoutSessions">;

function CounterCheckoutRoute() {
	const retailer = useQuery(api.retailers.getMyRetailer);
	const [sessionId, setSessionId] = useState<SessionId | null>(null);
	const [created, setCreated] = useState<{ shortId: string } | null>(null);

	const createSession = useMutation(api.counterCheckout.createCheckoutSession);
	const cancelSession = useMutation(api.counterCheckout.cancelCheckoutSession);
	const session = useQuery(
		api.counterCheckout.getCheckoutSession,
		sessionId ? { sessionId } : "skip",
	);

	async function start() {
		setCreated(null);
		try {
			const r = await createSession({});
			setSessionId(r.sessionId);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	function reset() {
		setSessionId(null);
		setCreated(null);
	}

	return (
		<div className="flex flex-col gap-6">
			<header className="flex items-center justify-between gap-3 border-b border-border pb-4">
				<div className="flex items-center gap-3">
					<span className="flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
						<QrCode className="size-5" />
					</span>
					<div>
						<h1 className="text-xl font-bold tracking-tight">
							Counter Checkout
						</h1>
						<p className="text-sm text-muted-foreground">
							Take an in-person order — connected to WhatsApp.
						</p>
					</div>
				</div>
				{sessionId ? (
					<button
						type="button"
						onClick={reset}
						className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
					>
						<ArrowLeft className="size-4" />
						Close
					</button>
				) : null}
			</header>

			{!sessionId ? (
				<StartScreen onStart={start} />
			) : session === undefined ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : session === null ? (
				<StartScreen onStart={start} />
			) : created || session.status === "completed" ? (
				<DoneScreen
					shortId={created?.shortId}
					orderId={session.orderId}
					onNew={start}
				/>
			) : session.status === "awaiting_buyer" ? (
				<AwaitingScreen
					waUrl={session.waUrl}
					token={session.token}
					expiresAt={session.expiresAt}
					onCancel={async () => {
						if (sessionId) await cancelSession({ sessionId });
						reset();
					}}
				/>
			) : session.status === "buyer_identified" ? (
				retailer ? (
					<BuildOrderScreen
						retailerId={retailer._id}
						sessionId={sessionId as SessionId}
						buyer={{
							displayName: session.displayName,
							waPhone: session.waPhone,
							isNewCustomer: session.isNewCustomer,
							customer: session.customer,
						}}
						currency={retailer.currency ?? "MYR"}
						onCreated={(shortId) => setCreated({ shortId })}
					/>
				) : null
			) : (
				<ExpiredScreen onRestart={start} />
			)}
		</div>
	);
}

function StartScreen({ onStart }: { onStart: () => void }) {
	return (
		<div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card px-6 py-12 text-center">
			<span className="flex size-16 items-center justify-center rounded-2xl bg-accent/12 text-accent">
				<QrCode className="size-8" />
			</span>
			<div className="max-w-sm">
				<h2 className="text-lg font-semibold">Start a counter checkout</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					We'll show a QR for the buyer to scan with WhatsApp. Once they scan,
					you'll see who they are and can key in their order.
				</p>
			</div>
			<Button onClick={onStart} className="h-12 px-8 text-base">
				Start checkout
			</Button>
		</div>
	);
}

function ExpiryCountdown({ expiresAt }: { expiresAt: number }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	const remaining = Math.max(0, expiresAt - now);
	const mins = Math.floor(remaining / 60000);
	const secs = Math.floor((remaining % 60000) / 1000);
	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
			<Clock className="size-3.5" />
			Expires in {mins}:{secs.toString().padStart(2, "0")}
		</span>
	);
}

function AwaitingScreen({
	waUrl,
	token,
	expiresAt,
	onCancel,
}: {
	waUrl: string | undefined;
	token: string;
	expiresAt: number;
	onCancel: () => void;
}) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-border bg-card px-6 py-8 text-center">
			<div className="flex flex-col items-center gap-1">
				<h2 className="text-lg font-semibold">Ask the buyer to scan</h2>
				<p className="text-sm text-muted-foreground">
					They open WhatsApp's camera, scan, and hit send. This screen updates
					the moment they do.
				</p>
			</div>

			{waUrl ? (
				<div className="rounded-2xl border border-border bg-white p-4">
					<QRCode value={waUrl} size={220} />
				</div>
			) : (
				<div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
					WhatsApp checkout number isn't configured for this deployment. Contact
					support to enable Counter Checkout.
				</div>
			)}

			<div className="flex items-center gap-2">
				<span className="inline-flex size-2 animate-pulse rounded-full bg-accent" />
				<span className="text-sm font-medium">Waiting for buyer…</span>
			</div>
			<ExpiryCountdown expiresAt={expiresAt} />

			<p className="font-mono text-[11px] text-muted-foreground">KP-{token}</p>

			<button
				type="button"
				onClick={onCancel}
				className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
			>
				Cancel
			</button>
		</div>
	);
}

function ExpiredScreen({ onRestart }: { onRestart: () => void }) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center">
			<Clock className="size-10 text-muted-foreground" />
			<div>
				<h2 className="text-lg font-semibold">Checkout expired</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					No one scanned in time. Start a fresh one to show a new QR.
				</p>
			</div>
			<Button onClick={onRestart} className="h-11 px-6">
				Start new checkout
			</Button>
		</div>
	);
}

function DoneScreen({
	shortId,
	orderId,
	onNew,
}: {
	shortId: string | undefined;
	orderId: Id<"orders"> | undefined;
	onNew: () => void;
}) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center">
			<CheckCircle2 className="size-12 text-emerald-600" />
			<div>
				<h2 className="text-lg font-semibold text-emerald-900">
					Order created
				</h2>
				<p className="mt-1 text-sm text-emerald-800">
					{shortId ? (
						<>
							Order <span className="font-mono font-semibold">{shortId}</span>{" "}
							is confirmed and a WhatsApp confirmation was sent to the buyer.
						</>
					) : (
						"The order is confirmed and the buyer has been notified on WhatsApp."
					)}
				</p>
			</div>
			<div className="flex w-full flex-col gap-2">
				<Button onClick={onNew} className="h-11">
					New checkout
				</Button>
				{shortId ? (
					<Link
						to="/app/orders/$shortId"
						params={{ shortId }}
						className="text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
					>
						View order
					</Link>
				) : orderId ? (
					<Link
						to="/app/orders"
						className="text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
					>
						Go to orders
					</Link>
				) : null}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Build order (buyer bound) — catalog search → cart → pay → create
// ---------------------------------------------------------------------------

type CartLine = { name: string; label: string; price: number; qty: number };

function BuildOrderScreen({
	retailerId,
	sessionId,
	buyer,
	currency,
	onCreated,
}: {
	retailerId: Id<"retailers">;
	sessionId: SessionId;
	buyer: {
		displayName: string | undefined;
		waPhone: string | undefined;
		isNewCustomer: boolean | undefined;
		customer: {
			orderCount: number;
			totalSpent: number;
			lastOrderAt: number;
		} | null;
	};
	currency: string;
	onCreated: (shortId: string) => void;
}) {
	const products = useQuery(api.products.list, { retailerId });
	const createOrder = useMutation(api.counterCheckout.createOrderFromSession);
	const [query, setQuery] = useState("");
	const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [paidInPerson, setPaidInPerson] = useState(true);
	const [method, setMethod] = useState<OrderPaymentMethod>("cash");
	const [submitting, setSubmitting] = useState(false);

	const isSearching = query.trim().length > 0;
	const filtered = useMemo(() => {
		if (!products) return [];
		const q = query.trim().toLowerCase();
		return products
			.map((p) => ({
				...p,
				// Exclude mockup-gated (requiresProof) + custom variants — Counter
				// Checkout V1 can't sell items that need buyer design approval (the
				// server rejects them too). `requiresProof` is resolved per-variant
				// by products.list (vr.requiresProof ?? product.requiresProof).
				variants: p.variants.filter(
					(vr) => !vr.isCustom && !vr.requiresProof && vr.active,
				),
			}))
			.filter((p) => p.variants.length > 0)
			.filter((p) => {
				if (!q) return true;
				if (p.name.toLowerCase().includes(q)) return true;
				// Match on variant labels too (e.g. "large", "1kg / cherry").
				return p.variants.some((vr) =>
					vr.optionValues.join(" / ").toLowerCase().includes(q),
				);
			});
	}, [products, query]);

	function toggleExpanded(productId: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(productId)) next.delete(productId);
			else next.add(productId);
			return next;
		});
	}

	function setQty(variantId: string, line: CartLine, qty: number) {
		setCart((prev) => {
			const next = new Map(prev);
			if (qty <= 0) next.delete(variantId);
			else next.set(variantId, { ...line, qty });
			return next;
		});
	}

	const cartEntries = [...cart.entries()];
	const total = cartEntries.reduce((s, [, l]) => s + l.price * l.qty, 0);

	async function submit() {
		if (cartEntries.length === 0) return;
		setSubmitting(true);
		try {
			const { shortId } = await createOrder({
				sessionId,
				items: cartEntries.map(([variantId, l]) => ({
					variantId: variantId as Id<"productVariants">,
					quantity: l.qty,
				})),
				paidInPerson,
				paymentMethod: paidInPerson ? method : undefined,
			});
			onCreated(shortId);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="grid gap-6 lg:grid-cols-[1fr_360px]">
			{/* Catalog */}
			<div className="flex flex-col gap-4">
				<BuyerCard buyer={buyer} currency={currency} />

				<div className="relative">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search products or variants…"
						variant="field"
						className="h-12 pl-9"
					/>
				</div>

				<div className="flex flex-col gap-3">
					{products === undefined ? (
						<p className="text-sm text-muted-foreground">Loading catalog…</p>
					) : filtered.length === 0 ? (
						<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
							No matching products.
						</p>
					) : (
						filtered.map((p) => {
							const open = isSearching || expanded.has(p._id);
							const cartQty = p.variants.reduce(
								(s, vr) => s + (cart.get(vr._id)?.qty ?? 0),
								0,
							);
							const priceLabel =
								p.priceFrom === p.priceTo
									? formatPrice(p.priceFrom, currency)
									: `from ${formatPrice(p.priceFrom, currency)}`;
							return (
								<div
									key={p._id}
									className="rounded-2xl border border-border bg-card"
								>
									<button
										type="button"
										onClick={() => toggleExpanded(p._id)}
										className="flex w-full items-center justify-between gap-3 p-3 text-left"
									>
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold">{p.name}</p>
											<p className="text-xs text-muted-foreground">
												{p.variants.length} option
												{p.variants.length === 1 ? "" : "s"} · {priceLabel}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											{cartQty > 0 ? (
												<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold leading-none text-accent-foreground">
													{cartQty}
												</span>
											) : null}
											<ChevronDown
												className={cn(
													"size-4 text-muted-foreground transition-transform",
													open && "rotate-180",
												)}
											/>
										</div>
									</button>
									{open ? (
										<div className="flex flex-col divide-y divide-border border-t border-border px-3 pb-1">
											{p.variants.map((vr) => {
												const label =
													vr.optionValues.length > 0
														? vr.optionValues.join(" / ")
														: "";
												const inCart = cart.get(vr._id);
												return (
													<div
														key={vr._id}
														className="flex items-center justify-between gap-3 py-2"
													>
														<div className="min-w-0">
															<p className="truncate text-sm">
																{label || "Default"}
															</p>
															<p className="text-xs text-muted-foreground">
																{formatPrice(vr.price, currency)}
																{vr.blockWhenOutOfStock
																	? ` · ${vr.onHand} left`
																	: ""}
															</p>
														</div>
														{inCart ? (
															<Stepper
																qty={inCart.qty}
																onChange={(q) => setQty(vr._id, inCart, q)}
															/>
														) : (
															<Button
																variant="secondary"
																onClick={() =>
																	setQty(
																		vr._id,
																		{
																			name: p.name,
																			label,
																			price: vr.price,
																			qty: 0,
																		},
																		1,
																	)
																}
																className="h-11 px-3"
															>
																<Plus className="size-4" />
																Add
															</Button>
														)}
													</div>
												);
											})}
										</div>
									) : null}
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Cart / checkout */}
			<div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
				<div className="rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Order
					</p>
					{cartEntries.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">
							Tap products to add them.
						</p>
					) : (
						<ul className="mt-3 flex flex-col divide-y divide-border">
							{cartEntries.map(([variantId, l]) => (
								<li
									key={variantId}
									className="flex items-center justify-between gap-3 py-2.5"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">
											{l.name}
											{l.label ? (
												<span className="ml-1 font-normal text-muted-foreground">
													{l.label}
												</span>
											) : null}
										</p>
										<p className="text-xs text-muted-foreground">
											{l.qty} × {formatPrice(l.price, currency)}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-sm font-semibold tabular-nums">
											{formatPrice(l.price * l.qty, currency)}
										</span>
										<button
											type="button"
											onClick={() => setQty(variantId, l, 0)}
											aria-label="Remove"
											className="text-muted-foreground hover:text-destructive"
										>
											<X className="size-4" />
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
					<div className="mt-3 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-bold">
						<span>Total</span>
						<span className="tabular-nums">{formatPrice(total, currency)}</span>
					</div>
				</div>

				{/* Payment */}
				<div className="rounded-2xl border border-border bg-card p-4">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Payment
					</p>
					<div className="mt-3 grid grid-cols-2 gap-2">
						<PayToggle
							active={paidInPerson}
							onClick={() => setPaidInPerson(true)}
							icon={<Banknote className="size-4" />}
							label="Paid now"
						/>
						<PayToggle
							active={!paidInPerson}
							onClick={() => setPaidInPerson(false)}
							icon={<Clock className="size-4" />}
							label="Pay later"
						/>
					</div>
					{paidInPerson ? (
						<div className="mt-2 grid grid-cols-3 gap-2">
							{ORDER_PAYMENT_METHODS.map((m) => (
								<MethodToggle
									key={m}
									active={method === m}
									onClick={() => setMethod(m)}
									label={PAYMENT_METHOD_LABELS[m]}
								/>
							))}
						</div>
					) : (
						<p className="mt-2 text-xs text-muted-foreground">
							The buyer gets a WhatsApp link to pay & track their order.
						</p>
					)}
				</div>

				<Button
					onClick={submit}
					disabled={cartEntries.length === 0 || submitting}
					isLoading={submitting}
					className="h-12 w-full text-base"
				>
					{submitting
						? "Creating…"
						: `Create order · ${formatPrice(total, currency)}`}
				</Button>
			</div>
		</div>
	);
}

function BuyerCard({
	buyer,
	currency,
}: {
	buyer: {
		displayName: string | undefined;
		isNewCustomer: boolean | undefined;
		customer: {
			orderCount: number;
			totalSpent: number;
			lastOrderAt: number;
		} | null;
	};
	currency: string;
}) {
	return (
		<div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4">
			<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
				<UserCheck className="size-5" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate font-semibold">
					{buyer.displayName ?? "Buyer connected"}
				</p>
				{buyer.isNewCustomer ? (
					<p className="text-xs font-medium text-accent">New customer</p>
				) : buyer.customer ? (
					<p className="text-xs text-muted-foreground">
						Returning · {buyer.customer.orderCount} orders ·{" "}
						{formatPrice(buyer.customer.totalSpent, currency)} lifetime
					</p>
				) : (
					<p className="text-xs text-muted-foreground">Connected</p>
				)}
			</div>
			<BadgeCheck className="size-5 shrink-0 text-accent" />
		</div>
	);
}

function Stepper({
	qty,
	onChange,
}: {
	qty: number;
	onChange: (qty: number) => void;
}) {
	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				onClick={() => onChange(qty - 1)}
				aria-label="Decrease"
				className="flex size-11 items-center justify-center rounded-lg border border-border hover:bg-muted"
			>
				<Minus className="size-4" />
			</button>
			<span className="w-7 text-center text-sm font-semibold tabular-nums">
				{qty}
			</span>
			<button
				type="button"
				onClick={() => onChange(qty + 1)}
				aria-label="Increase"
				className="flex size-11 items-center justify-center rounded-lg border border-border hover:bg-muted"
			>
				<Plus className="size-4" />
			</button>
		</div>
	);
}

function PayToggle({
	active,
	onClick,
	icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors ${
				active
					? "border-accent bg-accent/10 text-foreground"
					: "border-border text-muted-foreground hover:bg-muted"
			}`}
		>
			{icon}
			{label}
		</button>
	);
}

function MethodToggle({
	active,
	onClick,
	label,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`h-11 rounded-xl border text-sm font-medium transition-colors ${
				active
					? "border-accent bg-accent/10 text-foreground"
					: "border-border text-muted-foreground hover:bg-muted"
			}`}
		>
			{label}
		</button>
	);
}
