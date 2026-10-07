import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Award,
	Banknote,
	CalendarClock,
	Check,
	Coins,
	CreditCard,
	FilePlus2,
	Hammer,
	ImagePlus,
	Landmark,
	ListChecks,
	Loader2,
	Plus,
	ReceiptText,
	RefreshCw,
	Send,
	ShieldX,
	ShoppingBag,
	TrendingDown,
	UserPlus,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { TopUpRevenue } from "../../convex/creditPurchases";
import {
	COUNTRIES,
	COUNTRY_LABELS,
	type Country,
} from "../../convex/lib/country";
import {
	ANNUAL_MONTHS_RECEIVED,
	annualQuote,
	BILLING_CURRENCIES,
	type BillingCurrency,
	enterprisePrice,
	PLANS,
	type Plan,
	planPrice,
} from "../../convex/lib/plans";
import {
	AutoChargeDetail,
	AutoChargePill,
} from "../components/admin/auto-charge-status";
import { GatewayIssuesCard } from "../components/admin/gateway-issues-card";
import { PageHeader } from "../components/dashboard/page-header";
import { InvoiceDownloadButton } from "../components/settings/invoice-download-button";
import { AppImage } from "../components/ui/app-image";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { MyPhoneInput } from "../components/ui/my-phone-input";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { useActAs } from "../hooks/useActAs";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { describeAutoCharge } from "../lib/auto-charge-status";
import {
	convexErrorMessage,
	formatPrice,
	formatShortDate,
} from "../lib/format";
import { IMAGE_ACCEPT, prepareImageUpload } from "../lib/image-upload";
import { buildOnboardingInviteLink } from "../lib/onboarding-link";
import { slugify, validateStoreName } from "../lib/slug";
import { PLAN_LABEL } from "../lib/subscription";

export const Route = createFileRoute("/app/admin/billing")({
	component: AdminBillingRoute,
});

function AdminBillingRoute() {
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;

	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-3xl">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-24 w-full rounded-2xl" />
			</div>
		);
	}
	if (!isAdmin) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
				<ShieldX className="size-8 text-muted-foreground" />
				<p className="font-medium">Not authorized</p>
				<p className="max-w-xs text-sm text-muted-foreground">
					This area is for Kedaipal admins only.
				</p>
			</div>
		);
	}

	return <AdminBillingContent />;
}

function AdminBillingContent() {
	// Invoicing is the frequent task → default tab. Payment details are set-once.
	const [tab, setTab] = useState<"invoices" | "payment">("invoices");
	const tabs = [
		{
			id: "invoices",
			label: "Invoices",
			description: "Onboard clients, issue invoices, mark paid",
			icon: <ReceiptText className="size-4" />,
		},
		{
			id: "payment",
			label: "Payment details",
			description: "Kedaipal bank account and DuitNow QR",
			icon: <CreditCard className="size-4" />,
		},
	] as const;
	return (
		<div className="flex flex-col gap-6 lg:max-w-5xl">
			<PageHeader title="Admin · Billing" subtitle="Issue + settle invoices" />
			<section className="flex flex-col gap-1 lg:hidden">
				<h2 className="text-xl font-bold">Admin · Billing</h2>
				<p className="text-sm text-muted-foreground">
					Issue invoices and manage Kedaipal payment details.
				</p>
			</section>

			<AdminBillingOverview />

			{/* Real money that settled nothing (double payment / wrong amount).
			    Above the tab fork on purpose: it's the most urgent thing this
			    page can carry, it must not hide behind whichever tab is open,
			    and it renders nothing while the queue is empty. */}
			<GatewayIssuesCard />

			<div className="grid gap-2 sm:grid-cols-2">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
							tab === t.id
								? "border-accent bg-accent/10 text-foreground shadow-sm"
								: "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground"
						}`}
					>
						<span
							className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
								tab === t.id
									? "bg-accent text-accent-foreground"
									: "bg-muted text-muted-foreground"
							}`}
						>
							{t.icon}
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-semibold leading-tight">
								{t.label}
							</span>
							<span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
								{t.description}
							</span>
						</span>
					</button>
				))}
			</div>

			{tab === "invoices" ? (
				<div className="flex flex-col gap-6">
					<OnboardClientCard />
					<IssueInvoiceForm />
					<PendingInvoices />
					<AutoRenewOverview />
					<FoundingMembersList />
				</div>
			) : (
				<PaymentConfigForm />
			)}
		</div>
	);
}

function AdminCard({
	children,
	className = "",
	id,
}: {
	children: ReactNode;
	className?: string;
	/** Deep-link anchor (the sellers directory's "Invite seller" lands on
	 * `#onboard`). */
	id?: string;
}) {
	return (
		<section
			id={id}
			className={`flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm lg:p-6 ${className}`}
		>
			{children}
		</section>
	);
}

function AdminSectionHeading({
	icon,
	title,
	description,
	aside,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	aside?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
					{icon}
				</div>
				<div className="min-w-0">
					<h3 className="text-sm font-semibold">{title}</h3>
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				</div>
			</div>
			{aside ? <div className="shrink-0 sm:pt-1">{aside}</div> : null}
		</div>
	);
}

function AdminBillingOverview() {
	const invoices = useQuery(convexQuery(api.invoices.listPending, {})).data;
	const spotsRemaining = useQuery(
		convexQuery(api.foundingMembers.getSpotsRemaining, {}),
	).data;
	// Invoices can carry different billing currencies (MYR + SGD), so the
	// outstanding tile sums per currency — one flattened number would be a lie.
	const pendingByCurrency = new Map<string, number>();
	for (const inv of invoices ?? []) {
		pendingByCurrency.set(
			inv.currency,
			(pendingByCurrency.get(inv.currency) ?? 0) + inv.total,
		);
	}
	const outstanding =
		pendingByCurrency.size === 0
			? formatPrice(0, "MYR")
			: [...pendingByCurrency.entries()]
					.sort(([a], [b]) =>
						a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b),
					)
					.map(([currency, sum]) => formatPrice(sum, currency))
					.join(" + ");
	const dueSoon =
		invoices?.filter((inv) => inv.dueDate <= Date.now() + 7 * DAY_MS).length ??
		0;
	const stats = [
		{
			label: "Pending",
			value: invoices === undefined ? "..." : String(invoices.length),
			helper: "Invoices to settle",
			icon: <ReceiptText className="size-4" />,
			className: "border-blue-200 bg-blue-50 text-blue-800",
		},
		{
			label: "Due soon",
			value: invoices === undefined ? "..." : String(dueSoon),
			helper: "Within 7 days",
			icon: <CalendarClock className="size-4" />,
			className: "border-amber-200 bg-amber-50 text-amber-800",
		},
		{
			label: "Outstanding",
			value: invoices === undefined ? "..." : outstanding,
			helper: "Pending total",
			icon: <Banknote className="size-4" />,
			className: "border-emerald-200 bg-emerald-50 text-emerald-800",
		},
		{
			label: "Founding",
			value: spotsRemaining === undefined ? "..." : `${spotsRemaining}/10`,
			helper: "Spots left",
			icon: <ListChecks className="size-4" />,
			className: "border-border bg-muted/50 text-foreground",
		},
	];

	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
				{stats.map((stat) => (
					<div
						key={stat.label}
						className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${stat.className}`}
					>
						<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
							{stat.icon}
						</div>
						<div className="min-w-0">
							<p className="text-xs font-medium opacity-75">{stat.label}</p>
							<p className="truncate font-mono text-lg font-bold leading-tight">
								{stat.value}
							</p>
							<p className="truncate text-[11px] opacity-70">{stat.helper}</p>
						</div>
					</div>
				))}
			</div>
			<CreditTotals />
		</div>
	);
}

/**
 * The book-wide credit figures (Kedaipal Credits T5) — two counts of CREDITS,
 * never money: what sellers have bought and not used (the deferred-revenue
 * figure — service still owed) and the orders taken past zero that the next
 * grant or pack will absorb. Beside them, the one money figure: this month's
 * top-up revenue from paid packs, per currency (Credits T3 × T2 — it waited
 * for the purchase table rather than guess). Exported for its states test.
 */
export function CreditTotals() {
	const totals = useQuery(convexQuery(api.credits.adminCreditTotals, {})).data;
	const revenue = useQuery(
		convexQuery(api.creditPurchases.adminTopUpRevenue, {}),
	).data;
	const stores = (n: number) => `${n} store${n === 1 ? "" : "s"}`;
	const tiles = [
		{
			label: "Unused bought credits",
			value:
				totals === undefined
					? "..."
					: totals.purchasedUnused.toLocaleString("en"),
			helper:
				totals === undefined
					? "Deferred — service still owed"
					: totals.storesWithPurchased === 0
						? "No store holds any yet"
						: `Across ${stores(totals.storesWithPurchased)} — service still owed`,
			icon: <Coins className="size-4" />,
			className: "border-border bg-muted/50 text-foreground",
		},
		{
			label: "Orders owed",
			value:
				totals === undefined ? "..." : totals.ordersOwed.toLocaleString("en"),
			helper:
				totals === undefined
					? "Taken past zero"
					: totals.storesOwing === 0
						? "No store is below zero"
						: `${stores(totals.storesOwing)} below zero — the next grant or pack settles it`,
			icon: <TrendingDown className="size-4" />,
			className:
				totals !== undefined && totals.ordersOwed > 0
					? "border-destructive/30 bg-destructive/10 text-destructive"
					: "border-border bg-muted/50 text-foreground",
		},
		topUpTile(revenue),
	];
	return (
		<section aria-label="Credits" className="flex flex-col gap-2">
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
				{tiles.map((tile) => (
					<div
						key={tile.label}
						className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${tile.className}`}
					>
						<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background/70">
							{tile.icon}
						</div>
						<div className="min-w-0">
							<p className="text-xs font-medium opacity-75">{tile.label}</p>
							<p className="truncate font-mono text-lg font-bold leading-tight">
								{tile.value}
							</p>
							{/* Wraps: the helper IS the explanation — cut off, it
							    read "across 0 stores · service still …". */}
							<p className="text-[11px] leading-snug text-pretty opacity-70">
								{tile.helper}
							</p>
						</div>
					</div>
				))}
			</div>
			{totals?.truncated ? (
				<p className="text-[11px] text-muted-foreground">
					Counted over the first {totals.accounts.toLocaleString("en")} credit
					accounts only — past that, these totals need a stored counter.
				</p>
			) : null}
		</section>
	);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Onboard a client, two ways — ONE card, because it is one decision made at one
 * moment with the same facts, and splitting it into two cards would make an
 * admin read both to find out which they wanted.
 *
 *  - **Send them a link** (the original): the admin fills the details and gets a
 *    prefilled onboarding link to paste. The client opens it, signs in, and
 *    confirms; the store is created under *their* login. Right whenever the
 *    client can be trusted to finish a form.
 *  - **Build it for them** (docs/prebuilt-stores.md): the store is created NOW,
 *    owned by nobody, and the admin walks straight into it via act-as to add
 *    products and settings. The vendor claims it later by signing up with the
 *    handover email. This is the white-glove path for a high-value vendor who
 *    should be handed a finished shop, not a form.
 *
 * The card's own copy used to assert the first was the only possibility ("we
 * can't create it for them without an orphaned, un-loginable store"). That held
 * until a store could be unclaimed rather than orphaned — a named state with a
 * way out. See docs/manual-subscription.md + docs/prebuilt-stores.md.
 */
