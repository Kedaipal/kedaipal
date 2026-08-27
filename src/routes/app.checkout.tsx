import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	ArrowLeft,
	BadgeCheck,
	Banknote,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	EyeOff,
	Image as ImageIcon,
	LayoutGrid,
	List,
	Minus,
	Pencil,
	Phone,
	Plus,
	QrCode,
	Search,
	Send,
	Trash2,
	UserCheck,
	UserX,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Country } from "../../convex/lib/country";
import { DEFAULT_CURRENCY } from "../../convex/lib/currency";
import {
	formatFulfilmentDate,
	fulfilmentDateBounds,
	mytMidnightFromYmd,
	ymdFromEpoch,
} from "../../convex/lib/fulfilmentDate";
import {
	COUNTRY_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../convex/lib/paymentMethod";
import { ClaimsPanel } from "../components/claim/send-claim";
import { BRAND_GLYPHS } from "../components/dashboard/brand-icons";
import {
	counterPrimaryAction,
	showsSellerPaymentControls,
} from "../lib/counter-panel";
import { sourceLabel } from "../../convex/lib/attribution";
import {
	CLAIM_SOURCE_CHOICES,
	CLAIM_WINDOW_CHOICES_MINUTES,
	DEFAULT_CLAIM_WINDOW_MINUTES,
	describeClaimWindow,
} from "../../convex/lib/orderClaims";
import { OrderDocumentActions } from "../components/order/order-document-actions";
import { AppImage } from "../components/ui/app-image";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import {
	useActAsRetailerId,
	useDashboardRetailer,
} from "../hooks/useDashboardRetailer";
import { useDebounce } from "../hooks/useDebounce";
import { MASK_PII } from "../lib/analytics-privacy";
import { newWalkInSince, walkInSessionIds } from "../lib/counter-scan";
import { convexErrorMessage, currencySymbol, formatPrice } from "../lib/format";
import { priceDelta } from "../lib/price-delta";
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
	const retailer = useDashboardRetailer();
	const { session: activeSessionId } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [created, setCreated] = useState<CreatedOrder | null>(null);

	const cancelSession = useMutation(api.counterCheckout.cancelCheckoutSession);

	const openSession = useCallback(
		(id: string) => navigate({ search: { session: id } }),
		[navigate],
	);
	const backToList = useCallback(() => navigate({ search: {} }), [navigate]);

	// Drop a finished order's done-screen state whenever the active checkout
	// changes (resumed another, or went back to the list).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset trigger only.
	useEffect(() => {
		setCreated(null);
	}, [activeSessionId]);

	async function cancel(id: string) {
		try {
			await cancelSession({ sessionId: id as SessionId });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
						<QrCode className="size-5" />
					</span>
					<div className="min-w-0">
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
						className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:w-auto"
					>
						<ArrowLeft className="size-4" />
						All checkouts
					</button>
				) : (
					// One control for every way to start a checkout: show the store QR
					// (buyer scans), or the escape hatches for a buyer who won't/can't
					// scan — manual phone entry or an anonymous cash sale. Management
					// (rotate/print) lives on /app/poster.
					<CounterCheckoutActions onStarted={openSession} />
				)}
			</header>

			{activeSessionId ? (
				<ActiveSession
					key={activeSessionId}
					sessionId={activeSessionId as SessionId}
					retailer={retailer}
					created={created}
					onCreated={setCreated}
					onBackToList={backToList}
					onCancelActive={async () => {
						await cancel(activeSessionId);
						backToList();
					}}
				/>
			) : (
				<>
					<OpenCheckoutsList onResume={openSession} onCancel={cancel} />
					{/* Claim links sent to buyers (86eyq0epn) — live countdown, resend,
					    cancel, and recent outcomes. Renders nothing until one is sent. */}
					<ClaimsPanel onResume={openSession} />
				</>
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
	onBackToList,
	onCancelActive,
}: {
	sessionId: SessionId;
	retailer: FunctionReturnType<typeof api.retailers.getMyRetailer> | undefined;
	created: CreatedOrder | null;
	onCreated: (c: CreatedOrder) => void;
	onBackToList: () => void;
	onCancelActive: () => void;
}) {
	const session = useQuery(
		convexQuery(api.counterCheckout.getCheckoutSession, { sessionId }),
	).data;

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
				buyerName={session.displayName}
				anonymous={!session.waPhone}
				onBackToList={onBackToList}
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
				currency={retailer.currency ?? DEFAULT_CURRENCY}
				country={retailer.country}
				draft={session.draft}
				defaultClaimWindowMinutes={retailer.claimLinkWindowMinutes}
				defaultClaimSource={retailer.claimLinkSource}
				onCreated={onCreated}
				onCancel={onCancelActive}
				onSentToBuyer={onBackToList}
			/>
		) : null;

	// expired / cancelled
	return <ExpiredScreen onBackToList={onBackToList} />;
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
	onResume,
	onCancel,
}: {
	onResume: (id: string) => void;
	onCancel: (id: string) => void;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const sessions = useQuery(
		convexQuery(api.counterCheckout.listOpenSessions, {
			retailerId: actAsRetailerId,
		}),
	).data;
	// Hold the row pending cancellation so a single shared confirm covers the
	// whole list — cancelling drops the open checkout and any items added to it.
	const [pendingCancel, setPendingCancel] = useState<{
		id: string;
		label: string;
	} | null>(null);
	// Cashier types the buyer's code (e.g. "K7") or name to find their checkout.
	const [query, setQuery] = useState("");

	const q = query.trim().toLowerCase();
	const filtered = (sessions ?? []).filter((s) => {
		if (!q) return true;
		return (
			(s.pairingCode?.toLowerCase().includes(q) ?? false) ||
			(s.displayName?.toLowerCase().includes(q) ?? false)
		);
	});

	function onSearchEnter() {
		// One match → jump straight into it (the buyer just told you their code).
		if (q && filtered.length === 1) onResume(filtered[0].sessionId);
	}

	return (
		<div className="flex flex-col gap-4">
			{sessions === undefined ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : sessions.length === 0 ? (
				<EmptyCheckouts />
			) : (
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								Open checkouts
							</p>
							<p className="text-sm text-muted-foreground">
								{sessions.length} active · clears after {OPEN_CHECKOUT_TTL_DAYS}{" "}
								days
							</p>
						</div>
						{/* Type the code the buyer shows you (or their name) to find them. */}
						<div className="relative sm:w-64">
							<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") onSearchEnter();
								}}
								placeholder="Find by code or name…"
								className="h-11 pl-9"
								inputMode="text"
								autoComplete="off"
							/>
						</div>
					</div>
					{filtered.length === 0 ? (
						<p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							No checkout matches “{query}”.
						</p>
					) : (
						<ul className="flex flex-col gap-2">
							{filtered.map((s) => (
								<SessionRow
									key={s.sessionId}
									session={s}
									highlight={q.length > 0}
									onResume={() => onResume(s.sessionId)}
									onCancel={() =>
										setPendingCancel({
											id: s.sessionId,
											label: s.displayName ?? "this buyer's checkout",
										})
									}
								/>
							))}
						</ul>
					)}
				</div>
			)}

			<ConfirmDialog
				open={pendingCancel !== null}
				onOpenChange={(o) => {
					if (!o) setPendingCancel(null);
				}}
				title="Cancel this checkout?"
				description={
					// Dialogs portal to document.body, so the mask must ride the
					// description node itself — an ancestor tag can't reach it.
					pendingCancel ? (
						<>
							<span {...MASK_PII}>{pendingCancel.label}</span> and any items
							added to it will be removed. This can't be undone.
						</>
					) : undefined
				}
				confirmLabel="Cancel checkout"
				cancelLabel="Keep it open"
				destructive
				onConfirm={() => {
					if (pendingCancel) onCancel(pendingCancel.id);
				}}
			/>
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
					Put up your printed poster, or tap{" "}
					<span className="font-medium">New order</span> to show your store QR.
					When a buyer scans it, their checkout appears here with a code to
					match. Can't scan? <span className="font-medium">New order</span> also
					lets you type their number or ring up a cash sale.
				</p>
			</div>
		</div>
	);
}

/**
 * The header's single entry point for starting a counter checkout — one dropdown
 * grouping every way an order begins, so the control reads cleanly on mobile and
 * desktop instead of two competing pill buttons:
 *   1. Show the store QR — buyer scans, their checkout appears + auto-opens here.
 *   2. Enter the buyer's phone — manual bind, buyer still gets the one WhatsApp
 *      confirmation (86ey8vqp6).
 *   3. Cash sale — fully anonymous, no WhatsApp (86ey8vqp6).
 * Management (rotate / print the poster) lives on /app/poster.
 */

