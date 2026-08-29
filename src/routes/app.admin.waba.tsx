import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	AlertOctagon,
	Ban,
	CircleCheck,
	Copy,
	type LucideIcon,
	Pause,
	Play,
	Search,
	Send,
	ShieldX,
	Siren,
	UserMinus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AdminOptOutRow } from "../../convex/wabaProtection";
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
import { MASK_PII } from "../lib/analytics-privacy";
import { convexErrorMessage } from "../lib/format";

export const Route = createFileRoute("/app/admin/waba")({
	component: AdminWabaRoute,
});

function AdminWabaRoute() {
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
	return <AdminWabaContent />;
}

type VendorRow = {
	_id: Id<"retailers">;
	storeName: string;
	slug: string;
	paused: boolean;
	pausedAt?: number;
	pauseReason?: string;
	sent30d: number;
	blocked30d: number;
	optOuts30d: number;
	statsCapped: boolean;
	optOutsCapped: boolean;
};

/** Format a possibly-capped 30d count: 300 (capped) → "300+". */
function statCount(n: number, capped: boolean): string {
	return capped ? `${n}+` : String(n);
}

/** Compact at-a-glance stat chip. `alert` tints it amber to draw the eye. */
function Stat({
	icon: Icon,
	label,
	value,
	alert = false,
}: {
	icon: LucideIcon;
	label: string;
	value: string;
	alert?: boolean;
}) {
	return (
		<span
			title={`${value} ${label} · last 30 days`}
			className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
				alert
					? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
					: "bg-muted text-muted-foreground"
			}`}
		>
			<Icon className="size-3 shrink-0" />
			<span className="font-medium">{value}</span>
			<span>{label}</span>
		</span>
	);
}

function AdminWabaContent() {
	const [search, setSearch] = useState("");
	const vendors = useQuery(
		convexQuery(api.wabaProtection.adminListVendors, { search }),
	).data;
	const [target, setTarget] = useState<VendorRow | null>(null);

	return (
		<div className="flex flex-col gap-6 lg:max-w-4xl">
			<PageHeader
				title="Admin · WABA Safety"
				subtitle="Pause a vendor's marketing sends to protect the shared WhatsApp number"
			/>
			<section className="flex flex-col gap-1 lg:hidden">
				<h2 className="text-xl font-bold">Admin · WABA Safety</h2>
				<p className="text-sm text-muted-foreground">
					Pause a misbehaving vendor's broadcast/marketing sends. Order
					confirmations are never affected.
				</p>
			</section>

			<HealthBanner />

			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search vendors by store name or slug…"
					className="pl-9"
				/>
			</div>

			{vendors === undefined ? (
				<div className="flex flex-col gap-2">
					{[0, 1, 2].map((n) => (
						<Skeleton key={n} className="h-16 w-full rounded-2xl" />
					))}
				</div>
			) : vendors.length === 0 ? (
				<p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
					No vendors match “{search}”.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{vendors.map((v) => (
						<li
							key={v._id}
							className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3"
						>
							<div className="flex min-w-0 flex-col gap-1.5">
								<div className="flex min-w-0 flex-col">
									<span className="truncate font-medium">{v.storeName}</span>
									<span className="truncate text-xs text-muted-foreground">
										/{v.slug}
									</span>
								</div>
								{v.paused ? (
									<span className="inline-flex w-fit items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
										<AlertOctagon className="size-3" /> Paused
										{v.pauseReason ? ` — ${v.pauseReason}` : ""}
									</span>
								) : (
									<span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
										<CircleCheck className="size-3" /> Active
									</span>
								)}
								{/* At-a-glance 30-day signals (no Meta needed). Blocked /
								    opt-outs go amber when non-zero — the "look here" cue. */}
								<div className="flex flex-wrap items-center gap-1.5">
									<Stat
										icon={Send}
										label="sent"
										value={statCount(v.sent30d, v.statsCapped)}
									/>
									<Stat
										icon={Ban}
										label="blocked"
										value={statCount(v.blocked30d, v.statsCapped)}
										alert={v.blocked30d > 0}
									/>
									<Stat
										icon={UserMinus}
										label="opt-outs"
										value={statCount(v.optOuts30d, v.optOutsCapped)}
										alert={v.optOuts30d > 0}
									/>
								</div>
							</div>
							<Button
								variant={v.paused ? "outline" : "destructive"}
								size="sm"
								className="shrink-0"
								onClick={() => setTarget(v)}
							>
								{v.paused ? (
									<>
										<Play className="size-4" /> Resume
									</>
								) : (
									<>
										<Pause className="size-4" /> Pause
									</>
								)}
							</Button>
						</li>
					))}
				</ul>
			)}

			<GlobalOptOutPanel />

			{target ? (
				<ConfirmDialog vendor={target} onClose={() => setTarget(null)} />
			) : null}
		</div>
	);
}

/**
 * Manual global opt-out (86eyn25gu). STOP only works for buyers who text the
 * shared number themselves — a counter buyer whose number the cashier typed
 * has no self-serve path. Status is fetched before any action so the button
 * always says what it will actually do, and the status line never echoes the
 * full number back (the input is already auto-masked in session replay;
 * rendered text would not be).
 */
function GlobalOptOutPanel() {
	const [phone, setPhone] = useState("");
	const valid = phone.replace(/\D/g, "").length >= 8;
	const status = useQuery(
		convexQuery(
			api.wabaProtection.adminOptOutStatus,
			valid ? { waPhone: phone } : "skip",
		),
	).data;
	const registerOptOut = useMutation(api.wabaProtection.adminRegisterOptOut);
	const reactivate = useMutation(api.wabaProtection.adminReactivateOptIn);
	const [submitting, setSubmitting] = useState(false);
	// The server is the judge of what counts as a valid mobile (PR #191 review —
	// the key must canonicalize to the international form the send gate checks,
	// in whichever supported country's shape the number fits).
	const invalid =
		status !== undefined && !status.optedOut && status.invalid === true;

	async function act() {
		if (!status) return;
		setSubmitting(true);
		try {
			if (status.optedOut) {
				await reactivate({ waPhone: phone });
				toast.success("Number re-activated — non-transactional sends resume.");
			} else {
				await registerOptOut({ waPhone: phone });
				toast.success("Number opted out across all stores.");
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div>
				<h3 className="font-semibold">Manual opt-out</h3>
				<p className="text-sm text-muted-foreground">
					For buyers who can't text STOP themselves — e.g. a counter buyer whose
					number the cashier typed. Suppresses marketing/broadcast sends from
					every store on the shared number; the confirmation for an order they
					placed still delivers. The buyer can reply START (or be re-activated
					here) to undo it.
				</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Input
					type="tel"
					inputMode="tel"
					value={phone}
					onChange={(e) => setPhone(e.target.value)}
					placeholder="Buyer's WhatsApp number, e.g. 012-345 6789"
					className="sm:max-w-xs"
				/>
				<Button
					variant={status?.optedOut ? "outline" : "destructive"}
					onClick={act}
					disabled={!valid || status === undefined || invalid || submitting}
				>
					{status?.optedOut ? (
						<>
							<Play className="size-4" /> Re-activate
						</>
					) : (
						<>
							<UserMinus className="size-4" /> Opt out this number
						</>
					)}
				</Button>
			</div>
			{valid && status ? (
				<p className="text-xs text-muted-foreground">
					{status.optedOut
						? `Currently opted out (${SOURCE_LABEL[status.source]}, since ${new Date(
								status.since,
							).toLocaleDateString("en-MY")}).`
						: invalid
							? "Enter a Malaysian (e.g. 012-345 6789) or Singapore (e.g. 9123 4567) mobile number."
							: "This number is not currently opted out."}
				</p>
			) : null}
			<OptOutRegister />
		</section>
	);
}

/** How each opt-out got there, in words. Exhaustive so a new `optOuts.source`
 * is a compile error rather than a raw enum leaking into the UI. */
const SOURCE_LABEL: Record<AdminOptOutRow["source"], string> = {
	stop_keyword: "replied STOP",
	berhenti_keyword: "replied BERHENTI",
	unsub_keyword: "replied UNSUB",
	zh_stop_keyword: "replied 停止",
	zh_unsub_keyword: "replied 退订",
	manual_admin: "added here by an admin",
	meta_complaint: "Meta complaint",
};

/**
 * The live do-not-message set. Without it the panel above can only answer "is
 * THIS number opted out?" — you must already know the number, so "who is
 * currently opted out?" (the question a PDPA request actually asks) has no
 * answer, and an admin can't even confirm their own opt-out registered.
 *
 * Numbers render MASKED to last-4, the same rule the status line and the audit
 * log follow: session replay captures rendered text, and this renders many at
 * once. Copy puts the full number on the clipboard without ever painting it.
 *
 * Re-activating removes the row from this list but never from the table — the
 * row keeps its `reactivatedAt` stamp as the consent ledger.
 */
function OptOutRegister() {
	const list = useQuery(
		convexQuery(api.wabaProtection.adminOptOutList, {}),
	).data;
	const reactivate = useMutation(api.wabaProtection.adminReactivateOptIn);
	const [busy, setBusy] = useState<Id<"optOuts"> | null>(null);

	async function copy(waPhone: string) {
		try {
			await navigator.clipboard.writeText(waPhone);
			toast.success("Number copied");
		} catch {
			toast.error("Couldn't copy — clipboard unavailable.");
		}
	}

	async function undo(row: AdminOptOutRow) {
		setBusy(row._id);
		try {
			await reactivate({ waPhone: row.waPhone });
			toast.success("Number re-activated — non-transactional sends resume.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(null);
		}
	}

	return (
		// MASK_PII: every row carries a buyer's number. Masked already, but the
		// attribute keeps the whole region out of replay if a field is ever added.
		<div
			{...MASK_PII}
			className="flex flex-col gap-2 border-border border-t pt-3"
		>
			<div className="flex items-baseline justify-between gap-2">
				<h4 className="font-medium text-sm">Currently opted out</h4>
				{list ? (
					<span className="text-muted-foreground text-xs">
						{list.rows.length}
						{list.capped ? "+" : ""}
					</span>
				) : null}
			</div>
			{list === undefined ? (
				<Skeleton className="h-12 w-full" />
			) : list.rows.length === 0 ? (
				// Rendered at zero on purpose: an empty register is the answer to
				// "is anyone opted out?", and the only place this feature announces
				// that it exists.
				<p className="text-muted-foreground text-xs">
					No numbers are opted out. A buyer replying STOP — or an opt-out added
					above — appears here until they reply START or are re-activated.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border">
					{list.rows.map((row) => (
						<li
							key={row._id}
							className="flex flex-wrap items-center justify-between gap-2 py-2"
						>
							<div className="min-w-0">
								<p className="font-mono text-sm">{row.masked}</p>
								<p className="text-muted-foreground text-xs">
									{SOURCE_LABEL[row.source]} ·{" "}
									{new Date(row.since).toLocaleDateString("en-MY")}
								</p>
							</div>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => copy(row.waPhone)}
									aria-label="Copy full number"
								>
									<Copy className="size-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => undo(row)}
									disabled={busy !== null}
								>
									<Play className="size-4" /> Re-activate
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
			{list?.capped ? (
				<p className="text-muted-foreground text-xs">
					Showing the {list.rows.length} most recent. Look up an older number
					with the field above.
				</p>
			) : null}
		</div>
	);
}

function HealthBanner() {
	const health = useQuery(
		convexQuery(api.wabaProtection.adminGetWabaHealth, {}),
	).data;
	if (health === undefined) {
		return <Skeleton className="h-16 w-full rounded-2xl" />;
	}
	if (health === null) {
		return (
			<div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-3 text-sm">
				<Siren className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<p className="text-muted-foreground">
					<span className="font-medium text-foreground">
						No Meta health updates yet.
					</span>{" "}
					Quality auto-throttle is dormant until the WABA admin subscribes the{" "}
					<code className="text-xs">phone_number_quality_update</code> +{" "}
					<code className="text-xs">account_update</code> webhook fields in the
					Meta App dashboard. The kill switch + caps + opt-out below work
					regardless.
				</p>
			</div>
		);
	}
	const tone =
		health.qualityRating === "HIGH"
			? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
			: health.qualityRating === "MEDIUM" || health.qualityRating === "UNKNOWN"
				? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
				: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";
	return (
		<div
			className={`flex items-start gap-3 rounded-2xl border p-3 text-sm ${tone}`}
		>
			<Siren className="mt-0.5 size-4 shrink-0" />
			<p>
				<span className="font-semibold">
					Shared number quality: {health.qualityRating}
				</span>{" "}
				· tier {health.messagingTier || "?"} · updated{" "}
				{new Date(health.observedAt).toLocaleString("en-MY")}
				{health.qualityRating === "LOW"
					? " — all non-transactional sends are auto-paused platform-wide until it recovers."
					: health.qualityRating === "MEDIUM"
						? " — marketing sends auto-paused platform-wide."
						: ""}
			</p>
		</div>
	);
}

function ConfirmDialog({
	vendor,
	onClose,
}: {
	vendor: VendorRow;
	onClose: () => void;
}) {
	const pause = useMutation(api.wabaProtection.adminPauseRetailer);
	const resume = useMutation(api.wabaProtection.adminResumeRetailer);
	const [reason, setReason] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const isPause = !vendor.paused;

	async function confirm() {
		setSubmitting(true);
		try {
			if (isPause) {
				await pause({ retailerId: vendor._id, reason: reason.trim() });
				toast.success(`Paused ${vendor.storeName}`);
			} else {
				await resume({ retailerId: vendor._id });
				toast.success(`Resumed ${vendor.storeName}`);
			}
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{isPause ? "Pause" : "Resume"} {vendor.storeName}?
					</DialogTitle>
					<DialogDescription>
						{isPause
							? "This pauses this vendor's marketing/broadcast WhatsApp sends. Their customers' order confirmations and status updates are NOT affected and keep working. Other vendors are unaffected."
							: "This re-enables this vendor's marketing/broadcast WhatsApp sends."}
					</DialogDescription>
				</DialogHeader>

				{isPause ? (
					<div className="flex flex-col gap-1.5">
						<label htmlFor="pause-reason" className="text-sm font-medium">
							Reason (required)
						</label>
						<Input
							id="pause-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. spam complaints, bulk unsolicited sends"
							autoFocus
						/>
						<p className="text-xs text-muted-foreground">
							Recorded against the vendor and shown in their dashboard banner.
						</p>
					</div>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={submitting}>
						Cancel
					</Button>
					<Button
						variant={isPause ? "destructive" : "default"}
						onClick={confirm}
						disabled={submitting || (isPause && reason.trim().length === 0)}
					>
						{isPause ? "Pause vendor" : "Resume vendor"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