/** The top-up revenue tile: paid packs this calendar month, per currency —
 * summed per currency like Outstanding, never flattened into one number. */
function topUpTile(revenue: TopUpRevenue | undefined) {
	const month =
		revenue === undefined
			? null
			: new Date(`${revenue.periodKey}-01T00:00:00Z`).toLocaleString("en", {
					month: "long",
					timeZone: "UTC",
				});
	const paid = revenue
		? (
				Object.entries(revenue.byCurrency) as [
					BillingCurrency,
					TopUpRevenue["byCurrency"][BillingCurrency],
				][]
			).filter(([, b]) => b.purchases > 0)
		: [];
	const packs = paid.reduce((n, [, b]) => n + b.purchases, 0);
	const credits = paid.reduce((n, [, b]) => n + b.credits, 0);
	return {
		label: month ? `Top-ups · ${month}` : "Top-ups",
		value:
			revenue === undefined
				? "..."
				: paid.length === 0
					? formatPrice(0, "MYR")
					: // MYR first — the server builds the record in that order.
						paid
							.map(([currency, b]) => formatPrice(b.amountMinor, currency))
							.join(" + "),
		helper:
			revenue === undefined
				? "Credit packs paid this month"
				: packs === 0
					? "No packs paid yet this month"
					: `${packs} pack${packs === 1 ? "" : "s"} · ${credits.toLocaleString("en")} credits`,
		icon: <ShoppingBag className="size-4" />,
		className: "border-emerald-200 bg-emerald-50 text-emerald-800",
	};
}