// Manual-bind copy per store country (SG-lite, 86eynw28q). "We'll add the
// country code automatically" is the loose server normalizer's promise: MY
// bridges `012…`→`60…`, SG bridges a bare 8-digit `8/9…`→`65…` — while a
// number typed WITH its own country code (a foreign walk-in) passes through.
const MANUAL_BIND_PLACEHOLDER: Record<Country, string> = {
	MY: "e.g. 012-345 6789",
	SG: "e.g. 9123 4567",
};
const MANUAL_BIND_HELP: Record<Country, string> = {
	MY: "Malaysian mobile number. We'll add the country code automatically.",
	SG: "Singapore mobile number. We'll add the country code automatically.",
};
function CounterCheckoutActions({
	onStarted,
}: {
	onStarted: (sessionId: string) => void;
}) {
	const actAsRetailerId = useActAsRetailerId();
	// Store country drives the manual-bind helper copy + example (SG-lite). The
	// input itself stays deliberately loose and plate-less — a cashier may key
	// a foreign number for a walk-in — but the copy should name the store's own
	// country, and the server prefixes bare local numbers with its dial code.
	const retailer = useDashboardRetailer();
	const country = retailer?.country ?? "MY";

	// --- Store QR (the buyer-scan path) ---
	const storeQr = useQuery(
		convexQuery(api.counterCheckout.getStoreQr, {
			retailerId: actAsRetailerId,
		}),
	).data;
	// Shares the identical subscription OpenCheckoutsList already holds (Convex
	// dedupes), so the list is warm the instant the QR dialog opens and the
	// baseline snapshot below is accurate on the first frame.
	const sessions = useQuery(
		convexQuery(api.counterCheckout.listOpenSessions, {
			retailerId: actAsRetailerId,
		}),
	).data;
	const ensureToken = useMutation(api.counterCheckout.ensureCounterQrToken);
	const ensured = useRef(false);
	const [qrOpen, setQrOpen] = useState(false);

	// --- No-scan escape hatches: manual phone bind + anonymous cash sale ---
	const bindManual = useMutation(api.counterCheckout.bindSessionManualPhone);
	const startAnon = useMutation(api.counterCheckout.startAnonymousSession);
	const [phoneOpen, setPhoneOpen] = useState(false);
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [busy, setBusy] = useState(false);

	// Auto-provision the counter QR token on first mount so the "Show store QR"
	// item is ready the moment the seller opens the menu.
	useEffect(() => {
		if (ensured.current) return;
		if (storeQr === undefined || storeQr.token !== null) return;
		ensured.current = true;
		void ensureToken({ retailerId: actAsRetailerId }).catch(() => {
			// non-fatal — the QR item just stays hidden until it resolves
		});
	}, [storeQr, ensureToken, actAsRetailerId]);

	// While the QR dialog is open the cashier is actively waiting for a scan, so
	// we watch `listOpenSessions` for the walk-in it produces and jump straight
	// into that checkout (86ey5neg6). The baseline (walk-ins already present when
	// the dialog opened) is captured once so we only react to the NEXT scan.
	const baseline = useRef<Set<string> | null>(null);
	useEffect(() => {
		if (!qrOpen) {
			baseline.current = null; // re-snapshot on the next open
			return;
		}
		if (!sessions) return; // wait for the list before we can diff
		if (baseline.current === null) {
			baseline.current = walkInSessionIds(sessions);
			return;
		}
		const fresh = newWalkInSince(sessions, baseline.current);
		if (fresh) {
			setQrOpen(false);
			onStarted(fresh);
		}
	}, [qrOpen, sessions, onStarted]);

	// The QR item only makes sense once the store's `wa.me` deep link resolves —
	// without a WHATSAPP_CHECKOUT_PHONE it never does, so we hide just that item
	// (the phone + cash paths stay available) rather than the whole control.
	const qrReady = Boolean(storeQr?.waUrl);

	function changePhone(next: boolean) {
		setPhoneOpen(next);
		if (!next) {
			setName("");
			setPhone("");
			setBusy(false);
		}
	}

	// A name is at least 3 chars (a single letter isn't a name) — mirrors the
	// storefront checkout + the server validator. Phone: enough digits to be
	// plausible; the server does the authoritative MY normalization + validation.
	const nameReady = name.trim().length >= 3;
	const phoneReady = phone.replace(/\D/g, "").length >= 8;

	async function submitPhone() {
		if (busy || !phoneReady || !nameReady) return;
		setBusy(true);
		try {
			const { sessionId } = await bindManual({
				retailerId: actAsRetailerId,
				waPhone: phone,
				name,
			});
			changePhone(false);
			onStarted(sessionId);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setBusy(false);
		}
	}

	async function submitAnonymous() {
		if (busy) return;
		setBusy(true);
		try {
			// No name here — the cashier adds it on the build screen if they want to.
			const { sessionId } = await startAnon({ retailerId: actAsRetailerId });
			setBusy(false);
			onStarted(sessionId);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setBusy(false);
		}
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent/90 aria-expanded:bg-accent/90 sm:w-auto"
					>
						<Plus className="size-4" />
						New order
						<ChevronDown className="size-4 opacity-80" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-[19rem] max-w-[calc(100vw-2rem)]">
					<DropdownMenuLabel>Start a checkout</DropdownMenuLabel>
					{qrReady ? (
						<DropdownMenuItem onSelect={() => setQrOpen(true)}>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
								<QrCode className="size-5" />
							</span>
							<span className="min-w-0">
								<span className="block text-sm font-semibold">
									Show store QR
								</span>
								<span className="block text-xs text-muted-foreground">
									Buyer scans to connect on WhatsApp
								</span>
							</span>
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem onSelect={() => setPhoneOpen(true)}>
						<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
							<Phone className="size-5" />
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-semibold">
								Enter phone number
							</span>
							<span className="block text-xs text-muted-foreground">
								Buyer gets one WhatsApp with their order link
							</span>
						</span>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void submitAnonymous()}>
						<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
							<UserX className="size-5" />
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-semibold">
								Cash sale — no contact
							</span>
							<span className="block text-xs text-muted-foreground">
								Anonymous, paid in person, no WhatsApp
							</span>
						</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Store QR — buyer scans it and their checkout opens here automatically. */}
			<Dialog open={qrOpen} onOpenChange={setQrOpen}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Ask the buyer to scan</DialogTitle>
						<DialogDescription>
							They scan and hit send — their checkout opens here automatically,
							ready to ring up.
						</DialogDescription>
					</DialogHeader>
					{storeQr?.waUrl ? (
						<>
							<div className="mx-auto rounded-2xl border border-border bg-white p-4">
								<QRCode value={storeQr.waUrl} size={220} />
							</div>
							<Link
								to="/app/poster"
								onClick={() => setQrOpen(false)}
								className="text-center text-xs font-semibold text-accent-emphasis hover:underline"
							>
								Print an A4 poster or rotate this QR →
							</Link>
						</>
					) : null}
				</DialogContent>
			</Dialog>

			{/* Manual phone bind — buyer still gets the one WhatsApp confirmation. */}
			<Dialog open={phoneOpen} onOpenChange={changePhone}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Enter buyer's number</DialogTitle>
						<DialogDescription>
							We'll send one WhatsApp confirming the order, with a link to their
							order page — no scan needed. That message includes our
							privacy-policy link.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<label className="block">
							<span className="text-xs font-medium text-muted-foreground">
								Buyer's name
							</span>
							<Input
								type="text"
								autoComplete="off"
								autoFocus
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Aiman"
								className="mt-1 h-12 text-base"
							/>
						</label>
						<label className="block">
							<span className="text-xs font-medium text-muted-foreground">
								WhatsApp number
							</span>
							<Input
								type="tel"
								inputMode="tel"
								autoComplete="off"
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && phoneReady && nameReady)
										void submitPhone();
								}}
								placeholder={MANUAL_BIND_PLACEHOLDER[country]}
								className="mt-1 h-12 text-base"
							/>
							<span className="mt-1 block text-xs text-muted-foreground">
								{MANUAL_BIND_HELP[country]}
							</span>
						</label>
						<DialogFooter className="gap-2 sm:gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => changePhone(false)}
								className="h-11"
							>
								Cancel
							</Button>
							<Button
								type="button"
								onClick={submitPhone}
								isLoading={busy}
								disabled={busy || !phoneReady || !nameReady}
								className="h-11"
							>
								Start checkout
							</Button>
						</DialogFooter>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

function SessionRow({
	session,
	highlight,
	onResume,
	onCancel,
}: {
	session: {
		sessionId: string;
		pairingCode: string | undefined;
		origin: "cashier" | "store_qr";
		displayName: string | undefined;
		isNewCustomer: boolean | undefined;
		itemCount: number;
		createdAt: number;
		boundAt: number | undefined;
		expiresAt: number;
	};
	// When a search is active, ring the row so the match is obvious at a glance.
	highlight?: boolean;
	onResume: () => void;
	onCancel: () => void;
}) {
	const since = session.boundAt ?? session.createdAt;
	return (
		<li
			className={cn(
				"flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
				highlight ? "border-accent ring-1 ring-accent" : "border-border",
			)}
		>
			<button
				type="button"
				onClick={onResume}
				className="flex min-w-0 flex-1 items-center gap-3 text-left"
			>
				{/* The pairing code the buyer shows the cashier — the fastest way to
				    match "who's this?" to the right open checkout. */}
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-sm font-bold text-accent">
					{session.pairingCode ?? <UserCheck className="size-5" />}
				</span>
				{/* MASK_PII: the buyer's WA profile name — the pairing code stays readable. */}
				<div {...MASK_PII} className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<p className="truncate text-sm font-semibold">
							{session.displayName ?? "Buyer connected"}
						</p>
						{/* Buyer arrived via the printed store poster (walk-in scan). */}
						{session.origin === "store_qr" ? (
							<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
								Walk-in scan
							</span>
						) : null}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						<span>
							{session.itemCount > 0
								? `${session.itemCount} item${session.itemCount === 1 ? "" : "s"}`
								: "No items yet"}
						</span>
						<span aria-hidden="true">·</span>
						<span>{timeAgo(since)}</span>
						{session.isNewCustomer ? (
							<>
								<span aria-hidden="true">·</span>
								<span>New customer</span>
							</>
						) : null}
					</div>
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

function ExpiredScreen({ onBackToList }: { onBackToList: () => void }) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center">
			<Clock className="size-10 text-muted-foreground" />
			<div>
				<h2 className="text-lg font-semibold">Checkout expired</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					This checkout timed out. The buyer can scan your store QR again to
					start a new one.
				</p>
			</div>
			<Button onClick={onBackToList} className="h-11 px-6">
				Back to all checkouts
			</Button>
		</div>
	);
}

