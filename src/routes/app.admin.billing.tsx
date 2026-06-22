import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	Banknote,
	CalendarClock,
	Check,
	CreditCard,
	FilePlus2,
	ImagePlus,
	Landmark,
	ListChecks,
	ReceiptText,
	Send,
	ShieldX,
	UserPlus,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { planPrice } from "../../convex/lib/plans";
import { PageHeader } from "../components/dashboard/page-header";
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
import { Skeleton } from "../components/ui/skeleton";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { convexErrorMessage, formatPrice } from "../lib/format";
import { buildOnboardingInviteLink } from "../lib/onboarding-link";
import { slugify } from "../lib/slug";

export const Route = createFileRoute("/app/admin/billing")({
	component: AdminBillingRoute,
});

function AdminBillingRoute() {
	const isAdmin = useQuery(api.billing.amIAdmin);

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
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
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
	const invoices = useQuery(api.invoices.listPending, {});
	const spotsRemaining = useQuery(api.foundingMembers.getSpotsRemaining, {});
	const pendingTotal = invoices?.reduce((sum, inv) => sum + inv.total, 0) ?? 0;
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
			value: invoices === undefined ? "..." : formatPrice(pendingTotal, "MYR"),
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
	);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DUE_DAYS = 14;

function toDateInput(ms: number): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fromDateInput(value: string): number {
	const [y, m, d] = value.split("-").map(Number);
	return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Onboard a client on their behalf. A retailer is always owned 1:1 by the
 * client's own Clerk login — we can't create it *for* them without an orphaned,
 * un-loginable store. So instead the admin fills the details here and gets a
 * prefilled onboarding link to send; the client opens it, signs in once, and
 * confirms — the store is created under *their* account. After they confirm, they
 * appear in the Issue-invoice picker below. See docs/manual-subscription.md.
 */
function OnboardClientCard() {
	const [storeName, setStoreName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugEdited, setSlugEdited] = useState(false);
	const [waPhone, setWaPhone] = useState("");
	const [email, setEmail] = useState("");
	const [copied, setCopied] = useState(false);

	// Mirror the onboarding form: derive the slug from the name until hand-edited,
	// and check availability live so we never hand out a link to a taken slug.
	const derivedSlug = slugEdited ? slug : slugify(storeName);
	const availability = useSlugAvailability(derivedSlug);

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
		api.retailers.checkEmailHasStore,
		emailLooksValid ? { email: debouncedEmail } : "skip",
	);
	const emailTaken = emailCheck?.exists === true;

	const ready =
		storeName.trim().length >= 2 &&
		availability.status === "available" &&
		!emailTaken;

	const link =
		typeof window === "undefined"
			? ""
			: buildOnboardingInviteLink(window.location.origin, {
					storeName,
					slug: derivedSlug,
					waPhone,
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
		<AdminCard>
			<AdminSectionHeading
				icon={<UserPlus className="size-5" />}
				title="Onboard a client"
				description="Fill what you know, copy the invite link, and send it manually. They confirm under their own login before invoicing."
			/>

			<label className="flex flex-col gap-1 text-sm font-medium">
				Store name
				<Input
					value={storeName}
					onChange={(e) => setStoreName(e.target.value)}
					placeholder="e.g. Mak Cik Kuih"
					variant="field"
				/>
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

			<div className="grid gap-4 sm:grid-cols-2">
				<label className="flex flex-col gap-1 text-sm font-medium">
					<span className="min-h-5">WhatsApp number</span>
					<Input
						type="tel"
						inputMode="tel"
						value={waPhone}
						onChange={(e) => setWaPhone(e.target.value)}
						placeholder="60123456789"
						variant="field"
						className="font-mono"
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm font-medium">
					<span className="flex min-h-5 items-center gap-1">
						Client email
						<span className="font-normal text-muted-foreground">
							(to send to)
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
					{emailTaken ? (
						<span className="text-xs text-destructive">
							A store ({emailCheck?.storeName}) already uses this email. They
							can't create a second one; it's one store per login.
						</span>
					) : null}
				</label>
			</div>

			{ready && link ? (
				<div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3">
					<p className="break-all font-mono text-xs text-muted-foreground">
						{link}
					</p>
				</div>
			) : null}

			<Button
				type="button"
				onClick={handleCopy}
				disabled={!ready}
				className="h-11 lg:w-auto lg:self-start lg:px-6"
			>
				{copied ? (
					<>
						<Check className="size-4" /> Copied
					</>
				) : (
					<>
						<Send className="size-4" /> Copy invite link
					</>
				)}
			</Button>
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

/**
 * Issue a pending invoice — covers standard conversions/renewals AND onboarding a
 * Founding-10 member (founding toggle). Built for minimal typing: amount is
 * derived from plan + cycle + founding; the due date defaults to +14 days.
 */
function IssueInvoiceForm() {
	const retailers = useQuery(api.invoices.listRetailersForAdmin, {});
	const spotsRemaining = useQuery(api.foundingMembers.getSpotsRemaining, {});
	const issue = useMutation(api.invoices.issueInvoice);

	const [retailerId, setRetailerId] = useState<Id<"retailers"> | "">("");
	const [plan, setPlan] = useState<"starter" | "pro">("pro");
	const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
	const [founding, setFounding] = useState(false);
	const [dueDate, setDueDate] = useState(() =>
		toDateInput(Date.now() + DEFAULT_DUE_DAYS * DAY_MS),
	);
	const [busy, setBusy] = useState(false);

	// Founding is Pro-only — flipping it on forces Pro.
	const effectivePlan = founding ? "pro" : plan;
	// Derived amount (single source of truth from convex/lib/plans).
	const total = planPrice(effectivePlan, cycle, founding);
	const base = planPrice(effectivePlan, cycle, false);

	const selected = retailers?.find((r) => r._id === retailerId);
	const blocked = selected?.hasPending === true;

	async function handleIssue() {
		if (!retailerId) return;
		setBusy(true);
		try {
			await issue({
				retailerId,
				plan: effectivePlan,
				billingCycle: cycle,
				founding,
				dueDate: fromDateInput(dueDate),
			});
			toast.success("Invoice issued — it's now in Pending below.");
			setRetailerId("");
			setFounding(false);
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
				description="Choose a retailer, plan, billing cycle and due date. The amount is calculated automatically from the pricing rules."
				aside={
					spotsRemaining !== undefined ? (
						<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
							{spotsRemaining}/10 founding left
						</span>
					) : null
				}
			/>

			<label className="flex flex-col gap-1 text-sm font-medium">
				Retailer
				<select
					value={retailerId}
					onChange={(e) => setRetailerId(e.target.value as Id<"retailers">)}
					className="min-h-11 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				>
					<option value="">Select a store…</option>
					{retailers?.map((r) => (
						<option key={r._id} value={r._id}>
							{r.storeName} (/{r.slug}){r.status ? ` · ${r.status}` : ""}
							{r.isFoundingMember ? " · founding" : ""}
							{r.hasPending ? " · has pending" : ""}
						</option>
					))}
				</select>
			</label>

			<div className="grid gap-4 lg:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">
						Plan
					</span>
					<div className="grid grid-cols-3 gap-2">
						{(["pro", "starter"] as const).map((p) => (
							<button
								key={p}
								type="button"
								disabled={founding && p !== "pro"}
								onClick={() => setPlan(p)}
								className={`min-h-11 rounded-xl border px-3 text-sm font-medium capitalize transition-colors disabled:opacity-40 ${
									effectivePlan === p
										? "border-foreground bg-foreground text-background"
										: "border-border bg-background text-muted-foreground hover:border-foreground/30"
								}`}
							>
								{p}
							</button>
						))}
						<span className="flex min-h-11 flex-col items-center justify-center rounded-xl border border-dashed border-border px-2 text-center text-xs leading-tight text-muted-foreground">
							<span className="font-medium">Scale</span>
							<span>soon</span>
						</span>
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">
						Billing
					</span>
					<div className="grid grid-cols-2 gap-2">
						{(["monthly", "annual"] as const).map((c) => (
							<button
								key={c}
								type="button"
								onClick={() => setCycle(c)}
								className={`min-h-11 rounded-xl border px-3 text-sm font-medium capitalize transition-colors ${
									cycle === c
										? "border-foreground bg-foreground text-background"
										: "border-border bg-background text-muted-foreground hover:border-foreground/30"
								}`}
							>
								{c}
							</button>
						))}
					</div>
				</div>
			</div>

			<label className="flex items-center gap-2.5 text-sm">
				<input
					type="checkbox"
					checked={founding}
					onChange={(e) => setFounding(e.target.checked)}
					className="size-4"
				/>
				<span>
					<span className="font-medium">Founding Member invoice</span>
					<span className="block text-xs text-muted-foreground">
						Pro only · 30% lifetime discount · claims a rank when marked paid
						{spotsRemaining === 0
							? " (cohort full — no rank will be claimed)"
							: ""}
					</span>
				</span>
			</label>

			<label className="flex flex-col gap-1 text-sm font-medium">
				Due date
				<Input
					type="date"
					value={dueDate}
					onChange={(e) => setDueDate(e.target.value)}
					variant="field"
					className="w-full sm:w-fit"
				/>
			</label>

			<div className="grid gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground">Amount</p>
					<p className="text-xl font-bold tabular-nums">
						{formatPrice(total, "MYR")}
					</p>
					{founding ? (
						<p className="text-xs text-emerald-700">
							{formatPrice(base, "MYR")} − {formatPrice(base - total, "MYR")}{" "}
							founding discount
						</p>
					) : null}
				</div>
				<Button
					type="button"
					onClick={handleIssue}
					disabled={!retailerId || busy || blocked}
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
		</AdminCard>
	);
}

function PendingInvoices() {
	const invoices = useQuery(api.invoices.listPending, {});
	const markPaid = useMutation(api.invoices.markPaid);
	const [confirming, setConfirming] = useState<
		NonNullable<typeof invoices>[number] | null
	>(null);
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
							</div>
							<div className="flex items-center justify-between gap-3 sm:justify-end">
								<span className="text-sm font-semibold tabular-nums">
									{formatPrice(inv.total, inv.currency)}
								</span>
								<Button
									type="button"
									size="sm"
									className="h-9"
									onClick={() => setConfirming(inv)}
								>
									Mark paid
								</Button>
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
		</AdminCard>
	);
}

function PaymentConfigForm() {
	const config = useQuery(api.billing.getBillingConfig, {});
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
			const url = await generateQrUploadUrl({});
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
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
									<img
										src={config.qrUrl}
										alt="DuitNow QR"
										className="aspect-square w-full rounded-xl object-contain"
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
										accept="image/*"
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