export function OnboardClientCard() {
	// Which door. Held here rather than in the URL: it is a scratch choice
	// inside one form, and nothing links to a half-filled card.
	const [mode, setMode] = useState<"link" | "build">("link");
	const navigate = useNavigate();
	const { setActAs } = useActAs();
	const createUnclaimedStore = useMutation(api.retailers.createUnclaimedStore);
	const startActAsSession = useMutation(api.admin.startActAsSession);
	const [building, setBuilding] = useState(false);
	const [storeName, setStoreName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugEdited, setSlugEdited] = useState(false);
	const [waPhone, setWaPhone] = useState("");
	const [email, setEmail] = useState("");
	// Store country (SG-lite): rides the invite token so the client's onboarding
	// form opens pre-set — an SG store must be born SG (currency follows it).
	const [country, setCountry] = useState<Country>("MY");
	const [founding, setFounding] = useState(false);
	const [copied, setCopied] = useState(false);
	// Stores created from this card WITHOUT walking into them ("Create & add
	// another") — the bulk pre-build run's running receipt, so an admin filling
	// the form twenty times can see what has already landed without leaving to
	// check. Not persisted: it describes this sitting at this card, and the
	// durable record is the directory's Unclaimed filter, linked below it.
	const [createdHere, setCreatedHere] = useState<
		{ storeName: string; slug: string }[]
	>([]);

	const spotsRemaining = useQuery(
		convexQuery(api.foundingMembers.getSpotsRemaining, {}),
	).data;
	const foundingAvailable = (spotsRemaining ?? 0) > 0;

	// Mirror the onboarding form: derive the slug from the name until hand-edited,
	// and check availability live so we never hand out a link to a taken slug.
	const derivedSlug = slugEdited ? slug : slugify(storeName);
	const availability = useSlugAvailability(derivedSlug, "create");
	const nameCheck = validateStoreName(storeName);

	// Live email pre-check (debounced) — Clerk allows one account per email and
	// we're 1 store per login, so a duplicate email means the invite would dead-end.
	// Warn before the link is sent. Only query once it looks like an email.
	const [debouncedEmail, setDebouncedEmail] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setDebouncedEmail(email.trim()), 350);
		return () => clearTimeout(t);
	}, [email]);
	const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debouncedEmail);
	const emailCheck = useQuery(
		convexQuery(
			api.retailers.checkEmailHasStore,
			// `forRetailerId: null` — this store does not exist yet, so there is
			// no self to exempt. The handover dialog passes its own id.
			emailLooksValid ? { email: debouncedEmail, forRetailerId: null } : "skip",
		),
	).data;
	// The server's own verdict, kind and sentence included — `checkEmailHasStore`
	// and the write both ask `findEmailConflict`, so this hint cannot clear an
	// address the create is about to refuse, and the two can't word it
	// differently. Two kinds, two fixes: a live store already mails it
	// ("owns"), or another pre-built store is already waiting for it
	// ("waiting").
	//
	// `null` = free, `undefined` = still asking. Both mean "nothing to warn
	// about yet" HERE, deliberately: this is a pre-flight hint, so a warning
	// that flickered in while the query settled would be worse than one that
	// arrives a beat late, and the authoritative refusal is the server's.
	const emailConflict = emailCheck ?? undefined;

	// The handover email is OPTIONAL in both modes. Build mode required it until
	// the bulk pre-build run (7 Oct): stores created in one sitting ahead of a
	// vendor list have no address yet BY DEFINITION, so a hard gate at create
	// blocks the workflow it was meant to protect. "I'll set it later" is still
	// the real risk, and it is answered where it can actually be seen — the
	// directory's **Unclaimed** chip, the amber "Handover — invite them" row and
	// the act-as banner stating plainly that nobody can claim it — not by a
	// field an admin fills with a throwaway address to get past it. A
	// placeholder address is strictly WORSE than a blank: it flips the row to
	// "Handover email — set", the amber signal is gone, and twenty rows then all
	// look finished. (The server always accepted an absent one.)
	const ready =
		nameCheck.ok &&
		availability.status === "available" &&
		emailConflict === undefined;

	/**
	 * Create the store now, then either walk straight into it or stay here for
	 * the next one. The destination is chosen BEFORE the click, by which button
	 * was pressed, so neither case costs a step it doesn't need:
	 *
	 *  - `thenOpen` — enter act-as and go to the dashboard. The navigate is the
	 *    easement, not a flourish: an admin who clicks "Build it for them" is
	 *    about to add products, and making them find the new store in the
	 *    directory first would be a step with no purpose.
	 *  - otherwise — clear the fields that name THIS store and stay on the card.
	 *    Creating twenty stores up front used to mean exiting act-as and
	 *    navigating back here between every one; the catalogue work happens
	 *    later, from the directory's Unclaimed filter.
	 */
	async function handleBuild(thenOpen: boolean) {
		if (!ready || building) return;
		// Read before the resets below clear them — the closure keeps this
		// render's values, but naming them makes the toast independent of that.
		const name = storeName.trim();
		const handover = email.trim();
		setBuilding(true);
		try {
			const result = await createUnclaimedStore({
				storeName: name,
				slug: derivedSlug,
				waPhone: waPhone.trim() || undefined,
				country,
				pendingOwnerEmail: handover || undefined,
			});
			if (thenOpen) {
				setActAs(result.retailerId);
				void startActAsSession({ retailerId: result.retailerId }).catch(
					() => {},
				);
				toast.success(`${name} created — you're in it now.`, {
					description: handover
						? `Build it out, then they claim it by signing up with ${handover}.`
						: "Set a handover email from the seller directory when you know it.",
				});
				navigate({ to: "/app" });
				return;
			}
			setCreatedHere((prev) => [
				...prev,
				{ storeName: name, slug: result.slug },
			]);
			// Clear only what names this store. COUNTRY and mode stay: a batch is
			// almost always one country, and re-picking it every time is exactly
			// the friction this button exists to remove.
			setStoreName("");
			setSlug("");
			setSlugEdited(false);
			setWaPhone("");
			setEmail("");
			toast.success(`${name} created.`, {
				description: handover
					? `They claim it by signing up with ${handover}.`
					: "No handover email yet — it's waiting under Sellers → Unclaimed.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBuilding(false);
		}
	}

	const link =
		typeof window === "undefined"
			? ""
			: buildOnboardingInviteLink(window.location.origin, {
					storeName,
					slug: derivedSlug,
					waPhone,
					founding: founding && foundingAvailable,
					country,
				});

	async function handleCopy() {
		if (!ready || !link) return;
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			toast.success(
				email.trim()
					? `Invite link copied. Paste it to ${email.trim()} yourself (WhatsApp/email) — Kedaipal doesn't send it.`
					: "Invite link copied. Paste it to your client yourself — Kedaipal doesn't send it.",
			);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Couldn't copy — long-press the link to copy it manually.");
		}
	}

	return (
		<AdminCard id="onboard">
			<AdminSectionHeading
				icon={<UserPlus className="size-5" />}
				title="Onboard a client"
				description={
					mode === "link"
						? "Fill what you know, copy the invite link, and send it manually. They confirm under their own login before invoicing."
						: "Create the store now and set it up yourself. They claim it later by signing up with the handover email — no form for them to fill."
				}
			/>

			{/* The mode picker sits FIRST because it changes what every field below
			    means (the email is a send-to address in one mode and a handover
			    target in the other). Each option states its consequence — an admin
			    picking between two onboarding paths should not have to try one to
			    find out what it does. */}
			<fieldset className="flex flex-col gap-2">
				<legend className="text-sm font-medium">
					How are they onboarding?
				</legend>
				<div className="grid gap-2 sm:grid-cols-2">
					{[
						{
							key: "link" as const,
							title: "Send them a link",
							hint: "They sign up and confirm the store under their own login.",
						},
						{
							key: "build" as const,
							title: "Build it for them",
							hint: "You create it now and fill it in. They claim it when they sign up.",
						},
					].map((option) => (
						<button
							key={option.key}
							type="button"
							aria-pressed={mode === option.key}
							onClick={() => setMode(option.key)}
							className={`flex min-h-16 flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors ${
								mode === option.key
									? "border-accent bg-accent/10"
									: "border-input bg-background hover:border-ring"
							}`}
						>
							<span className="text-sm font-semibold">{option.title}</span>
							<span className="text-xs text-muted-foreground">
								{option.hint}
							</span>
						</button>
					))}
				</div>
			</fieldset>

			<label className="flex flex-col gap-1 text-sm font-medium">
				Store name
				<Input
					value={storeName}
					onChange={(e) => setStoreName(e.target.value)}
					placeholder="e.g. Mak Cik Kuih"
					variant="field"
				/>
				{storeName.trim().length > 0 && !nameCheck.ok ? (
					<p className="text-sm font-normal text-destructive">
						✗ {nameCheck.message}
					</p>
				) : null}
			</label>

			<label className="flex flex-col gap-1 text-sm font-medium">
				Store link
				<div className="flex items-center rounded-xl border border-input bg-background pl-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
					<span className="select-none text-sm text-muted-foreground">
						kedaipal.com/
					</span>
					<Input
						value={derivedSlug}
						onChange={(e) => {
							setSlug(e.target.value);
							setSlugEdited(true);
						}}
						placeholder="store-slug"
						variant="bare"
						className="min-h-11 flex-1 pr-3 font-mono text-sm"
					/>
				</div>
				{storeName.trim().length >= 2 ? (
					<SlugHint state={availability} />
				) : null}
			</label>

			<div className="flex flex-col gap-1">
				<span className="text-sm font-medium">Country</span>
				<div className="grid max-w-xs grid-cols-2 gap-2">
					{COUNTRIES.map((c) => (
						<button
							key={c}
							type="button"
							aria-pressed={country === c}
							onClick={() => setCountry(c)}
							className={`min-h-10 rounded-xl border px-4 text-sm font-medium transition-colors ${
								country === c
									? "border-accent bg-accent/10 text-foreground"
									: "border-input bg-background text-muted-foreground hover:border-ring"
							}`}
						>
							{COUNTRY_LABELS[c]}
						</button>
					))}
				</div>
				<span className="text-xs text-muted-foreground">
					An SG store is created with SGD pricing — set this before they add
					products.
				</span>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<label
					htmlFor="new-retailer-wa-phone"
					className="flex flex-col gap-1 text-sm font-medium"
				>
					<span className="min-h-5">WhatsApp number</span>
					{/* Follows the country toggle above — the invite rides this number
					    into createRetailer, which validates it with the same country. */}
					<MyPhoneInput
						id="new-retailer-wa-phone"
						value={waPhone}
						onChange={setWaPhone}
						country={country}
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm font-medium">
					<span className="flex min-h-5 items-center gap-1">
						{mode === "build" ? "Handover email" : "Client email"}
						<span className="font-normal text-muted-foreground">
							{mode === "build" ? "(optional)" : "(to send to)"}
						</span>
					</span>
					<Input
						type="email"
						inputMode="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="client@email.com"
						variant="field"
					/>
					{/* The server's own sentence, not a second copy of the rule — a
					    "waiting" clash and an "owns" clash have different fixes and
					    the helper words each one. */}
					{emailConflict ? (
						<span className="text-xs text-destructive">
							{emailConflict.message}
						</span>
					) : mode === "build" ? (
						<span className="text-xs text-muted-foreground">
							The address they'll sign up with — that sign-in hands them the
							store. <strong className="font-medium">Leave it blank</strong> if
							you don't have it yet: the store waits under Sellers →{" "}
							<strong className="font-medium">Unclaimed</strong> until you set
							it from Manage → Handover email.
						</span>
					) : null}
				</label>
			</div>

			{/* Disabled-with-reason rather than hidden in build mode: an admin
			    onboarding a founding vendor must be told WHY the toggle is
			    unavailable and what to do instead, not left wondering where it
			    went. A pre-built store reserves no rank at create — a slot held by
			    a store that may never be claimed would eat one of ten — so the
			    rank is claimed the ordinary way, by issuing the founding invoice
			    after handover. */}
			<label className="flex items-start gap-2.5 text-sm">
				<input
					type="checkbox"
					checked={mode === "link" && founding && foundingAvailable}
					disabled={!foundingAvailable || mode === "build"}
					onChange={(e) => setFounding(e.target.checked)}
					className="mt-0.5 size-4 disabled:opacity-50"
				/>
				<span>
					<span className="font-medium">Founding Member</span>
					<span className="block text-xs text-muted-foreground">
						{mode === "build"
							? "Not set at build time — a pre-built store holds no founding rank. Issue them a founding invoice after they claim it."
							: foundingAvailable
								? `Reserves a founding rank + the lifetime discount. Starts on the normal 14-day trial; Pro begins once they pay the founding invoice. ${spotsRemaining}/10 spots left.`
								: "All 10 founding spots are taken."}
					</span>
				</span>
			</label>

			{mode === "link" && ready && link ? (
				<div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3">
					<p className="break-all font-mono text-xs text-muted-foreground">
						{link}
					</p>
				</div>
			) : null}
			{/* What happens the moment they tap it — a create that also drops them
			    into act-as is a bigger jump than a copy, so it is written down
			    before the click rather than discovered after. Both buttons are
			    named here because the difference between them IS the consequence. */}
			{mode === "build" ? (
				<p className="text-xs text-muted-foreground">
					<strong className="font-medium">Start setting up</strong> opens the
					store straight away in act-as mode so you can add products;{" "}
					<strong className="font-medium">Add another</strong> leaves you here
					with the form cleared, for building a batch up front. Either way
					nothing is billed and it stays off kedaipal.com/stores until they
					claim it — their 14-day free period starts the day they do.
				</p>
			) : null}

			{/* The running receipt for a batch, directly above the button that
			    grows it, so an admin clearing the form twenty times can see what
			    already landed without leaving the card. It links to the directory's
			    Unclaimed filter rather than growing a second directory here: that
			    filter is already where a half-finished handover is tracked, and one
			    idea gets one control. */}
			{createdHere.length > 0 ? (
				<div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-border bg-muted/30 p-3">
					<p className="text-xs font-semibold">
						Created here · {createdHere.length}
					</p>
					<ul className="flex flex-col gap-0.5">
						{createdHere.map((store) => (
							<li key={store.slug} className="text-xs text-muted-foreground">
								{store.storeName}{" "}
								<span className="font-mono">/{store.slug}</span>
							</li>
						))}
					</ul>
					<Link
						to="/app/admin/sellers"
						search={{ status: "unclaimed" }}
						// The one interactive element in the panel, so it carries a
						// real 44px target rather than a 12px line of text.
						className="inline-flex min-h-11 w-fit items-center text-xs font-medium text-accent underline-offset-2 hover:underline"
					>
						Open them in Sellers → Unclaimed
					</Link>
				</div>
			) : null}

			<div className="flex flex-col gap-2 lg:flex-row lg:self-start">
				<Button
					type="button"
					onClick={mode === "build" ? () => void handleBuild(true) : handleCopy}
					disabled={!ready || building}
					className="h-11 lg:w-auto lg:px-6"
				>
					{mode === "build" ? (
						building ? (
							<>
								<Loader2 className="size-4 animate-spin" /> Creating…
							</>
						) : (
							<>
								<Hammer className="size-4" /> Create store &amp; start setting
								up
							</>
						)
					) : copied ? (
						<>
							<Check className="size-4" /> Copied
						</>
					) : (
						<>
							<Send className="size-4" /> Copy invite link
						</>
					)}
				</Button>
				{/* Build mode only: there is nothing to repeat in link mode, where
				    the action is a copy and the form is the thing you keep. */}
				{mode === "build" ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => void handleBuild(false)}
						disabled={!ready || building}
						className="h-11 lg:w-auto lg:px-6"
					>
						<Plus className="size-4" /> Create &amp; add another
					</Button>
				) : null}
			</div>
			{/* Disabled-with-reason — both buttons go quiet on an invalid name or
			    slug or a clashing email, and the three are not the same fix.
			    For the clash it POINTS rather than restates: the field already
			    carries the server's full sentence in destructive red a few rows
			    up, and a muted paraphrase beside it reads as a second problem.
			    One idea, one voice. */}
			{!ready ? (
				<p className="text-xs text-muted-foreground">
					{!nameCheck.ok
						? "Enter a store name first."
						: emailConflict
							? "Fix the handover email above."
							: "Pick a store link that's available."}
				</p>
			) : null}
		</AdminCard>
	);
}

