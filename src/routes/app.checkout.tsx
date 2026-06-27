import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowLeft,
	BadgeCheck,
	Banknote,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Minus,
	Plus,
	QrCode,
	Search,
	Trash2,
	UserCheck,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	fulfilmentDateBounds,
	mytMidnightFromYmd,
	ymdFromEpoch,
} from "../../convex/lib/fulfilmentDate";
import {
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../convex/lib/paymentMethod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useDebounce } from "../hooks/useDebounce";
import { convexErrorMessage, formatPrice } from "../lib/format";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/app/checkout")({
	head: () => ({ meta: [{ title: "Counter Checkout — Kedaipal" }] }),
	// The active checkout lives in the URL so a refresh / reconnect lands the
	// vendor right back on it instead of losing the order.
	validateSearch: (search: Record<string, unknown>): { session?: string } => ({
		session: typeof search.session === "string" ? search.session : undefined,
	}),
	component: CounterCheckoutRoute,
});

type SessionId = Id<"counterCheckoutSessions">;

// Surfaced to the vendor so they know where abandoned open checkouts go. Keep in
// sync with OPEN_SESSION_TTL_MS in convex/counterCheckout.ts (3 days).
const OPEN_CHECKOUT_TTL_DAYS = 3;

type CreatedOrder = {
	shortId: string;
	orderId: Id<"orders">;
	paidInPerson: boolean;
};