function DoneScreen({
	shortId,
	orderId,
	paidInPerson,
	buyerName,
	anonymous,
	onBackToList,
}: {
	shortId: string | undefined;
	orderId: Id<"orders"> | undefined;
	paidInPerson: boolean;
	buyerName: string | undefined;
	// Anonymous cash sale — no buyer to notify (86ey8vqp6), so not even the one
	// confirmation goes out and the document below is their only copy.
	anonymous?: boolean;
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

	// Say exactly what left the building. A counter order sends the buyer ONE
	// WhatsApp (86eyd63r8) — the confirmation, carrying the link to their order
	// page — and an anonymous cash sale sends nothing at all. The receipt/invoice
	// PDF is never messaged; it's handed over below.
	const sentSummary = anonymous
		? "is confirmed. Cash sale with no contact, so nothing was sent."
		: paidInPerson
			? "is confirmed. We sent the buyer one WhatsApp with a link to their order."
			: "is confirmed. We sent the buyer one WhatsApp with how to pay and a link to their order.";

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
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-6">
			<div className="flex items-start gap-4">
				<span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
					<CheckCircle2 className="size-7" />
				</span>
				<div className="min-w-0">
					<p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
						Checkout saved
					</p>
					<h2 className="mt-1 text-2xl font-bold text-emerald-950">
						{completed ? "Order completed" : "Order created"}
					</h2>
					<p className="mt-1 text-sm text-emerald-800">
						{shortId ? (
							<>
								Order <span className="font-mono font-semibold">{shortId}</span>{" "}
								{completed ? "is marked completed." : sentSummary}
							</>
						) : completed ? (
							"The order is marked completed."
						) : anonymous ? (
							"The order is confirmed — a cash sale with no contact, so nothing was sent."
						) : (
							// Resumed a completed session: we don't have the created order's
							// paid state here, so stay on what's true either way.
							"The order is confirmed. We sent the buyer one WhatsApp with a link to their order."
						)}
					</p>
				</div>
			</div>
			{shortId ? (
				<div className="rounded-xl border border-emerald-200 bg-white/70 p-4">
					<p className="text-sm font-semibold text-emerald-950">
						{paidInPerson ? "Receipt" : "Invoice"}
					</p>
					<OrderDocumentActions
						shortId={shortId}
						paid={paidInPerson}
						buyerName={buyerName}
						hasBuyer={!anonymous}
						className="mt-3"
					/>
				</div>
			) : null}
			<div className="grid gap-2 sm:grid-cols-2">
				{canComplete ? (
					<Button
						onClick={markCompleted}
						isLoading={completing}
						disabled={completing}
						className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:col-span-2"
					>
						{completing ? "Completing…" : "Mark as completed"}
					</Button>
				) : null}
				{completed ? (
					<p className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-sm font-medium text-emerald-700 sm:col-span-2">
						<CheckCircle2 className="size-4" />
						Marked completed
					</p>
				) : null}
				<Button
					onClick={onBackToList}
					variant={canComplete ? "outline" : "default"}
					className="h-11"
				>
					Back to checkouts
				</Button>
				{shortId ? (
					<Button asChild variant="outline" className="h-11">
						<Link to="/app/orders/$shortId" params={{ shortId }}>
							View order
						</Link>
					</Button>
				) : orderId ? (
					<Button asChild variant="outline" className="h-11">
						<Link to="/app/orders">Go to orders</Link>
					</Button>
				) : null}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Build order (buyer bound) — catalog search → cart → pay → create
// ---------------------------------------------------------------------------

type CartLine = {
	name: string;
	label: string;
	price: number;
	qty: number;
	// True for an isCustom/quote line — `price` is the vendor-entered amount, sent
	// as `unitPrice` to the server.
	isCustom?: boolean;
	// The variant's catalog price at add time (standard lines only; a custom line
	// has no catalog price). When `price` differs from this the line is a seller
	// price ADJUSTMENT — a negotiated discount/bump keyed at the counter — and the
	// adjusted price is sent as `unitPrice` (the server trusts it because the
	// caller is the authenticated seller, not a buyer).
	catalogPrice?: number;
};

/** A standard line whose price the seller changed from the catalog price. */
function isAdjusted(l: CartLine): boolean {
	return (
		!l.isCustom && l.catalogPrice !== undefined && l.price !== l.catalogPrice
	);
}

/**
 * The percentage pill beside an adjusted price — `−19%` in the brand mint for
 * a cut (the normal negotiated-discount case), amber `+11%` for a price set
 * ABOVE catalog so an accidental up-adjustment can't hide in the same green as
 * a deal. Hidden when the delta rounds to 0% (the strikethrough still marks
 * the line as adjusted).
 */
function PriceDeltaChip({
	price,
	catalog,
}: {
	price: number;
	catalog: number;
}) {
	const delta = priceDelta(price, catalog);
	if (!delta) return null;
	return (
		<span
			className={cn(
				"rounded-full px-1.5 py-px text-[10px] font-semibold leading-4 tabular-nums",
				delta.isCut
					? "bg-accent/15 text-accent-emphasis"
					: "bg-amber-500/15 text-amber-600 dark:text-amber-500",
			)}
		>
			{delta.isCut ? "−" : "+"}
			{delta.pct}%
		</span>
	);
}

type SessionDraft = {
	items: Array<{
		variantId: Id<"productVariants">;
		quantity: number;
		unitPrice?: number;
	}>;
	fulfilmentDate?: number;
	paidInPerson?: boolean;
	paymentMethod?: OrderPaymentMethod;
};

/** "2500" cents → "25.00" for the custom-price input. */
function centsToRm(cents: number): string {
	return (cents / 100).toFixed(2);
}
/** "25" / "25.50" → cents (integer). NaN when blank or not a positive amount. */
function rmToCents(rm: string): number {
	const n = Number(rm);
	if (!Number.isFinite(n) || n <= 0) return Number.NaN;
	return Math.round(n * 100);
}

type CounterProduct = FunctionReturnType<
	typeof api.products.listForCounter
>[number];

const CATALOG_VIEW_KEY = "kp.counterCatalogView";
type CatalogView = "list" | "grid";

/**
 * The seller's last-chosen catalog layout (list vs grid), persisted so the next
 * checkout opens in the same view. Hydrated after mount — the server + first
 * client render both use "list", then the client swaps in the saved choice, so
 * there's no SSR hydration mismatch.
 */
function useCatalogView(): [CatalogView, (v: CatalogView) => void] {
	const [view, setView] = useState<CatalogView>("list");
	useEffect(() => {
		const saved =
			typeof window !== "undefined"
				? window.localStorage.getItem(CATALOG_VIEW_KEY)
				: null;
		if (saved === "grid" || saved === "list") setView(saved);
	}, []);
	const set = useCallback((v: CatalogView) => {
		setView(v);
		try {
			window.localStorage.setItem(CATALOG_VIEW_KEY, v);
		} catch {
			// Private mode / storage disabled — the toggle still works for this session.
		}
	}, []);
	return [view, set];
}

/** First product image (product-level, not per-variant) or a placeholder tile. */
function ProductThumb({
	url,
	name,
	className,
}: {
	url: string | undefined;
	name: string;
	className?: string;
}) {
	return (
		<AppImage
			src={url}
			alt={name}
			aspect={className}
			fallback={
				<div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
					<ImageIcon className="size-5" aria-hidden />
				</div>
			}
		/>
	);
}

/** Cart quantity + a price label for a product, shared by the list + grid cards. */
function counterProductMeta(
	p: CounterProduct,
	cart: Map<string, CartLine>,
	currency: string,
): { cartQty: number; priceLabel: string } {
	const cartQty = p.variants.reduce(
		(s, vr) => s + (cart.get(vr._id)?.qty ?? 0),
		0,
	);
	// Ignore custom (quote) variants — they carry no catalog price — and note
	// "· custom" when a product mixes fixed + custom variants.
	const nonCustom = p.variants.filter((vr) => !vr.isCustom);
	const hasCustom = p.variants.some((vr) => vr.isCustom);
	const priceLabel =
		nonCustom.length === 0
			? "Custom price"
			: (() => {
					const lo = Math.min(...nonCustom.map((v) => v.price));
					const hi = Math.max(...nonCustom.map((v) => v.price));
					const base =
						lo === hi
							? formatPrice(lo, currency)
							: `from ${formatPrice(lo, currency)}`;
					return hasCustom ? `${base} · custom` : base;
				})();
	return { cartQty, priceLabel };
}

/**
 * The per-variant add/quantity rows for one product — shared by the list view's
 * inline accordion and the grid view's tap-to-open modal, so the (fiddly)
 * custom-price + stepper logic lives in exactly one place.
 */
function ProductVariantRows({
	product,
	currency,
	cart,
	customPriceInput,
	setCustomPriceInput,
	setQty,
	className,
}: {
	product: CounterProduct;
	currency: string;
	cart: Map<string, CartLine>;
	customPriceInput: Record<string, string>;
	setCustomPriceInput: React.Dispatch<
		React.SetStateAction<Record<string, string>>
	>;
	setQty: (variantId: string, line: CartLine, qty: number) => void;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col divide-y divide-border", className)}>
			{product.variants.map((vr) => {
				const isCustom = vr.isCustom === true;
				const label = isCustom
					? (vr.customLabel ?? "Custom")
					: vr.optionValues.length > 0
						? vr.optionValues.join(" / ")
						: "";
				const inCart = cart.get(vr._id);

				// Custom/quote line: no catalog price — the vendor types the
				// agreed-in-person price, then adds.
				if (isCustom) {
					const priceText =
						customPriceInput[vr._id] ?? (inCart ? centsToRm(inCart.price) : "");
					const cents = rmToCents(priceText);
					const validPrice = !Number.isNaN(cents);
					const onPriceChange = (val: string) => {
						setCustomPriceInput((prev) => ({ ...prev, [vr._id]: val }));
						const c = rmToCents(val);
						// Only push a valid price to the cart line.
						if (inCart && !Number.isNaN(c))
							setQty(vr._id, { ...inCart, price: c }, inCart.qty);
					};
					// When the field is blank/invalid but the line is already in the
					// cart, the last good price is still what'll be charged — say so
					// instead of showing a silent empty box.
					const heldHint =
						inCart && !validPrice
							? `Using ${formatPrice(inCart.price, currency)} — type a new price to change`
							: null;
					return (
						<div key={vr._id} className="flex flex-col gap-2 py-3">
							<div className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate text-sm">{label}</p>
									<p className="text-xs text-muted-foreground">
										Custom — set the agreed price
									</p>
								</div>
								{inCart ? (
									<Stepper
										qty={inCart.qty}
										onChange={(q) => setQty(vr._id, inCart, q)}
									/>
								) : null}
							</div>
							<div className="flex items-center gap-2">
								<div className="relative flex-1">
									<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
										{currencySymbol(currency)}
									</span>
									<Input
										type="number"
										inputMode="decimal"
										step="0.01"
										min="0"
										value={priceText}
										onChange={(e) => onPriceChange(e.target.value)}
										placeholder="0.00"
										variant="field"
										className="h-11 pl-10"
									/>
								</div>
								{!inCart ? (
									<Button
										variant="secondary"
										disabled={!validPrice}
										onClick={() =>
											setQty(
												vr._id,
												{
													name: product.name,
													label,
													price: cents,
													qty: 0,
													isCustom: true,
												},
												1,
											)
										}
										className="h-11 px-3"
									>
										<Plus className="size-4" />
										Add
									</Button>
								) : null}
							</div>
							{heldHint ? (
								<p className="text-xs text-amber-600 dark:text-amber-500">
									{heldHint}
								</p>
							) : null}
						</div>
					);
				}

				return (
					<div
						key={vr._id}
						className="flex items-center justify-between gap-3 py-3"
					>
						<div className="min-w-0">
							<p className="truncate text-sm">{label || "Default"}</p>
							<p className="text-xs text-muted-foreground">
								{formatPrice(vr.price, currency)}
								{vr.blockWhenOutOfStock ? ` · ${vr.onHand} left` : ""}
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
											name: product.name,
											label,
											price: vr.price,
											qty: 0,
											catalogPrice: vr.price,
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
	);
}

function BuildOrderScreen({
	retailerId,
	sessionId,
	buyer,
	currency,
	country,
	draft,
	defaultClaimWindowMinutes,
	defaultClaimSource,
	onCreated,
	onCancel,
	onSentToBuyer,
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
	/** Store country — decides which settlement rails the "Paid now" picker
	 * offers (SG has no DuitNow/TnG/FPX). See lib/paymentMethod.ts. */
	country: Country;
	draft: SessionDraft | undefined;
	/** Claim links (86eyq0epn): the store's remembered payment window. */
	defaultClaimWindowMinutes: number | undefined;
	/** Claim links: the store's remembered marketing origin (86eyq0eq9). */
	defaultClaimSource: string | undefined;
	onCreated: (created: {
		shortId: string;
		orderId: Id<"orders">;
		paidInPerson: boolean;
	}) => void;
	// Cancel the whole checkout (customer walked / changed their mind). Drops the
	// session + any items and returns to the open-checkouts list.
	onCancel: () => void;
	/** A claim link was sent — back to the list (the ClaimsPanel takes over). */
	onSentToBuyer: () => void;
}) {
	// Counter uses listForCounter (not the public list) so hidden, counter-only
	// SKUs — e.g. a pre-priced event product — are ringable in person while
	// staying off the storefront. See docs/hidden-products.md.
	const products = useQuery(
		convexQuery(api.products.listForCounter, { retailerId }),
	).data;
	const createOrder = useMutation(api.counterCheckout.createOrderFromSession);
	const saveDraft = useMutation(api.counterCheckout.saveSessionDraft);
	const saveName = useMutation(api.counterCheckout.setSessionCustomerName);
	const [query, setQuery] = useState("");
	// List vs grid catalog layout — remembered across checkouts (localStorage).
	const [view, setView] = useCatalogView();
	// Grid view opens a product's variants in a modal (the grid card has no room
	// for the inline accordion). Held by id + resolved live so a catalog refresh
	// keeps it fresh (and it closes if the product goes away).
	const [modalProductId, setModalProductId] = useState<string | null>(null);
	// Cart + selections seed from the autosaved draft so a refresh / resume
	// restores exactly where the vendor left off. Items hydrate once the catalog
	// loads (we need names/prices); the rest seed synchronously.
	const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [paidInPerson, setPaidInPerson] = useState(draft?.paidInPerson ?? true);
	const methodChoices = COUNTRY_PAYMENT_METHODS[country];
	// A resumed draft can hold a rail this store no longer offers (its country
	// was switched mid-checkout) — seeding the <select> with a value that isn't
	// an <option> renders it blank, so fall back to the country's first rail.
	const [method, setMethod] = useState<OrderPaymentMethod>(() =>
		draft?.paymentMethod && methodChoices.includes(draft.paymentMethod)
			? draft.paymentMethod
			: methodChoices[0],
	);
	// An anonymous walk-in (no phone) has no one to send a pay-later link to, so
	// it's always settled in person — the pay-later toggle is disabled with that
	// reason and the order is created paid. `paid` is the effective value used for
	// the order; the raw toggle only matters for an identified buyer.
	const anonymous = !buyer.waPhone;
	const paid = anonymous ? true : paidInPerson;
	const [submitting, setSubmitting] = useState(false);
	// Final review modal — a deliberate last look at items/prices/total before the
	// order is created, so a busy vendor can't fat-finger a price or quantity and
	// only notice after the buyer has paid. (Counter-only: the storefront buyer
	// already reviews their own cart before sending the order.)
	const [confirmOpen, setConfirmOpen] = useState(false);
	// Cancel-the-whole-checkout confirm (customer changed their mind at the counter).
	const [cancelOpen, setCancelOpen] = useState(false);
	// How this order gets paid (86eyq0epn) — the panel's FIRST question, and the
	// thing every block below it depends on:
	//   "counter" — the buyer is standing here; seller keys collection + payment.
	//   "send"    — the buyer finishes on their phone under a countdown, so the
	//               seller keys NEITHER (the buyer picks fulfilment and pays on
	//               their own page). Showing those controls in send mode was the
	//               original confusion: a seller filled them in, tapped Send, and
	//               nothing they had keyed reached the buyer.
	// Defaults to "counter" rather than forcing a pick: that is ~90% of counter
	// traffic and today's zero-tap flow, and the segmented control keeps the
	// alternative one tap away and permanently visible.
	const [payMode, setPayMode] = useState<"counter" | "send">("counter");
	// Claim-link fields, now INLINE in the panel (the modal is gone — its two
	// controls belong beside the cart they describe).
	const [windowMinutes, setWindowMinutes] = useState(
		defaultClaimWindowMinutes ?? DEFAULT_CLAIM_WINDOW_MINUTES,
	);
	const [claimSource, setClaimSource] = useState<string | undefined>(
		defaultClaimSource,
	);
	const [sending, setSending] = useState(false);
	// Per-variant price text for custom/quote lines (keyed by variantId). The cart
	// line holds the parsed cents; this holds the in-progress input string.
	const [customPriceInput, setCustomPriceInput] = useState<
		Record<string, string>
	>({});
	// Seller price adjustment (Wagyu Walid's ask: key a negotiated price on any
	// line after picking the product) — which cart line's edit sheet is open.
	// Editing happens in a dialog and commits ATOMICALLY on Save, so the running
	// total never flickers through half-typed values and there is no in-between
	// state for the debounced autosave to persist.
	const [editingLineId, setEditingLineId] = useState<string | null>(null);

	// Send the claim link straight from the panel. Same mutation the dialog
	// called; the dialog is gone because its two controls (window, origin) now
	// live beside the cart they describe.
	const sendClaim = useMutation(api.orderClaims.sendClaim);
	async function submitClaim() {
		setSending(true);
		try {
			await sendClaim({
				sessionId,
				items: cartEntries.map(([variantId, l]) => ({
					variantId: variantId as Id<"productVariants">,
					quantity: l.qty,
					unitPrice: l.isCustom || isAdjusted(l) ? l.price : undefined,
				})),
				windowMinutes,
				attributionSource: claimSource,
			});
			toast.success(
				`WhatsApp link sent to ${buyer.displayName ?? "the buyer"} — you'll see the order the moment they complete it.`,
			);
			onSentToBuyer();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSending(false);
		}
	}

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
	const [dateOpen, setDateOpen] = useState(
		draft?.fulfilmentDate != null &&
			ymdFromEpoch(draft.fulfilmentDate) !== minYmd,
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
			{ name: string; label: string; price: number; isCustom: boolean }
		>();
		for (const p of products) {
			for (const vr of p.variants) {
				const label = vr.isCustom
					? (vr.customLabel ?? "Custom")
					: vr.optionValues.join(" / ");
				lookup.set(vr._id, {
					name: p.name,
					label,
					price: vr.price,
					isCustom: vr.isCustom === true,
				});
			}
		}
		const next = new Map<string, CartLine>();
		for (const it of items) {
			const v = lookup.get(it.variantId);
			if (!v) continue;
			// A saved unitPrice restores the vendor's price — the agreed price on a
			// custom line, or a seller price adjustment on a standard line; otherwise
			// the catalog price.
			next.set(it.variantId, {
				name: v.name,
				label: v.label,
				price: it.unitPrice ?? v.price,
				qty: it.quantity,
				isCustom: v.isCustom,
				catalogPrice: v.isCustom ? undefined : v.price,
			});
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
				// Sell anything active — including made-to-order/custom + mockup-gated
				// variants. The buyer is in person, so design + price are agreed
				// face-to-face and the storefront mockup round-trip is moot; a custom
				// (quote) line just needs the vendor to type the agreed price below.
				variants: p.variants.filter((vr) => vr.active),
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

	// The product whose variant modal is open (grid view). Resolved from the live
	// catalog with active variants only — mirrors what the cards show.
	const modalProduct = useMemo<CounterProduct | null>(() => {
		if (!modalProductId || !products) return null;
		const p = products.find((x) => x._id === modalProductId);
		if (!p) return null;
		return { ...p, variants: p.variants.filter((vr) => vr.active) };
	}, [products, modalProductId]);
	// Price label + this product's cart count, for the modal header/footer.
	const modalMeta = modalProduct
		? counterProductMeta(modalProduct, cart, currency)
		: null;

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
	// One author for the draft shape: the debounced autosave memo below AND the
	// line-edit dialog's immediate flush both build through this, so the two can
	// never drift.
	const buildDraftPayload = useCallback(
		(fromCart: Map<string, CartLine>): SessionDraft => {
			const epoch = mytMidnightFromYmd(fulfilmentDate);
			return {
				items: [...fromCart.entries()].map(([variantId, l]) => ({
					variantId: variantId as Id<"productVariants">,
					quantity: l.qty,
					// Custom lines always carry their price; a standard line only when the
					// seller adjusted it (otherwise the server charges the catalog price).
					unitPrice: l.isCustom || isAdjusted(l) ? l.price : undefined,
				})),
				fulfilmentDate: Number.isNaN(epoch) ? undefined : epoch,
				paidInPerson: paid,
				paymentMethod: paid ? method : undefined,
			};
		},
		[fulfilmentDate, paid, method],
	);
	const draftPayload = useMemo<SessionDraft>(
		() => buildDraftPayload(cart),
		[cart, buildDraftPayload],
	);
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
					unitPrice: l.isCustom || isAdjusted(l) ? l.price : undefined,
				})),
				paidInPerson: paid,
				paymentMethod: paid ? method : undefined,
				fulfilmentDate: Number.isNaN(fulfilmentEpoch)
					? undefined
					: fulfilmentEpoch,
			});
			onCreated({ shortId, orderId, paidInPerson: paid });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	}

	const totalItems = cartEntries.reduce((s, [, l]) => s + l.qty, 0);
	const collectionEpoch = mytMidnightFromYmd(fulfilmentDate);
	const collectionLabel =
		Number.isNaN(collectionEpoch) || fulfilmentDate === minYmd
			? "Today / now"
			: formatFulfilmentDate(collectionEpoch);

	return (
		<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
			{/* Catalog */}
			<div className="flex flex-col gap-4">
				<BuyerCard
					buyer={buyer}
					currency={currency}
					anonymous={anonymous}
					// The name is editable when there's no linked CRM record yet — an
					// anonymous walk-in or a brand-new manual-phone buyer. For a
					// returning customer the CRM name is the source of truth (read-only).
					editable={!buyer.customer}
					onSaveName={(n) => {
						saveName({ sessionId, name: n }).catch((err) =>
							toast.error(convexErrorMessage(err)),
						);
					}}
				/>

				<div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
					<div className="mb-3 flex items-center justify-between gap-3 px-1">
						<div>
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								Catalog
							</p>
							<p className="text-sm text-muted-foreground">
								Add products to this counter order.
							</p>
						</div>
						{/* List ↔ grid layout — remembered for the next checkout. Each
						    button carries its own aria-label + aria-pressed, so the wrapper
						    needs no role. */}
						<div className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
							<span className="sr-only">Catalog layout</span>
							<button
								type="button"
								onClick={() => setView("list")}
								aria-pressed={view === "list"}
								aria-label="List view"
								className={cn(
									"flex size-9 items-center justify-center rounded-lg transition-colors",
									view === "list"
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<List className="size-4" />
							</button>
							<button
								type="button"
								onClick={() => setView("grid")}
								aria-pressed={view === "grid"}
								aria-label="Grid view"
								className={cn(
									"flex size-9 items-center justify-center rounded-lg transition-colors",
									view === "grid"
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<LayoutGrid className="size-4" />
							</button>
						</div>
					</div>
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
				</div>

				<div className="flex flex-col gap-3">
					{products === undefined ? (
						<p className="text-sm text-muted-foreground">Loading catalog…</p>
					) : filtered.length === 0 ? (
						<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
							No matching products.
						</p>
					) : view === "grid" ? (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{filtered.map((p) => {
								const { cartQty, priceLabel } = counterProductMeta(
									p,
									cart,
									currency,
								);
								return (
									<button
										key={p._id}
										type="button"
										onClick={() => setModalProductId(p._id)}
										className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-shadow hover:border-accent/40 hover:shadow-md"
									>
										<div className="relative aspect-square w-full overflow-hidden bg-muted">
											<ProductThumb
												url={p.imageUrls[0]}
												name={p.name}
												className="size-full"
											/>
											{cartQty > 0 ? (
												<span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold leading-none text-accent-foreground shadow">
													{cartQty}
												</span>
											) : null}
											{p.hidden ? (
												<span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
													<EyeOff className="size-3" aria-hidden />
													Hidden
												</span>
											) : null}
										</div>
										<div className="min-w-0 p-2.5">
											<p className="truncate text-sm font-semibold">{p.name}</p>
											<p className="truncate text-xs text-muted-foreground">
												{priceLabel}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					) : (
						filtered.map((p) => {
							const open = isSearching || expanded.has(p._id);
							const { cartQty, priceLabel } = counterProductMeta(
								p,
								cart,
								currency,
							);
							return (
								<div
									key={p._id}
									className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
								>
									<button
										type="button"
										onClick={() => toggleExpanded(p._id)}
										// Static, even while expanded. This row used to pin below the
										// mobile header (sticky + --app-header-h) so long variant lists
										// kept their product name in view, but the pin fought the
										// variable-height header/banner stack and visibly glitched while
										// scrolling with a panel open. The counter is seller-operated —
										// they know which product they just tapped — so context loss is
										// minor and static is the robust choice.
										className="flex w-full items-center gap-3 bg-card p-3 text-left hover:bg-muted/40"
									>
										<ProductThumb
											url={p.imageUrls[0]}
											name={p.name}
											className="size-12 shrink-0 rounded-xl"
										/>
										<div className="min-w-0 flex-1">
											<p className="flex items-center gap-1.5 text-sm font-semibold">
												<span className="truncate">{p.name}</span>
												{/* Counter-only SKU — confirms at a glance this item is
												    off the storefront. See docs/hidden-products.md. */}
												{p.hidden ? (
													<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
														<EyeOff className="size-3" aria-hidden />
														Hidden
													</span>
												) : null}
											</p>
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
										<ProductVariantRows
											product={p}
											currency={currency}
											cart={cart}
											customPriceInput={customPriceInput}
											setCustomPriceInput={setCustomPriceInput}
											setQty={setQty}
											className="rounded-b-2xl border-t border-border bg-muted/20 px-3 pb-1"
										/>
									) : null}
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Cart / checkout */}
			<div className="lg:sticky lg:top-6 lg:self-start">
				<div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
					<div className="border-b border-border p-4">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
									Checkout
								</p>
								<p className="text-sm text-muted-foreground">
									{cartEntries.length === 0
										? "Add products from the catalog"
										: `${cartEntries.length} line${cartEntries.length === 1 ? "" : "s"} · ${totalItems} item${totalItems === 1 ? "" : "s"}`}
								</p>
							</div>
							<span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-accent">
								{totalItems} items
							</span>
						</div>

						{cartEntries.length === 0 ? (
							<div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
								Tap products to add them.
							</div>
						) : (
							<ul className="mt-3 flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
								{cartEntries.map(([variantId, l]) => {
									const adjusted = isAdjusted(l);
									return (
										<li
											key={variantId}
											className="flex items-center justify-between gap-3 py-1"
										>
											{/* The whole line opens the edit sheet (qty + price in one
											    place) — a full-row 44px+ target, with the pencil as
											    the visible affordance (CLAUDE.md: every feature
											    discoverable in-product). */}
											<button
												type="button"
												onClick={() => setEditingLineId(variantId)}
												aria-label={`Edit ${l.name}`}
												className="-mx-2 flex min-h-11 min-w-0 flex-1 flex-col rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
											>
												<span className="flex items-center gap-1.5 truncate text-sm font-medium">
													<span className="truncate">
														{l.name}
														{l.label ? (
															<span className="ml-1 font-normal text-muted-foreground">
																{l.label}
															</span>
														) : null}
													</span>
													<Pencil
														className="size-3 shrink-0 text-muted-foreground"
														aria-hidden
													/>
												</span>
												<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
													<span>
														{l.qty} × {formatPrice(l.price, currency)}
													</span>
													{adjusted && l.catalogPrice !== undefined ? (
														<>
															<span className="line-through opacity-70">
																{formatPrice(l.catalogPrice, currency)}
															</span>
															<PriceDeltaChip
																price={l.price}
																catalog={l.catalogPrice}
															/>
														</>
													) : null}
												</span>
											</button>
											<div className="flex shrink-0 items-center gap-2">
												<span className="text-sm font-semibold tabular-nums">
													{formatPrice(l.price * l.qty, currency)}
												</span>
												<button
													type="button"
													onClick={() => setQty(variantId, l, 0)}
													aria-label="Remove"
													className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
												>
													<X className="size-4" />
												</button>
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</div>

					<div className="space-y-4 p-4">
						{/* THE FIRST QUESTION (86eyq0epn). Everything below re-renders
						    around it, so it sits above the blocks it governs. An
						    anonymous cash sale has nobody to send a link to, so that
						    segment is disabled-with-reason rather than hidden — the
						    seller learns the capability exists and why it can't apply
						    here (same posture the Pay-later toggle already takes). */}
						<div className="rounded-xl border border-border bg-muted/20 p-3">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								How is this order paid?
							</p>
							<div className="mt-3 grid rounded-xl border border-border bg-background p-1 sm:grid-cols-2">
								<button
									type="button"
									onClick={() => setPayMode("counter")}
									aria-pressed={payMode === "counter"}
									className={cn(
										"flex min-h-12 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors",
										payMode === "counter"
											? "bg-accent text-accent-foreground shadow-sm"
											: "text-muted-foreground hover:bg-muted",
									)}
								>
									<Banknote className="size-4 shrink-0" />
									<span>
										<span className="block">Counter sale</span>
										<span className="block text-[11px] font-normal opacity-80">
											Buyer is here
										</span>
									</span>
								</button>
								<button
									type="button"
									onClick={() => setPayMode("send")}
									disabled={anonymous}
									aria-pressed={payMode === "send"}
									title={
										anonymous
											? "A cash sale has no number to send a link to."
											: undefined
									}
									className={cn(
										"flex min-h-12 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors",
										anonymous
											? "cursor-not-allowed text-muted-foreground/50"
											: payMode === "send"
												? "bg-accent text-accent-foreground shadow-sm"
												: "text-muted-foreground hover:bg-muted",
									)}
								>
									<Send className="size-4 shrink-0" />
									<span>
										<span className="block">Send to buyer</span>
										<span className="block text-[11px] font-normal opacity-80">
											They finish on their phone
										</span>
									</span>
								</button>
							</div>
							<p className="mt-2 text-xs text-muted-foreground">
								{payMode === "counter"
									? "You take the payment and finish the sale right here."
									: "They add their address and pay on their phone — your prices stay locked until the countdown runs out."}
							</p>
						</div>

						{showsSellerPaymentControls(payMode) ? (
						<>
						<div className="rounded-xl border border-border bg-muted/20 p-3">
							<button
								type="button"
								onClick={() => setDateOpen((open) => !open)}
								className="flex w-full items-center justify-between gap-3 text-left"
							>
								<span>
									<span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
										Collection
									</span>
									<span className="block text-sm font-medium">
										{collectionLabel}
									</span>
									<span className="block text-xs text-muted-foreground">
										Optional: open this only for preorder or later collection.
									</span>
								</span>
								<ChevronDown
									className={cn(
										"size-4 shrink-0 text-muted-foreground transition-transform",
										dateOpen && "rotate-180",
									)}
								/>
							</button>
							{dateOpen ? (
								<div className="mt-3 border-t border-border pt-3">
									<label
										htmlFor="counter-fulfilment-date"
										className="text-xs font-medium text-muted-foreground"
									>
										Change collection date
									</label>
									<input
										id="counter-fulfilment-date"
										type="date"
										value={fulfilmentDate}
										min={minYmd}
										max={maxYmd}
										onChange={(e) => setFulfilmentDate(e.target.value)}
										className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									/>
								</div>
							) : null}
						</div>

						<div className="rounded-xl border border-border bg-muted/20 p-3">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								Payment
							</p>
							<div className="mt-3 grid rounded-xl border border-border bg-background p-1 sm:grid-cols-2">
								<button
									type="button"
									onClick={() => setPaidInPerson(true)}
									aria-pressed={paid}
									className={cn(
										"flex min-h-12 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors",
										paid
											? "bg-accent text-accent-foreground shadow-sm"
											: "text-muted-foreground hover:bg-muted",
									)}
								>
									<Banknote className="size-4" />
									<span>
										<span className="block">Paid now</span>
										<span className="block text-[11px] font-normal opacity-80">
											Settled at counter
										</span>
									</span>
								</button>
								<button
									type="button"
									onClick={() => setPaidInPerson(false)}
									disabled={anonymous}
									aria-pressed={!paid}
									title={
										anonymous
											? "A cash sale has no buyer to send a payment link to."
											: undefined
									}
									className={cn(
										"flex min-h-12 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors",
										anonymous
											? "cursor-not-allowed text-muted-foreground/50"
											: !paid
												? "bg-accent text-accent-foreground shadow-sm"
												: "text-muted-foreground hover:bg-muted",
									)}
								>
									<Clock className="size-4" />
									<span>
										<span className="block">Pay later</span>
										<span className="block text-[11px] font-normal opacity-80">
											Send payment link
										</span>
									</span>
								</button>
							</div>

							{anonymous ? (
								<p className="mt-3 rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">
									Cash sale — no contact on file, so it's settled in person and
									no WhatsApp is sent.
								</p>
							) : null}

							{paid ? (
								<label className="mt-3 block">
									<span className="text-xs font-medium text-muted-foreground">
										Payment method
									</span>
									<select
										value={method}
										onChange={(e) =>
											setMethod(e.target.value as OrderPaymentMethod)
										}
										className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-4 text-base font-medium outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
									>
										{methodChoices.map((m) => (
											<option key={m} value={m}>
												{PAYMENT_METHOD_LABELS[m]}
											</option>
										))}
									</select>
								</label>
							) : (
								<p className="mt-3 rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">
									We'll send one WhatsApp with how to pay and a link to track
									the order.
								</p>
							)}
						</div>
						</>
						) : (
						/* SEND MODE — collection + payment are deliberately absent, and
						   said out loud: an absence the seller can't explain reads as a
						   bug, and this is the exact confusion the redesign fixes. */
						<>
						<p className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
							<span className="font-medium text-foreground">
								{buyer.displayName ?? "The buyer"} fills in the rest
							</span>{" "}
							— delivery or pickup, date &amp; time, and payment. Nothing you
							key here would reach them, so collection and payment are hidden.
						</p>

						<div className="rounded-xl border border-border bg-muted/20 p-3">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								How long do they get?
							</p>
							<div className="mt-3 flex gap-2">
								{CLAIM_WINDOW_CHOICES_MINUTES.map((minutes) => {
									const active = windowMinutes === minutes;
									return (
										<button
											key={minutes}
											type="button"
											aria-pressed={active}
											onClick={() => setWindowMinutes(minutes)}
											className={cn(
												"tap-target box-border flex-1 rounded-xl border-2 px-2 text-sm font-semibold transition-colors",
												active
													? "border-accent bg-accent/10 text-accent-emphasis"
													: "border-border bg-background text-muted-foreground hover:border-accent/40",
											)}
										>
											{describeClaimWindow(minutes)
												.replace(" minutes", " min")
												.replace(" hours", "h")}
										</button>
									);
								})}
							</div>
							<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
								Time to <em>complete</em> the order — then at least 15 minutes
								to pay. Still unpaid when it&apos;s up and the order cancels
								itself, so your stock comes back.
							</p>
						</div>

						<div className="rounded-xl border border-border bg-muted/20 p-3">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								Where&apos;s this order from?
							</p>
							<div className="mt-3 flex flex-wrap gap-2">
								{CLAIM_SOURCE_CHOICES.map((tag) => {
									const active = claimSource === tag;
									const brand = BRAND_GLYPHS[tag];
									return (
										<button
											key={tag}
											type="button"
											aria-pressed={active}
											onClick={() =>
												setClaimSource(active ? undefined : tag)
											}
											className={cn(
												"tap-target box-border flex items-center gap-1.5 rounded-full border-2 px-3 text-xs font-semibold transition-colors",
												active
													? "border-accent bg-accent/10 text-accent-emphasis"
													: "border-border bg-background text-muted-foreground hover:border-accent/40",
											)}
										>
											{brand ? (
												<brand.Icon
													className={cn(
														"size-3.5 shrink-0",
														active && brand.colorClass,
													)}
												/>
											) : null}
											{sourceLabel(tag)}
										</button>
									);
								})}
							</div>
							<p className="mt-2 text-xs text-muted-foreground">
								Optional — tags the sale so Insights can tell you what a Live
								is actually worth. Tap again to clear. We remember both
								choices for your next send.
							</p>
						</div>
						</>
						)}
					</div>

					<div className="border-t border-border bg-muted/20 p-4">
						<div className="mb-3 flex items-center justify-between text-sm">
							{/* Send mode is a price COMMITMENT, not a sum — and it is the
							    items total, since the buyer's delivery is added on their
							    own page. Label it so the figure can't be read as a final
							    bill. */}
							<span className="font-medium text-muted-foreground">
								{payMode === "send" ? "Locked total" : "Total"}
							</span>
							<span className="text-xl font-bold tabular-nums">
								{formatPrice(total, currency)}
							</span>
						</div>
						{/* ONE primary, whose label names the outcome of THIS mode. The
						    two paths are no longer competing buttons in the same slot. */}
						{(() => {
							const action = counterPrimaryAction({
								mode: payMode,
								empty: cartEntries.length === 0,
								// A claim freezes prices at send, so an unpriced line
								// would lock a zero.
								unpriced: cartEntries.some(([, l]) => l.price <= 0),
								money: formatPrice(total, currency),
								windowMinutes,
								buyerName: buyer.displayName,
							});
							return (
								<>
									<Button
										type="button"
										onClick={
											payMode === "send"
												? submitClaim
												: () => setConfirmOpen(true)
										}
										disabled={action.disabled || sending}
										title={action.reason}
										className="h-12 w-full text-base shadow-sm"
									>
										{payMode === "send" ? (
											<Send className="size-4" aria-hidden />
										) : null}
										{payMode === "send" && sending
											? "Sending…"
											: action.label}
									</Button>
									{action.helper ? (
										<p className="mt-1.5 text-center text-xs text-muted-foreground">
											{action.helper}
										</p>
									) : null}
								</>
							);
						})()}
						{/* Escape hatch: the customer walked or changed their mind. Cancels
						    the whole checkout (session + items) — confirmed first since it's
						    destructive. */}
						<button
							type="button"
							onClick={() => setCancelOpen(true)}
							className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium text-muted-foreground hover:text-destructive"
						>
							<Trash2 className="size-4" />
							Cancel checkout
						</button>
					</div>
				</div>
			</div>

			<ConfirmDialog
				open={cancelOpen}
				onOpenChange={setCancelOpen}
				title="Cancel this checkout?"
				description={
					<>
						<span {...MASK_PII}>{buyer.displayName ?? "This buyer"}</span>
						's checkout and any items added to it will be removed. This can't
						be undone.
					</>
				}
				confirmLabel="Cancel checkout"
				cancelLabel="Keep it open"
				destructive
				onConfirm={onCancel}
			/>

			<CartLineEditDialog
				// Keyed per line so the sheet's local price/qty state re-seeds fresh
				// each time it opens — never carrying a previous line's edits.
				key={editingLineId ?? "closed"}
				variantId={editingLineId}
				line={editingLineId ? (cart.get(editingLineId) ?? null) : null}
				currency={currency}
				onClose={() => setEditingLineId(null)}
				onRemove={(id) => {
					const line = cart.get(id);
					if (line) setQty(id, line, 0);
					setEditingLineId(null);
				}}
				onSave={(id, price, qty) => {
					const line = cart.get(id);
					if (!line) return;
					const next = new Map(cart);
					next.set(id, { ...line, price, qty });
					setCart(next);
					setEditingLineId(null);
					// Flush the save immediately instead of waiting out the 700ms
					// debounce: an explicit Save is a promise the price is kept, and
					// the passive autosave swallows failures — if this component ever
					// remounts before a save lands, rehydration would silently revert
					// the adjustment to the last-saved draft.
					saveDraft({ sessionId, draft: buildDraftPayload(next) }).catch(() => {
						toast.error(
							"Couldn't save the price change — check your connection.",
						);
					});
				}}
			/>
			<ConfirmCheckoutDialog
				open={confirmOpen}
				onOpenChange={(o) => {
					if (!submitting) setConfirmOpen(o);
				}}
				buyerName={buyer.displayName}
				lines={cartEntries.map(([variantId, l]) => ({ variantId, line: l }))}
				total={total}
				currency={currency}
				fulfilmentLabel={(() => {
					const e = mytMidnightFromYmd(fulfilmentDate);
					return Number.isNaN(e) ? "—" : formatFulfilmentDate(e);
				})()}
				paymentLabel={
					paid
						? `Paid now · ${PAYMENT_METHOD_LABELS[method]}`
						: "Pay later — we send the buyer a payment link on WhatsApp"
				}
				submitting={submitting}
				onConfirm={submit}
			/>

			{/* Grid view: a product's variants open here (the tile has no room for the
			    inline accordion). Same ProductVariantRows the list view uses. */}
			<Dialog
				open={modalProduct !== null}
				onOpenChange={(o) => {
					if (!o) setModalProductId(null);
				}}
			>
				{/* Fixed-height flex column: header + footer pinned, only the variant
				    list scrolls — so a product with many variants never grows the modal
				    past the viewport (the earlier version overflowed off-screen). */}
				<DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-md">
					{modalProduct && modalMeta ? (
						<>
							<DialogHeader className="shrink-0 gap-0 border-b border-border p-4 pr-12">
								<DialogTitle className="flex items-center gap-3">
									<ProductThumb
										url={modalProduct.imageUrls[0]}
										name={modalProduct.name}
										className="size-11 shrink-0 rounded-xl"
									/>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{modalProduct.name}</span>
										<span className="truncate text-xs font-normal text-muted-foreground">
											{modalMeta.priceLabel}
										</span>
									</span>
								</DialogTitle>
								<DialogDescription className="sr-only">
									Add options to this counter order.
								</DialogDescription>
							</DialogHeader>
							<div className="min-h-0 flex-1 overflow-y-auto px-4">
								<ProductVariantRows
									product={modalProduct}
									currency={currency}
									cart={cart}
									customPriceInput={customPriceInput}
									setCustomPriceInput={setCustomPriceInput}
									setQty={setQty}
								/>
							</div>
							<div className="shrink-0 border-t border-border p-3">
								<Button
									onClick={() => setModalProductId(null)}
									className="h-11 w-full"
								>
									{modalMeta.cartQty > 0
										? `Done · ${modalMeta.cartQty} added`
										: "Done"}
								</Button>
							</div>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}

/**
 * Last-look review before a counter order is created. Lays out items, line
 * prices, fulfilment date, payment, and the total — the "are you sure?" beat a
 * normal checkout gives you before paying, so a fat-fingered price/qty is caught
 * here, not after the buyer has handed over money.
 */
/**
 * Line-edit sheet for one cart line — the single home for qty + price on an
 * in-progress counter order (Wagyu Walid's negotiated-price ask, 86eyphh8r).
 * POS convention (tap the line → edit it), chosen over the earlier inline
 * expander whose tap-to-toggle price row, live per-keystroke re-pricing, and
 * cramped in-list controls all fought the cashier. Everything commits
 * ATOMICALLY on Save: the running total never flickers through half-typed
 * values, and Cancel/dismiss discards cleanly.
 */
function CartLineEditDialog({
	variantId,
	line,
	currency,
	onClose,
	onRemove,
	onSave,
}: {
	variantId: string | null;
	line: CartLine | null;
	currency: string;
	onClose: () => void;
	onRemove: (variantId: string) => void;
	onSave: (variantId: string, price: number, qty: number) => void;
}) {
	// Seeded once per open — the parent keys this component on the line id.
	const [priceText, setPriceText] = useState(() =>
		line ? centsToRm(line.price) : "",
	);
	const [qty, setLocalQty] = useState(() => line?.qty ?? 1);

	if (!variantId || !line) return null;

	const cents = rmToCents(priceText);
	const validPrice = !Number.isNaN(cents);
	const catalog = line.isCustom ? undefined : line.catalogPrice;
	const differsFromCatalog =
		catalog !== undefined && validPrice && cents !== catalog;

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="truncate">{line.name}</DialogTitle>
					<DialogDescription>
						{line.label || (line.isCustom ? "Custom line" : "Edit this line")}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm font-medium">Quantity</span>
						<Stepper qty={qty} onChange={(q) => setLocalQty(Math.max(1, q))} />
					</div>
					<label className="block">
						<span className="text-sm font-medium">Unit price</span>
						<div className="relative mt-1">
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
								{currencySymbol(currency)}
							</span>
							<Input
								type="number"
								inputMode="decimal"
								step="0.01"
								min="0"
								autoFocus
								value={priceText}
								onChange={(e) => setPriceText(e.target.value)}
								// Tap-in selects the old value so typing replaces it — the
								// common case is keying a whole new agreed price.
								onFocus={(e) => e.target.select()}
								onKeyDown={(e) => {
									if (e.key === "Enter" && validPrice)
										onSave(variantId, cents, qty);
								}}
								placeholder={centsToRm(line.price)}
								variant="field"
								// Spinners hidden: a ±RM0.01 step is useless for keying an
								// agreed price, and the live delta chip lives in that corner.
								className="h-12 pl-10 pr-16 text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
							/>
							{/* The negotiation math, confirmed live at the point of typing —
							    mint −% for a cut, amber +% for above-catalog. */}
							{catalog !== undefined && differsFromCatalog ? (
								<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
									<PriceDeltaChip price={cents} catalog={catalog} />
								</span>
							) : null}
						</div>
						{/* The catalog price stays visible while adjusting, with a
						    one-tap way back; a custom line has no catalog price. */}
						{catalog !== undefined ? (
							<span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
								Catalog price {formatPrice(catalog, currency)}
								{differsFromCatalog ? (
									<button
										type="button"
										onClick={() => setPriceText(centsToRm(catalog))}
										className="font-medium text-accent-emphasis underline underline-offset-2"
									>
										Reset
									</button>
								) : null}
							</span>
						) : (
							<span className="mt-1 block text-xs text-muted-foreground">
								Agreed in person — no catalog price.
							</span>
						)}
						{!validPrice ? (
							<span className="mt-1 block text-xs text-destructive">
								Enter a price above RM 0.00 to save.
							</span>
						) : null}
					</label>
					{validPrice ? (
						<p className="flex items-baseline gap-1.5 text-sm text-muted-foreground">
							Line total{" "}
							<span className="font-semibold text-foreground tabular-nums">
								{formatPrice(cents * qty, currency)}
							</span>
							{/* The money view of the same cut — what the whole line would
							    have cost at catalog. */}
							{catalog !== undefined && differsFromCatalog ? (
								<span className="text-xs line-through opacity-70">
									{formatPrice(catalog * qty, currency)}
								</span>
							) : null}
						</p>
					) : null}
				</div>
				<DialogFooter className="gap-2 sm:justify-between">
					<Button
						variant="ghost"
						onClick={() => onRemove(variantId)}
						className="text-destructive hover:bg-destructive/10 hover:text-destructive"
					>
						<Trash2 className="size-4" />
						Remove
					</Button>
					<Button
						disabled={!validPrice}
						onClick={() => validPrice && onSave(variantId, cents, qty)}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ConfirmCheckoutDialog({
	open,
	onOpenChange,
	buyerName,
	lines,
	total,
	currency,
	fulfilmentLabel,
	paymentLabel,
	submitting,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	buyerName: string | undefined;
	lines: Array<{ variantId: string; line: CartLine }>;
	total: number;
	currency: string;
	fulfilmentLabel: string;
	paymentLabel: string;
	submitting: boolean;
	onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Confirm order</DialogTitle>
					<DialogDescription>
						Go through it with{" "}
						<span {...MASK_PII}>{buyerName ?? "the buyer"}</span> before
						creating it.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border">
						{lines.map(({ variantId, line: l }) => (
							<li
								key={variantId}
								className="flex items-start justify-between gap-3 p-3"
							>
								<div className="min-w-0">
									<p className="text-sm font-medium">
										{l.name}
										{l.label ? (
											<span className="font-normal text-muted-foreground">
												{" "}
												· {l.label}
											</span>
										) : null}
									</p>
									<p className="text-xs text-muted-foreground">
										{l.qty} × {formatPrice(l.price, currency)}
										{l.isCustom ? " · custom" : ""}
										{/* An adjusted line shows the catalog price it replaced, so
										    the last-look review catches a fat-fingered override. */}
										{isAdjusted(l) && l.catalogPrice !== undefined ? (
											<>
												{" · was "}
												<span className="line-through">
													{formatPrice(l.catalogPrice, currency)}
												</span>
											</>
										) : null}
									</p>
								</div>
								<span className="shrink-0 text-sm font-semibold tabular-nums">
									{formatPrice(l.price * l.qty, currency)}
								</span>
							</li>
						))}
					</ul>

					<div className="flex flex-col gap-1.5 rounded-xl bg-muted/50 p-3 text-sm">
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Collection</span>
							<span className="font-medium">{fulfilmentLabel}</span>
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Payment</span>
							<span className="text-right font-medium">{paymentLabel}</span>
						</div>
						<div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-bold">
							<span>Total</span>
							<span className="tabular-nums">
								{formatPrice(total, currency)}
							</span>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={submitting}
						className="h-11"
					>
						Back
					</Button>
					<Button
						onClick={onConfirm}
						isLoading={submitting}
						disabled={submitting}
						className="h-11"
					>
						{submitting
							? "Creating…"
							: `Create order · ${formatPrice(total, currency)}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Inline-editable buyer name — an underlined text input that debounce-saves onto
 * the session (setSessionCustomerName). Seeded ONCE from the current name so live
 * reactivity doesn't fight the cashier's typing. Used for walk-in sessions with
 * no linked CRM record (anonymous or brand-new manual-phone buyer).
 */
function EditableBuyerName({
	initial,
	placeholder,
	onSave,
	className,
}: {
	initial: string;
	placeholder: string;
	onSave: (name: string) => void;
	className?: string;
}) {
	const [value, setValue] = useState(initial);
	const debounced = useDebounce(value, 500);
	// Keep the latest onSave without retriggering the save effect on every render.
	const saveRef = useRef(onSave);
	saveRef.current = onSave;
	const first = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: debounced is the trigger; onSave is read via ref.
	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		const trimmed = value.trim();
		// Save an empty value (clears the name) or a complete ≥3-char name; skip a
		// 1–2 char partial so the server's min-length rule never fires mid-type.
		if (trimmed.length >= 1 && trimmed.length < 3) return;
		saveRef.current(trimmed);
	}, [debounced]);
	return (
		<input
			type="text"
			value={value}
			onChange={(e) => setValue(e.target.value)}
			placeholder={placeholder}
			aria-label="Buyer's name"
			className={cn(
				"w-full truncate bg-transparent text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground",
				className,
			)}
		/>
	);
}

function BuyerCard({
	buyer,
	currency,
	anonymous,
	editable,
	onSaveName,
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
	// No buyer contact on file — an anonymous cash sale (86ey8vqp6).
	anonymous?: boolean;
	// The name can be typed/edited inline (no linked CRM record yet).
	editable?: boolean;
	onSaveName?: (name: string) => void;
}) {
	// Anonymous sale: no phone/CRM, so a muted "walk-in" card rather than the
	// accent "buyer connected" one — it's a valid state, not an error. The cashier
	// can still attach a name (for the order + receipt).
	if (anonymous) {
		return (
			<div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/30 p-4 shadow-sm">
				<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
					<UserX className="size-5" />
				</span>
				<div {...MASK_PII} className="min-w-0 flex-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Walk-in customer
					</p>
					{editable && onSaveName ? (
						<EditableBuyerName
							initial={buyer.displayName ?? ""}
							placeholder="Add a name (optional)"
							onSave={onSaveName}
						/>
					) : (
						<p className="truncate text-lg font-semibold">
							{buyer.displayName ?? "No contact"}
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						Cash sale — nothing sent to WhatsApp
					</p>
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4 shadow-sm">
			<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
				<UserCheck className="size-5" />
			</span>
			<div {...MASK_PII} className="min-w-0 flex-1">
				<p className="text-xs font-semibold uppercase tracking-widest text-accent">
					Buyer connected
				</p>
				{editable && onSaveName ? (
					<EditableBuyerName
						initial={buyer.displayName ?? ""}
						placeholder="Buyer's name"
						onSave={onSaveName}
					/>
				) : (
					<p className="truncate text-lg font-semibold">
						{buyer.displayName ?? "Buyer connected"}
					</p>
				)}
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