/** Compact slug-availability line for the onboard-a-client form. */
function SlugHint({
	state,
}: {
	state: ReturnType<typeof useSlugAvailability>;
}) {
	if (state.status === "idle" || state.status === "checking") return null;
	if (state.status === "available")
		return <p className="text-xs text-accent">✓ Available</p>;
	const message = state.status === "taken" ? "Slug is taken" : state.message;
	return <p className="text-xs text-destructive">✗ {message}</p>;
}

const STATUS_LABEL: Record<string, string> = {
	trialing: "Free period",
	active: "Active",
	past_due: "Past due",
	cancelled: "Cancelled",
	on_hold: "On hold",
};

/** Human-readable dropdown label: "Mak Kuih (/mak-kuih) · Pro · Trial · Founding · has pending". */
function retailerOptionLabel(r: {
	storeName: string;
	slug: string;
	status?: string;
	plan?: string;
	isFoundingMember: boolean;
	foundingIntent: boolean;
	foundingBenefitsRevoked: boolean;
	hasPending: boolean;
	comped: boolean;
	unclaimed: boolean;
}): string {
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const parts = [`${r.storeName} (/${r.slug})`];
	if (r.plan) parts.push(cap(r.plan));
	if (r.status) parts.push(STATUS_LABEL[r.status] ?? cap(r.status));
	// Membership and benefits are two facts, and when Arif is about to bill
	// someone he needs the second one: "Founding" alone would read as "charge
	// them RM104" for a member whose benefits lapsed months ago.
	if (r.isFoundingMember)
		parts.push(
			r.foundingBenefitsRevoked ? "Founding · benefits ended" : "Founding",
		);
	else if (r.foundingIntent) parts.push("Founding (trial)");
	if (r.hasPending) parts.push("has pending");
	// Comped stores can't be billed (issueInvoice refuses, z8r3fdeub2) — say so
	// in the picker rather than letting the admin draft a bill that bounces.
	// A store nobody owns yet is comped too (the `internal` setup comp), but
	// calling that "on the house" reads as a sponsorship an admin should go and
	// end. It is scaffolding, and the claim clears it by itself.
	if (r.unclaimed) parts.push("waiting for its owner");
	else if (r.comped) parts.push("on the house");
	return parts.join(" · ");
}

/**
 * Issue a pending invoice — covers standard conversions/renewals AND onboarding a
 * Founding-10 member (founding toggle). Built for minimal typing: amount is
 * derived from plan + cycle + founding; the due date defaults to +14 days.
 */