function CounterCheckoutRoute() {
	const retailer = useQuery(api.retailers.getMyRetailer);
	const { session: activeSessionId } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [created, setCreated] = useState<CreatedOrder | null>(null);

	const createSession = useMutation(api.counterCheckout.createCheckoutSession);
	const cancelSession = useMutation(api.counterCheckout.cancelCheckoutSession);

	const openSession = (id: string) => navigate({ search: { session: id } });
	const backToList = () => navigate({ search: {} });

	// Drop a finished order's done-screen state whenever the active checkout
	// changes (resumed another, or went back to the list).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset trigger only.
	useEffect(() => {
		setCreated(null);
	}, [activeSessionId]);

	async function start() {
		try {
			const r = await createSession({});
			openSession(r.sessionId);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	async function cancel(id: string) {
		try {
			await cancelSession({ sessionId: id as SessionId });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
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
				{activeSessionId ? (
					<button
						type="button"
						onClick={backToList}
						className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
					>
						<ArrowLeft className="size-4" />
						All checkouts
					</button>
				) : null}
			</header>

			{activeSessionId ? (
				<ActiveSession
					key={activeSessionId}
					sessionId={activeSessionId as SessionId}
					retailer={retailer}
					created={created}
					onCreated={setCreated}
					onStartNew={start}
					onBackToList={backToList}
					onCancelActive={async () => {
						await cancel(activeSessionId);
						backToList();
					}}
				/>
			) : (
				<OpenCheckoutsList
					onStart={start}
					onResume={openSession}
					onCancel={cancel}
				/>
			)}
		</div>
	);
}

/** Renders the screen for the one checkout the vendor is currently on. */
function ActiveSession({
	sessionId,
	retailer,
	created,
	onCreated,
	onStartNew,
	onBackToList,
	onCancelActive,
}: {
	sessionId: SessionId;
	retailer: ReturnType<typeof useQuery<typeof api.retailers.getMyRetailer>>;
	created: CreatedOrder | null;
	onCreated: (c: CreatedOrder) => void;
	onStartNew: () => void;
	onBackToList: () => void;
	onCancelActive: () => void;
}) {
	const session = useQuery(api.counterCheckout.getCheckoutSession, {
		sessionId,
	});

	if (session === undefined)
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	// The session was cancelled / swept away while we were off the page.
	if (session === null) return <MissingSession onBack={onBackToList} />;

	if (created || session.status === "completed")
		return (
			<DoneScreen
				shortId={created?.shortId}
				orderId={created?.orderId ?? session.orderId}
				paidInPerson={created?.paidInPerson ?? false}
				onNew={onStartNew}
				onBackToList={onBackToList}
			/>
		);

	if (session.status === "awaiting_buyer")
		return (
			<AwaitingScreen
				waUrl={session.waUrl}
				token={session.token}
				expiresAt={session.expiresAt}
				onCancel={onCancelActive}
			/>
		);

	if (session.status === "buyer_identified")
		return retailer ? (
			<BuildOrderScreen
				retailerId={retailer._id}
				sessionId={sessionId}
				buyer={{
					displayName: session.displayName,
					waPhone: session.waPhone,
					isNewCustomer: session.isNewCustomer,
					customer: session.customer,
				}}
				currency={retailer.currency ?? "MYR"}
				draft={session.draft}
				onCreated={onCreated}
			/>
		) : null;

	// expired / cancelled
	return <ExpiredScreen onRestart={onStartNew} onBackToList={onBackToList} />;
}

function MissingSession({ onBack }: { onBack: () => void }) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center">
			<Clock className="size-10 text-muted-foreground" />
			<div>
				<h2 className="text-lg font-semibold">Checkout not found</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					It may have been completed, cancelled, or expired.
				</p>
			</div>
			<Button onClick={onBack} className="h-11 px-6">
				Back to all checkouts
			</Button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Open checkouts list — the home view; lets a vendor juggle several customers
// ---------------------------------------------------------------------------

function OpenCheckoutsList({
	onStart,
	onResume,
	onCancel,
}: {
	onStart: () => void;
	onResume: (id: string) => void;
	onCancel: (id: string) => void;
}) {
	const sessions = useQuery(api.counterCheckout.listOpenSessions, {});

	return (
		<div className="flex flex-col gap-4">
			<Button onClick={onStart} className="h-12 gap-2 text-base">
				<Plus className="size-5" />
				Start checkout
			</Button>

			<p className="text-xs text-muted-foreground">
				Run several customers at once and come back to any of them. Unfinished
				checkouts stay here for {OPEN_CHECKOUT_TTL_DAYS} days, then clear on
				their own — or cancel one anytime.
			</p>

			{sessions === undefined ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : sessions.length === 0 ? (
				<EmptyCheckouts />
			) : (
				<div className="flex flex-col gap-2">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Open checkouts ({sessions.length})
					</p>
					<ul className="flex flex-col gap-2">
						{sessions.map((s) => (
							<SessionRow
								key={s.sessionId}
								session={s}
								onResume={() => onResume(s.sessionId)}
								onCancel={() => onCancel(s.sessionId)}
							/>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function EmptyCheckouts() {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
			<span className="flex size-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
				<QrCode className="size-7" />
			</span>
			<div className="max-w-sm">
				<h2 className="text-base font-semibold">No open checkouts</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Start one to show a QR for the buyer to scan with WhatsApp. You can
					run several at once and come back to any of them.
				</p>
			</div>
		</div>
	);
}

function SessionRow({
	session,
	onResume,
	onCancel,
}: {
	session: {
		sessionId: string;
		status: "awaiting_buyer" | "buyer_identified";
		displayName: string | undefined;
		isNewCustomer: boolean | undefined;
		itemCount: number;
		createdAt: number;
		boundAt: number | undefined;
		expiresAt: number;
	};
	onResume: () => void;
	onCancel: () => void;
}) {
	const awaiting = session.status === "awaiting_buyer";
	const since = session.boundAt ?? session.createdAt;
	return (
		<li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
			<button
				type="button"
				onClick={onResume}
				className="flex min-w-0 flex-1 items-center gap-3 text-left"
			>
				<span
					className={cn(
						"flex size-10 shrink-0 items-center justify-center rounded-full",
						awaiting
							? "bg-muted text-muted-foreground"
							: "bg-accent/15 text-accent",
					)}
				>
					{awaiting ? (
						<QrCode className="size-5" />
					) : (
						<UserCheck className="size-5" />
					)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold">
						{awaiting
							? "Waiting for buyer to scan"
							: (session.displayName ?? "Buyer connected")}
					</p>
					<p className="text-xs text-muted-foreground">
						{awaiting ? (
							"QR open — tap to show it"
						) : (
							<>
								{session.itemCount > 0
									? `${session.itemCount} item${session.itemCount === 1 ? "" : "s"}`
									: "No items yet"}
								{session.isNewCustomer ? " · New" : ""} · {timeAgo(since)}
							</>
						)}
					</p>
				</div>
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
			</button>
			<button
				type="button"
				onClick={onCancel}
				aria-label="Cancel checkout"
				className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
			>
				<Trash2 className="size-4" />
			</button>
		</li>
	);
}

/** Compact "x ago" for the open-checkouts list. */
function timeAgo(epoch: number): string {
	const diff = Date.now() - epoch;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
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

function ExpiredScreen({
	onRestart,
	onBackToList,
}: {
	onRestart: () => void;
	onBackToList: () => void;
}) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center">
			<Clock className="size-10 text-muted-foreground" />
			<div>
				<h2 className="text-lg font-semibold">Checkout expired</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					This checkout timed out. Start a fresh one to show a new QR.
				</p>
			</div>
			<div className="flex w-full flex-col gap-2">
				<Button onClick={onRestart} className="h-11 px-6">
					Start new checkout
				</Button>
				<button
					type="button"
					onClick={onBackToList}
					className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
				>
					Back to all checkouts
				</button>
			</div>
		</div>
	);
}

function DoneScreen({
	shortId,
	orderId,
	paidInPerson,
	onNew,
	onBackToList,
}: {
	shortId: string | undefined;
	orderId: Id<"orders"> | undefined;
	paidInPerson: boolean;
	onNew: () => void;
	onBackToList: () => void;
}) {
	const updateStatus = useMutation(api.orders.updateStatus);
	const [completed, setCompleted] = useState(false);
	const [completing, setCompleting] = useState(false);

	// Offer one-tap completion only for a paid-in-person sale — they've paid and
	// taken the item, so the seller can close it out here instead of clicking
	// through the status pipeline. Optional, not automatic: a paid deposit on an
	// item that isn't ready yet is left as a normal confirmed order.
	const canComplete = paidInPerson && !!orderId && !completed;

	async function markCompleted() {
		if (!orderId) return;
		setCompleting(true);
		try {
			await updateStatus({ orderId, status: "delivered" });
			setCompleted(true);
			toast.success("Order marked as completed.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setCompleting(false);
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center">
			<CheckCircle2 className="size-12 text-emerald-600" />
			<div>
				<h2 className="text-lg font-semibold text-emerald-900">
					{completed ? "Order completed" : "Order created"}
				</h2>
				<p className="mt-1 text-sm text-emerald-800">
					{shortId ? (
						<>
							Order <span className="font-mono font-semibold">{shortId}</span>{" "}
							{completed
								? "is marked completed."
								: "is confirmed and a WhatsApp confirmation was sent to the buyer."}
						</>
					) : completed ? (
						"The order is marked completed."
					) : (
						"The order is confirmed and the buyer has been notified on WhatsApp."
					)}
				</p>
			</div>
			<div className="flex w-full flex-col gap-2">
				{canComplete ? (
					<Button
						onClick={markCompleted}
						isLoading={completing}
						disabled={completing}
						className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
					>
						{completing ? "Completing…" : "Mark as completed"}
					</Button>
				) : null}
				{completed ? (
					<p className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700">
						<CheckCircle2 className="size-4" />
						Marked completed
					</p>
				) : null}
				<Button
					onClick={onNew}
					variant={canComplete ? "outline" : "default"}
					className="h-11"
				>
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
				<button
					type="button"
					onClick={onBackToList}
					className="text-sm font-medium text-emerald-800/80 underline-offset-2 hover:underline"
				>
					Back to all checkouts
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Build order (buyer bound) — catalog search → cart → pay → create
// ---------------------------------------------------------------------------

type CartLine = { name: string; label: string; price: number; qty: number };

type SessionDraft = {
	items: Array<{ variantId: Id<"productVariants">; quantity: number }>;
	fulfilmentDate?: number;
	paidInPerson?: boolean;
	paymentMethod?: OrderPaymentMethod;
};

function BuildOrderScreen({
	retailerId,
	sessionId,
	buyer,
	currency,
	draft,
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
	draft: SessionDraft | undefined;
	onCreated: (created: {
		shortId: string;
		orderId: Id<"orders">;
		paidInPerson: boolean;
	}) => void;
}) {
	const products = useQuery(api.products.list, { retailerId });
	const createOrder = useMutation(api.counterCheckout.createOrderFromSession);
	const saveDraft = useMutation(api.counterCheckout.saveSessionDraft);
	const [query, setQuery] = useState("");
	// Cart + selections seed from the autosaved draft so a refresh / resume
	// restores exactly where the vendor left off. Items hydrate once the catalog
	// loads (we need names/prices); the rest seed synchronously.
	const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [paidInPerson, setPaidInPerson] = useState(draft?.paidInPerson ?? true);
	const [method, setMethod] = useState<OrderPaymentMethod>(
		draft?.paymentMethod ?? "cash",
	);
	const [submitting, setSubmitting] = useState(false);

	// Collection date — counter orders are self-collect, so this is "when will
	// they pick up?". Defaults to TODAY (the standard walk-in case) and always
	// allows today regardless of the storefront notice setting, since the seller
	// is keying the order in person.
	const { minYmd, maxYmd } = useMemo(() => {
		const b = fulfilmentDateBounds(0);
		return { minYmd: ymdFromEpoch(b.min), maxYmd: ymdFromEpoch(b.max) };
	}, []);
	const [fulfilmentDate, setFulfilmentDate] = useState(
		draft?.fulfilmentDate != null ? ymdFromEpoch(draft.fulfilmentDate) : minYmd,
	);

	// One-time cart hydration from the draft, once the catalog is available to
	// resolve each saved variant's name/label/price. Guarded so subsequent draft
	// updates (our own autosaves echoing back) never clobber live edits.
	const hydratedRef = useRef(false);
	useEffect(() => {
		if (hydratedRef.current || !products) return;
		hydratedRef.current = true;
		const items = draft?.items ?? [];
		if (items.length === 0) return;
		const lookup = new Map<
			string,
			{ name: string; label: string; price: number }
		>();
		for (const p of products) {
			for (const vr of p.variants) {
				const label = vr.isCustom
					? (vr.customLabel ?? "Custom")
					: vr.optionValues.join(" / ");
				lookup.set(vr._id, { name: p.name, label, price: vr.price });
			}
		}
		const next = new Map<string, CartLine>();
		for (const it of items) {
			const v = lookup.get(it.variantId);
			if (v) next.set(it.variantId, { ...v, qty: it.quantity });
		}
		if (next.size > 0) setCart(next);
		// Don't silently shrink the cart: if a saved item was deactivated/deleted
		// since the autosave, tell the vendor so they're not left thinking they
		// have items that quietly vanished. (CLAUDE.md: no states that silently confuse.)
		const dropped = items.length - next.size;
		if (dropped > 0) {
			toast.warning(
				`${dropped} saved item${dropped === 1 ? "" : "s"} ${
					dropped === 1 ? "is" : "are"
				} no longer available and ${dropped === 1 ? "was" : "were"} removed.`,
			);
		}
	}, [products, draft]);

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

	// Autosave the in-progress order to the session (debounced) so a refresh,
	// reconnect, or jumping to another customer never loses it. We only start
	// saving once the initial draft has hydrated, so an empty cart never
	// overwrites a saved one on first paint.
	const draftPayload = useMemo<SessionDraft>(() => {
		const epoch = mytMidnightFromYmd(fulfilmentDate);
		return {
			items: [...cart.entries()].map(([variantId, l]) => ({
				variantId: variantId as Id<"productVariants">,
				quantity: l.qty,
			})),
			fulfilmentDate: Number.isNaN(epoch) ? undefined : epoch,
			paidInPerson,
			paymentMethod: paidInPerson ? method : undefined,
		};
	}, [cart, fulfilmentDate, paidInPerson, method]);
	const latestDraft = useRef(draftPayload);
	latestDraft.current = draftPayload;
	const debouncedDraftKey = useDebounce(JSON.stringify(draftPayload), 700);
	// Fire when the debounced key settles; we save the latest draft via a ref, so
	// debouncedDraftKey is intentionally a trigger-only dependency.
	// biome-ignore lint/correctness/useExhaustiveDependencies: debouncedDraftKey is the trigger
	useEffect(() => {
		if (!hydratedRef.current) return;
		saveDraft({ sessionId, draft: latestDraft.current }).catch(() => {
			// Best-effort autosave — a transient failure just retries on the next edit.
		});
	}, [debouncedDraftKey, sessionId, saveDraft]);

	async function submit() {
		if (cartEntries.length === 0) return;
		setSubmitting(true);
		try {
			const fulfilmentEpoch = mytMidnightFromYmd(fulfilmentDate);
			const { shortId, orderId } = await createOrder({
				sessionId,
				items: cartEntries.map(([variantId, l]) => ({
					variantId: variantId as Id<"productVariants">,
					quantity: l.qty,
				})),
				paidInPerson,
				paymentMethod: paidInPerson ? method : undefined,
				fulfilmentDate: Number.isNaN(fulfilmentEpoch)
					? undefined
					: fulfilmentEpoch,
			});
			onCreated({ shortId, orderId, paidInPerson });
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

				{/* Collection date */}
				<div className="rounded-2xl border border-border bg-card p-4">
					<label
						htmlFor="counter-fulfilment-date"
						className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
					>
						Collection date
					</label>
					<input
						id="counter-fulfilment-date"
						type="date"
						value={fulfilmentDate}
						min={minYmd}
						max={maxYmd}
						onChange={(e) => setFulfilmentDate(e.target.value)}
						className="mt-3 h-11 w-full rounded-xl border border-input bg-transparent px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
					/>
					<p className="mt-2 text-xs text-muted-foreground">
						When the buyer collects. Defaults to today — change it for a
						pre-order.
					</p>
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