function IssueInvoiceForm() {
	const retailerSelectId = useId();
	const retailers = useQuery(
		convexQuery(api.invoices.listRetailersForAdmin, {}),
	).data;
	const spotsRemaining = useQuery(
		convexQuery(api.foundingMembers.getSpotsRemaining, {}),
	).data;
	const issue = useMutation(api.invoices.issueInvoice);

	const [retailerId, setRetailerId] = useState<Id<"retailers"> | "">("");
	const [plan, setPlan] = useState<Plan>("pro");
	const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
	// The operator's OVERRIDE only — not the effective value. See `founding`.
	const [foundingOverride, setFoundingOverride] = useState(false);
	const [currency, setCurrency] = useState<BillingCurrency>("MYR");
	const [busy, setBusy] = useState(false);

	const selected = retailers?.find((r) => r._id === retailerId);
	const blocked = selected?.hasPending === true;
	// On the house (z8r3fdeub2) — issueInvoice refuses these server-side; the
	// button is disabled with the reason instead of bouncing on click.
	// A store nobody owns yet is ALSO comped — the `internal` setup comp — but
	// that is scaffolding, not a sponsorship, and it clears itself into a fresh
	// 14-day Pro trial the moment the vendor claims the store. Telling an admin
	// to "end the comp" would have them tear down the scaffolding instead of
	// finishing the handover, so the two states speak separately.
	const unclaimedStore = selected?.unclaimed === true;
	const compedStore = selected?.comped === true && !unclaimedStore;
	// Auto-apply (and lock) the founding discount when the store is on founding
	// PRICING — an existing Founding Member whose benefits still stand, or a store
	// onboarded as one (foundingIntent, still on the 14-day trial) — so the
	// conversion/renewal invoice always carries their discount.
	//
	// A member whose benefits were revoked (z8r3fdfyw5) is deliberately NEITHER
	// ticked NOR locked: ticked would hand back the discount the daily pass just
	// took, and locked would leave Arif unable to untick it — the machine undoing
	// its own rule, with no manual way out. Unticked but ENABLED keeps the
	// standing posture that the admin form is Arif's override in both directions.
	const foundingBenefitsRevoked = selected?.foundingBenefitsRevoked === true;
	const isExistingFounding =
		(selected?.isFoundingMember === true && !foundingBenefitsRevoked) ||
		selected?.foundingIntent === true;
	// DERIVED, never stored: a locked store IS on founding pricing, so the
	// checkbox and the Amount cannot disagree with the lock. This used to be an
	// effect copying `isExistingFounding` into state on `[retailerId]` — fine
	// while a store's founding status was fixed for a given retailer, but
	// revoking or restoring in the Founding members card below now moves it for a
	// retailerId that never changed. The label and helper copy updated reactively
	// while the checkbox and Amount did not, so the form read "bills at the
	// standard price" directly above "RM 104.00 − RM 45.00 founding discount",
	// and Issue would have charged the founding price to a member whose benefits
	// had just been taken (found while testing, 18 Sep 2026). Deriving makes that
	// state unreachable rather than merely re-synced — there is no dependency
	// array left to get wrong.
	const founding = isExistingFounding || foundingOverride;
	// The override is the operator's own tick, so it clears when they pick a
	// DIFFERENT store — never when a revoke elsewhere on the page changes the
	// status. Currency clears with it: an SGD pick left over from the previous
	// store must never silently carry to a Malaysian retailer (an SGD invoice
	// ships with no bank/DuitNow block).
	// biome-ignore lint/correctness/useExhaustiveDependencies: retailerId is the TRIGGER, not a read — picking a different store is exactly what clears the operator's override
	useEffect(() => {
		setFoundingOverride(false);
		setCurrency("MYR");
		// A contract store ARMS its contract (z8r3fdkp8h, found live on 2 Oct):
		// the previous default left Pro · RM 149.00 one click from issue for a
		// store whose paid Pro bill would take it OFF its contract — the most
		// drastic action on this form as the silent default. Picking another
		// plan stays possible (that IS the manual off-ramp), and the line
		// under the amount then says what paying it does.
		setPlan(
			retailers?.find((r) => r._id === retailerId)?.enterprise
				? "enterprise"
				: "pro",
		);
	}, [retailerId]);

	// Founding is Pro-only — flipping it on forces Pro. It prices per billing
	// currency (RM104 / S$41 monthly).
	const effectivePlan: Plan = founding ? "pro" : plan;
	// Enterprise (T6) bills the store's CONTRACT — its fee, currency and term —
	// so those controls show the contract's values instead of taking a pick.
	const contract = selected?.enterprise;
	const billsContract = effectivePlan === "enterprise";
	const effectiveCycle =
		billsContract && contract ? contract.billingCycle : cycle;
	const effectiveCurrency =
		billsContract && contract ? contract.currency : currency;
	// Derived amount (single source of truth from convex/lib/plans).
	const total =
		effectivePlan === "enterprise"
			? contract
				? enterprisePrice(contract, effectiveCycle)
				: 0
			: planPrice(effectivePlan, cycle, founding, currency);
	const base =
		effectivePlan === "enterprise"
			? total
			: planPrice(effectivePlan, cycle, false, currency);
	// What an annual invoice actually buys the seller. Shown to the operator
	// because "RM 1,490.00" alone doesn't say whether it covers ten months or
	// twelve — and this form is where an annual switch is honoured by hand.
	const annual =
		effectivePlan === "enterprise"
			? null
			: annualQuote(effectivePlan, founding, currency);
	const noContract = billsContract && !contract;
	// The deliberate off-ramp, named before the tap: a non-enterprise bill on
	// a contract store ends the contract when it's PAID (settle treats it as
	// the move to Pro/Starter).
	const offContractBill = contract !== undefined && !billsContract;

	async function handleIssue() {
		if (!retailerId) return;
		setBusy(true);
		try {
			// No dueDate — the system sets it (issue + 14 days). The paid cycle
			// starts at mark-paid.
			await issue({
				retailerId,
				plan: effectivePlan,
				billingCycle: effectiveCycle,
				founding,
				currency: effectiveCurrency,
			});
			toast.success("Invoice issued — it's now in Pending below.");
			setRetailerId("");
			setFoundingOverride(false);
			// Reset to the default so the next store isn't silently billed in SGD.
			setCurrency("MYR");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<AdminCard>
			<AdminSectionHeading
				icon={<FilePlus2 className="size-5" />}
				title="Issue an invoice"
				description="Pick a retailer, plan and cycle — the amount and due date (14 days) are set automatically. The paid cycle starts when you mark it paid."
				aside={
					spotsRemaining !== undefined ? (
						<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
							{spotsRemaining}/10 founding left
						</span>
					) : null
				}
			/>

			<div className="flex flex-col gap-1">
				<label htmlFor={retailerSelectId} className="text-sm font-medium">
					Retailer
				</label>
				<Select
					id={retailerSelectId}
					variant="field"
					className="w-full"
					value={retailerId}
					onChange={(e) => setRetailerId(e.target.value as Id<"retailers">)}
				>
					<option value="">Select a store…</option>
					{retailers?.map((r) => (
						<option key={r._id} value={r._id}>
							{retailerOptionLabel(r)}
						</option>
					))}
				</Select>
			</div>

			<div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/20 p-3 lg:grid-cols-2 lg:p-4">
				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">
						Plan
					</span>
					{/* Every tier, in tier order. Enterprise bills the store's
					    contract, so it needs one (set in Sellers → the store). */}
					<div className="grid grid-cols-3 gap-1.5 rounded-xl bg-background p-1 shadow-inner shadow-border/40">
						{PLANS.map((p) => (
							<button
								key={p}
								type="button"
								disabled={
									// Founding locks the plan to Pro — EXCEPT Enterprise, which
									// a founding store may take: a contract's negotiated fee is
									// its own price, so there is no founding discount to lose.
									(founding && p !== "pro" && p !== "enterprise") ||
									(p === "enterprise" && !contract)
								}
								onClick={() => setPlan(p)}
								className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold capitalize transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
									effectivePlan === p
										? "border-accent/50 bg-accent/10 text-accent shadow-sm"
										: "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
								}`}
							>
								{effectivePlan === p ? <Check className="size-3.5" /> : null}
								{p}
							</button>
						))}
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">
						Billing
					</span>
					<div className="grid grid-cols-2 gap-1.5 rounded-xl bg-background p-1 shadow-inner shadow-border/40">
						{(["monthly", "annual"] as const).map((c) => (
							<button
								key={c}
								type="button"
								disabled={billsContract}
								onClick={() => setCycle(c)}
								className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold capitalize transition-all disabled:cursor-not-allowed ${
									effectiveCycle === c
										? "border-accent/50 bg-accent/10 text-accent shadow-sm"
										: "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
								}`}
							>
								{effectiveCycle === c ? <Check className="size-3.5" /> : null}
								{c}
							</button>
						))}
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">
						Currency
					</span>
					<div className="grid grid-cols-2 gap-1.5 rounded-xl bg-background p-1 shadow-inner shadow-border/40">
						{BILLING_CURRENCIES.map((cur) => (
							<button
								key={cur}
								type="button"
								disabled={billsContract}
								onClick={() => setCurrency(cur)}
								className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold transition-all disabled:cursor-not-allowed ${
									effectiveCurrency === cur
										? "border-accent/50 bg-accent/10 text-accent shadow-sm"
										: "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
								}`}
							>
								{effectiveCurrency === cur ? (
									<Check className="size-3.5" />
								) : null}
								{cur === "MYR" ? "RM (MYR)" : "S$ (SGD)"}
							</button>
						))}
					</div>
					{billsContract ? (
						<span className="text-[11px] text-muted-foreground">
							Set by the store's Enterprise contract — the term and currency it
							was agreed in.
						</span>
					) : null}
					{effectiveCurrency === "SGD" ? (
						<span className="text-[11px] text-muted-foreground">
							SGD invoices carry no bank/DuitNow block — payment is arranged
							over WhatsApp.
						</span>
					) : null}
				</div>
			</div>

			<label className="flex items-center gap-2.5 text-sm">
				<input
					type="checkbox"
					checked={founding}
					disabled={isExistingFounding || billsContract}
					onChange={(e) => setFoundingOverride(e.target.checked)}
					className="size-4 disabled:opacity-60"
				/>
				<span>
					<span className="font-medium">Founding Member invoice</span>
					<span className="block text-xs text-muted-foreground">
						{isExistingFounding
							? "This store is a Founding Member — lifetime 30% discount applied automatically."
							: foundingBenefitsRevoked
								? "Founding Member, but their founding price ended after 3 months unpaid — this invoice bills at the standard price. Tick to re-grant the discount on this invoice only; to give it back for good, use Restore benefits under Founding members."
								: `Pro only · 30% lifetime discount · claims a rank when marked paid${
										spotsRemaining === 0
											? " (cohort full — no rank will be claimed)"
											: ""
									}`}
					</span>
				</span>
			</label>

			<div className="grid gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground">Amount</p>
					<p className="text-xl font-bold tabular-nums">
						{noContract ? "—" : formatPrice(total, effectiveCurrency)}
					</p>
					{billsContract && contract ? (
						<p className="text-xs text-muted-foreground">
							From the contract:{" "}
							{formatPrice(contract.baseFeeMinor, contract.currency)} a month
							{effectiveCycle === "annual" ? " × 10 for the year" : ""}.
						</p>
					) : null}
					{offContractBill ? (
						<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
							This store is on an Enterprise contract — paying this{" "}
							{PLAN_LABEL[effectivePlan]} bill ends the contract and moves it to{" "}
							{PLAN_LABEL[effectivePlan]}. That's the manual off-ramp; if you
							meant to bill the contract, pick Enterprise.
						</p>
					) : null}
					{founding ? (
						<p className="text-xs text-emerald-700">
							{formatPrice(base, currency)} −{" "}
							{formatPrice(base - total, currency)} founding discount
						</p>
					) : null}
					{annual && cycle === "annual" ? (
						<p className="text-xs text-muted-foreground">
							Covers {ANNUAL_MONTHS_RECEIVED} months ·{" "}
							{formatPrice(annual.saving, currency)} saved (2 months free) ·{" "}
							{formatPrice(annual.effectiveMonthly, currency)}/mo effective
						</p>
					) : null}
				</div>
				<Button
					type="button"
					onClick={handleIssue}
					disabled={
						!retailerId ||
						busy ||
						blocked ||
						compedStore ||
						unclaimedStore ||
						noContract
					}
					className="h-11 w-full sm:w-auto sm:px-6"
				>
					{busy ? "Issuing…" : "Issue invoice"}
				</Button>
			</div>
			{blocked ? (
				<p className="text-xs text-amber-700">
					This retailer already has a pending invoice — settle it first.
				</p>
			) : null}
			{selected && !contract ? (
				<p className="text-xs text-muted-foreground">
					Enterprise bills a store's contract — put this store on one from Admin
					· Sellers → the store → Enterprise to bill it here.
				</p>
			) : null}
			{unclaimedStore ? (
				<p className="text-xs text-amber-700">
					Nobody owns this store yet, so there's nobody to bill — the server
					refuses it and the daily renewal skips it.{" "}
					{selected?.comped
						? "It runs unbilled while you build it, and the day the vendor claims it they start a 14-day Pro trial — bill them after that."
						: "It already carries a live plan, which keeps its current period. Billing picks up again once the new owner claims it."}
				</p>
			) : null}
			{compedStore ? (
				<p className="text-xs text-amber-700">
					This store is on the house
					{selected?.compLabel ? ` (${selected.compLabel})` : ""} — it can't be
					billed. End the comp from Admin · Sellers first.
				</p>
			) : null}
		</AdminCard>
	);
}

function PendingInvoices() {
	const invoices = useQuery(convexQuery(api.invoices.listPending, {})).data;
	// One clock per render, so a row's pill and its line can't disagree.
	const now = Date.now();
	const markPaid = useMutation(api.invoices.markPaid);
	const voidInvoice = useMutation(api.invoices.voidInvoice);
	const [confirming, setConfirming] = useState<
		NonNullable<typeof invoices>[number] | null
	>(null);
	const [voiding, setVoiding] = useState<
		NonNullable<typeof invoices>[number] | null
	>(null);
	const [voidReason, setVoidReason] = useState("");
	const [busy, setBusy] = useState(false);

	async function handleMarkPaid(id: Id<"invoices">) {
		setBusy(true);
		try {
			const res = await markPaid({ invoiceId: id });
			toast.success(
				res.rank !== null
					? `Marked paid — Founding Member #${res.rank} claimed`
					: "Marked paid",
			);
			setConfirming(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleVoid(id: Id<"invoices">) {
		setBusy(true);
		try {
			await voidInvoice({
				invoiceId: id,
				reason: voidReason.trim() ? voidReason.trim() : undefined,
			});
			toast.success("Invoice voided");
			setVoiding(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<AdminCard>
			<AdminSectionHeading
				icon={<ListChecks className="size-5" />}
				title="Pending invoices"
				description="Settle invoices only after the payment has landed. Marking paid activates access and may claim a founding rank."
			/>
			{invoices === undefined ? (
				<Skeleton className="h-16 w-full rounded-xl" />
			) : invoices.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
					No pending invoices — all settled.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{invoices.map((inv) => (
						<li
							key={inv._id}
							className="grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
						>
							<div className="min-w-0 space-y-2">
								<div className="flex flex-wrap items-center gap-2">
									<p className="min-w-0 truncate text-sm font-semibold">
										{inv.storeName}
									</p>
									<span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
										/{inv.slug}
									</span>
									<span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium uppercase text-accent">
										{inv.plan}
									</span>
									{/* Off-Season Hold (z8r3fday24): this bill is the RM19/S$9
									    hold, not the tier — the tier pill above is what they
									    resume to. */}
									{inv.kind === "hold" ? (
										<span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
											Off-Season Hold
										</span>
									) : null}
									{/* Marking this paid grants 365 days instead of 30. Without
									    the pill an annual and a monthly pending invoice look
									    identical apart from the amount. */}
									{inv.billingCycle === "annual" ? (
										<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
											Annual
										</span>
									) : null}
									{/* Which RAIL this bill is on (86eyb6z4r) — so "who needs
									    chasing vs who settles themselves" is a glance. */}
									{inv.autoRenew ? (
										<AutoChargePill
											description={describeAutoCharge(inv.autoRenew, now)}
										/>
									) : inv.hasPayNowLink ? (
										<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
											Pay-now link
										</span>
									) : null}
									{inv.origin !== "admin" ? (
										<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
											{inv.origin === "self_serve"
												? "Self-serve"
												: inv.origin === "free_period_end"
													? "First invoice"
													: "Renewal"}
										</span>
									) : null}
									{/* Paying this takes the store off its contract (T6) —
									    worth seeing before marking it paid or voiding it. */}
									{inv.endsContract ? (
										<span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
											Ends Enterprise contract
										</span>
									) : null}
								</div>
								<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span className="font-mono">{inv.invoiceNumber}</span>
									<span>
										Due{" "}
										{new Date(inv.dueDate).toLocaleDateString(undefined, {
											day: "numeric",
											month: "short",
											year: "numeric",
										})}
									</span>
								</div>
								{inv.gatewayIssue ? (
									<p className="text-xs font-medium text-red-600 dark:text-red-400">
										{inv.gatewayIssue.kind === "amount_mismatch"
											? `⚠ A HitPay payment landed that doesn't match this total (${formatPrice(inv.gatewayIssue.amountSen ?? 0, inv.currency)}) — check the HitPay dashboard before settling.`
											: "⚠ A HitPay payment landed AFTER this invoice was settled/voided — possible double payment, check the HitPay dashboard."}
									</p>
								) : null}
								{inv.autoRenew ? (
									<AutoChargeDetail
										description={describeAutoCharge(inv.autoRenew, now)}
									/>
								) : null}
							</div>
							<div className="flex items-center justify-between gap-3 sm:justify-end">
								<span className="text-sm font-semibold tabular-nums">
									{formatPrice(inv.total, inv.currency)}
								</span>
								<div className="flex items-center gap-2">
									<InvoiceDownloadButton
										invoiceId={inv._id}
										label=""
										size="icon"
										variant="ghost"
										className="size-9"
									/>
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="h-9"
										onClick={() => {
											setVoidReason("");
											setVoiding(inv);
										}}
									>
										Void
									</Button>
									<Button
										type="button"
										size="sm"
										className="h-9"
										onClick={() => setConfirming(inv)}
									>
										Mark paid
									</Button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			<Dialog
				open={confirming !== null}
				onOpenChange={(o) => {
					if (!o) setConfirming(null);
				}}
			>
				<DialogContent showCloseButton={false} className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Mark {confirming?.invoiceNumber} paid?</DialogTitle>
						<DialogDescription>
							This grants {confirming?.storeName} full access, may claim a
							Founding Member rank, and sends a welcome WhatsApp. It can't be
							undone here.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirming(null)}>
							Cancel
						</Button>
						<Button
							disabled={busy}
							onClick={() => confirming && handleMarkPaid(confirming._id)}
						>
							{busy ? "Marking…" : "Mark paid"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={voiding !== null}
				onOpenChange={(o) => {
					if (!o) setVoiding(null);
				}}
			>
				<DialogContent showCloseButton={false} className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Void {voiding?.invoiceNumber}?</DialogTitle>
						<DialogDescription>
							Cancels this pending invoice for {voiding?.storeName}. It stays in
							their history as “Cancelled” and frees them up for a corrected
							invoice. Use this for an invoice issued by mistake — not one
							that's been paid.
							{voiding?.carriesScheduledChange ? (
								<>
									{" "}
									<strong className="font-medium text-foreground">
										This renewal carries a scheduled move to{" "}
										{voiding.plan === "pro" ? "Pro" : "Starter"}
									</strong>
									: voiding it keeps the move scheduled, and the next daily run
									bills it again.{" "}
									{voiding.endsContract
										? "To keep the store on its contract, use “Call off the move to Pro” in Sellers → the store."
										: "The seller can call the move off from their billing page."}
								</>
							) : null}
						</DialogDescription>
					</DialogHeader>
					<label className="flex flex-col gap-1 text-sm font-medium">
						Reason{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
						<Input
							value={voidReason}
							onChange={(e) => setVoidReason(e.target.value)}
							placeholder="e.g. wrong amount"
							variant="field"
						/>
					</label>
					<DialogFooter>
						<Button variant="outline" onClick={() => setVoiding(null)}>
							Keep invoice
						</Button>
						<Button
							disabled={busy}
							onClick={() => voiding && handleVoid(voiding._id)}
						>
							{busy ? "Voiding…" : "Void invoice"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</AdminCard>
	);
}

function foundingStatus(m: { status?: string; paid: boolean }): {
	label: string;
	className: string;
} {
	if (m.status === "past_due")
		return {
			label: "Past due",
			className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
		};
	if (m.paid && m.status === "active")
		return {
			label: "Active",
			className:
				"bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
		};
	if (m.status === "trialing")
		return {
			label: "Pending payment",
			className:
				"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
		};
	return {
		label: m.status ?? "—",
		className: "bg-muted text-muted-foreground",
	};
}

/** Which retailers are on the auto-renewal rail + who is failing (86eyb6z4r).
 * Failing rows sort first (the query orders them), so trouble is the first
 * thing on screen. */
function AutoRenewOverview() {
	const rows = useQuery(
		convexQuery(api.subscriptionPayments.listAutoRenewForAdmin, {}),
	).data;
	const now = Date.now();

	return (
		<AdminCard>
			<AdminSectionHeading
				icon={<RefreshCw className="size-5" />}
				title="Auto-renewal"
				description="Retailers with a saved payment method. Their renewals charge themselves; failures dun by email and fall back to the Pay-now link."
			/>
			{rows === undefined ? (
				<Skeleton className="h-16 w-full rounded-xl" />
			) : rows.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
					Nobody is on auto-renewal yet — sellers turn it on in Settings →
					Billing.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{rows.map((row) => (
						<li
							key={row.retailerId}
							className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3"
						>
							<div className="min-w-0 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<p className="min-w-0 truncate text-sm font-semibold">
										{row.storeName}
									</p>
									<span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
										/{row.slug}
									</span>
									<AutoChargePill
										description={describeAutoCharge(row.charge, now)}
										showHealthy={false}
									/>
								</div>
								<p className="text-xs text-muted-foreground">
									{row.methodLabel}
									{row.lastChargeAt
										? ` · last charged ${formatShortDate(row.lastChargeAt)}`
										: " · no charge yet"}
								</p>
								<AutoChargeDetail
									description={describeAutoCharge(row.charge, now)}
								/>
							</div>
						</li>
					))}
				</ul>
			)}
		</AdminCard>
	);
}

/**
 * Admin: the 10-slot cohort — who's reserved, where each one sits in the pay
 * cycle, and the state of their founding BENEFITS (z8r3fdfyw5).
 *
 * Membership and benefits are shown as two separate facts because they are two
 * separate facts: the rank pill is permanent, the benefit line is what can be
 * taken. The automatic rule does the taking at day 90; this list exists so the
 * question "why is #4 on standard pricing?" is answerable here rather than from
 * the logs, and so Arif has a lever either way — revoke a member who has
 * clearly gone, or restore one revoked wrongly.
 */
function FoundingMembersList() {
	const members = useQuery(
		convexQuery(api.foundingMembers.listForAdmin, {}),
	).data;
	const spotsRemaining = useQuery(
		convexQuery(api.foundingMembers.getSpotsRemaining, {}),
	).data;
	const setBenefits = useMutation(api.foundingMembers.adminSetBenefits);
	// The row awaiting confirmation, and which direction it's going.
	const [pending, setPending] = useState<{
		retailerId: Id<"retailers">;
		storeName: string;
		rank: number;
		revoke: boolean;
	} | null>(null);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);

	async function apply() {
		if (!pending) return;
		setBusy(true);
		try {
			const changed = await setBenefits({
				retailerId: pending.retailerId,
				revoked: pending.revoke,
				note: note.trim() === "" ? undefined : note.trim(),
			});
			// The mutation refuses rather than throws when there is nothing to do
			// (already in that state, or the retailer is gone) — reporting that as
			// success would tell Arif he had changed something he hadn't.
			if (changed) {
				toast.success(
					pending.revoke
						? `Founding benefits revoked for ${pending.storeName} — rank #${pending.rank} and badge kept.`
						: `Founding benefits restored for ${pending.storeName} — their founding price applies again from now.`,
				);
			} else {
				toast.info(
					`No change — ${pending.storeName} is already ${pending.revoke ? "revoked" : "on founding pricing"}.`,
				);
			}
			setPending(null);
			setNote("");
		} catch (err) {
			// The lone hand-rolled reader left in the app — `err.message` here is
			// the raw Convex wrapper, stack frames and all. Every other catch
			// already goes through the shared unwrapper.
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<AdminCard>
			<AdminSectionHeading
				icon={<Award className="size-5" />}
				title="Founding members"
				description="The 10-slot cohort — who's reserved, where they are in the pay cycle, and whether their founding benefits still stand. Rank and badge are permanent; benefits end 90 days past paid-through."
				aside={
					spotsRemaining !== undefined ? (
						<span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
							{10 - spotsRemaining}/10 claimed
						</span>
					) : null
				}
			/>
			{members === undefined ? (
				<Skeleton className="h-16 w-full rounded-xl" />
			) : members.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
					No founding members yet — onboard one with the Founding toggle, or
					tick Founding when issuing an invoice.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{members.map((m) => {
						const s = foundingStatus(m);
						const revoked = m.benefitsRevokedAt !== undefined;
						// The slot is claimed by a store that no longer exists (a partial
						// account purge). Shown so the header's count and this list agree,
						// and so the row the daily pass skips is visible rather than
						// inferred — but with no Revoke/Restore lever, because there is
						// nothing left to revoke.
						if (m.retailerMissing) {
							return (
								<li
									key={m.rank}
									className="flex items-start gap-2.5 rounded-xl border border-dashed border-border bg-muted/30 p-3"
								>
									<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
										#{m.rank}
									</span>
									<span className="min-w-0">
										<span className="block truncate text-sm font-semibold text-muted-foreground">
											Store deleted
										</span>
										<span className="mt-0.5 block text-xs text-muted-foreground">
											This slot stays claimed and the daily benefit check skips
											it. Nothing to do — it clears if the account purge is
											completed.
										</span>
									</span>
								</li>
							);
						}
						return (
							<li
								key={m.rank}
								className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-start sm:justify-between"
							>
								{/* Stacked on a phone, side-by-side from sm. Side-by-side all
								    the way down squeezed the name column between the pill and
								    the button: "Bearcam…", a slug over three lines, and the
								    benefit line at two words a row.
								    items-START, not center: the benefit line makes this block
								    two or three lines tall, and a centred rank pill drifts down
								    beside the SLUG instead of the store name it labels. */}
								<div className="flex w-full items-start gap-2.5 sm:min-w-0 sm:flex-1">
									<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
										#{m.rank}
									</span>
									<span className="min-w-0">
										<span className="block truncate text-sm font-semibold">
											{m.storeName}
										</span>
										<span className="block font-mono text-xs text-muted-foreground">
											/{m.slug}
										</span>
										{/* The benefit line. Silent for a member whose benefits
										    are live and nowhere near the window — nine identical
										    "Benefits active" rows would bury the one that isn't. */}
										{revoked ? (
											<span className="mt-0.5 block text-xs text-muted-foreground">
												Benefits ended{" "}
												{m.benefitsRevokedAt !== undefined
													? formatShortDate(m.benefitsRevokedAt)
													: ""}
												{m.benefitsRevokedReason === "admin"
													? " · by admin"
													: " · lapsed"}
												{m.benefitsRevokedNote
													? ` · ${m.benefitsRevokedNote}`
													: ""}
											</span>
										) : m.benefitsEndAt !== undefined &&
											m.status !== "active" &&
											m.status !== "on_hold" ? (
											<span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
												Benefits end {formatShortDate(m.benefitsEndAt)}
												{m.warned ? " · warned" : " · not yet warned"}
											</span>
										) : null}
									</span>
								</div>
								<div className="flex shrink-0 items-center gap-2 pl-[38px] sm:pl-0">
									<span
										className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}
									>
										{s.label}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setNote("");
											setPending({
												retailerId: m.retailerId,
												storeName: m.storeName,
												rank: m.rank,
												revoke: !revoked,
											});
										}}
									>
										{revoked ? "Restore benefits" : "Revoke benefits"}
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			<Dialog
				open={pending !== null}
				onOpenChange={(o) => {
					if (!o) setPending(null);
				}}
			>
				<DialogContent showCloseButton={false} className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>
							{pending?.revoke
								? `Revoke founding benefits for ${pending?.storeName}?`
								: `Restore founding benefits for ${pending?.storeName}?`}
						</DialogTitle>
						<DialogDescription>
							{pending?.revoke
								? `Their 30% founding price ends now and every plan opens to them again at standard prices. Founding rank #${pending?.rank} and the storefront badge are KEPT — those are permanent. They are not emailed; this is a manual move, so tell them yourself.`
								: `Their 30% founding price applies again straight away and they go back to Founding Pro only. The 90-day lapse clock restarts from today, so if they still don't renew they'll be warned again 14 days before it ends. Use this for a revocation that was wrong, or a deliberate re-grant.`}
						</DialogDescription>
					</DialogHeader>
					<label className="flex flex-col gap-1 text-sm font-medium">
						Note{" "}
						<span className="font-normal text-muted-foreground">
							(optional — shown in this list)
						</span>
						<Input
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder={
								pending?.revoke ? "e.g. closed the business" : "e.g. re-granted"
							}
							variant="field"
						/>
					</label>
					<DialogFooter>
						<Button variant="outline" onClick={() => setPending(null)}>
							Cancel
						</Button>
						<Button disabled={busy} onClick={apply}>
							{busy
								? "Saving…"
								: pending?.revoke
									? "Revoke benefits"
									: "Restore benefits"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</AdminCard>
	);
}

function PaymentConfigForm() {
	const config = useQuery(convexQuery(api.billing.getBillingConfig, {})).data;
	const update = useMutation(api.billing.updateBillingConfig);
	const generateQrUploadUrl = useMutation(api.billing.generateQrUploadUrl);

	// Local form state seeded once the query resolves.
	const [draft, setDraft] = useState<{
		bankName: string;
		bankAccountName: string;
		bankAccountNumber: string;
		duitnowId: string;
	} | null>(null);
	const [saving, setSaving] = useState(false);
	const [uploading, setUploading] = useState(false);

	// Seed the form on first load.
	if (config !== undefined && draft === null) {
		setDraft({
			bankName: config.bankName ?? "",
			bankAccountName: config.bankAccountName ?? "",
			bankAccountNumber: config.bankAccountNumber ?? "",
			duitnowId: config.duitnowId ?? "",
		});
	}

	async function handleSave() {
		if (!draft) return;
		setSaving(true);
		try {
			await update({
				bankName: draft.bankName,
				bankAccountName: draft.bankAccountName,
				bankAccountNumber: draft.bankAccountNumber,
				duitnowId: draft.duitnowId,
			});
			toast.success("Payment details saved");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function handleQrUpload(file: File | null) {
		if (!file) return;
		setUploading(true);
		try {
			const prepared = await prepareImageUpload(file);
			if (!prepared.ok) {
				toast.error(prepared.message);
				return;
			}
			const url = await generateQrUploadUrl({});
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": prepared.contentType },
				body: prepared.blob,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			await update({ qrImageStorageId: storageId });
			toast.success("QR updated");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	async function handleQrRemove() {
		try {
			await update({ qrImageStorageId: null });
			toast.success("QR removed");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<AdminCard className="lg:max-w-3xl">
			<AdminSectionHeading
				icon={<Landmark className="size-5" />}
				title="Kedaipal payment details"
				description="Shown to retailers on their billing page. The WhatsApp number reuses the storefront checkout number."
			/>

			{draft === null ? (
				<Skeleton className="h-40 w-full rounded-xl" />
			) : (
				<>
					<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
						<div className="flex flex-col gap-4">
							<label className="flex flex-col gap-1 text-sm font-medium">
								Bank name
								<Input
									value={draft.bankName}
									onChange={(e) =>
										setDraft({ ...draft, bankName: e.target.value })
									}
									placeholder="Maybank"
									variant="field"
								/>
							</label>
							<label className="flex flex-col gap-1 text-sm font-medium">
								Account holder name
								<Input
									value={draft.bankAccountName}
									onChange={(e) =>
										setDraft({ ...draft, bankAccountName: e.target.value })
									}
									placeholder="Kedaipal Sdn Bhd"
									variant="field"
								/>
							</label>
							<label className="flex flex-col gap-1 text-sm font-medium">
								Account number
								<Input
									value={draft.bankAccountNumber}
									onChange={(e) =>
										setDraft({ ...draft, bankAccountNumber: e.target.value })
									}
									placeholder="5123 4567 8901"
									inputMode="numeric"
									variant="field"
									className="font-mono"
								/>
							</label>
							<label className="flex flex-col gap-1 text-sm font-medium">
								DuitNow ID
								<Input
									value={draft.duitnowId}
									onChange={(e) =>
										setDraft({ ...draft, duitnowId: e.target.value })
									}
									placeholder="DuitNow ID / phone"
									variant="field"
									className="font-mono"
								/>
							</label>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-sm font-medium">DuitNow QR</span>
							{config?.qrUrl ? (
								<div className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-background p-3">
									<AppImage
										src={config.qrUrl}
										alt="DuitNow QR"
										aspect="aspect-square w-full"
										rounded="rounded-xl"
										objectFit="contain"
									/>
									<button
										type="button"
										onClick={handleQrRemove}
										className="text-xs font-medium text-destructive underline-offset-2 hover:underline"
									>
										Remove QR
									</button>
								</div>
							) : (
								<label className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-input bg-background px-6 text-center text-sm text-muted-foreground hover:border-ring">
									{uploading ? (
										"Uploading…"
									) : (
										<>
											<ImagePlus className="size-5" /> Upload QR
										</>
									)}
									<input
										type="file"
										accept={IMAGE_ACCEPT}
										className="hidden"
										disabled={uploading}
										onChange={(e) =>
											handleQrUpload(e.target.files?.[0] ?? null)
										}
									/>
								</label>
							)}
						</div>
					</div>

					<div className="rounded-2xl border border-border bg-muted/30 p-4">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Retailer sees
						</p>
						<div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
							<div>
								<p className="text-xs text-muted-foreground">Bank</p>
								<p className="font-medium">
									{draft.bankName || "No bank name"}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Account</p>
								<p className="font-mono text-sm">
									{draft.bankAccountNumber || "No account number"}
								</p>
							</div>
						</div>
					</div>

					<Button
						type="button"
						onClick={handleSave}
						disabled={saving}
						className="h-11 lg:w-auto lg:self-end lg:px-6"
					>
						{saving ? "Saving…" : "Save details"}
					</Button>
				</>
			)}
		</AdminCard>
	);
}
