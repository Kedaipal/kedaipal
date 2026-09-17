import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Award,
	ChevronRight,
	Gift,
	Loader2,
	ShieldCheck,
	ShieldX,
	Store,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";
import {
	COMP_KIND_LABEL,
	COMP_KINDS,
	COMP_LABEL_MAX,
	COMP_NOTE_MAX,
	type CompKind,
} from "../../convex/lib/comp";
import { PageHeader } from "../components/dashboard/page-header";
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
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Textarea } from "../components/ui/textarea";
import { useActAs } from "../hooks/useActAs";
import { convexErrorMessage, formatShortDate } from "../lib/format";

export const Route = createFileRoute("/app/admin/sellers")({
	component: AdminSellersRoute,
});

function AdminSellersRoute() {
	// Client gate is cosmetic — `listSellersForAdmin` is `requireAdmin` server-side.
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;

	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-3xl">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-24 w-full rounded-2xl" />
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

	return <AdminSellersContent />;
}

function AdminSellersContent() {
	const sellers = useQuery(convexQuery(api.admin.listSellersForAdmin, {})).data;
	// Dev deployments only (z8r3fdbmc9) — the server re-checks, this just keeps
	// a control that would always refuse off the prod screen entirely.
	const purgeEnabled =
		useQuery(convexQuery(api.admin.devStorePurgeEnabled, {})).data === true;
	const [term, setTerm] = useState("");

	const filtered =
		sellers?.filter((s) => {
			const q = term.trim().toLowerCase();
			if (!q) return true;
			return (
				s.storeName.toLowerCase().includes(q) ||
				s.slug.toLowerCase().includes(q)
			);
		}) ?? [];

	return (
		<div className="flex flex-col gap-6 lg:max-w-4xl">
			<PageHeader
				title="Admin · Sellers"
				subtitle="Open any seller's dashboard to set up or operate their store"
			/>
			<section className="flex flex-col gap-1 lg:hidden">
				<h2 className="text-xl font-bold">Admin · Sellers</h2>
				<p className="text-sm text-muted-foreground">
					Open any seller's dashboard to set up or operate their store.
				</p>
			</section>

			<div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
				<ShieldCheck className="mt-0.5 size-4 shrink-0" />
				<p>
					Opening a store enters <strong>act-as mode</strong>: you operate it as
					the seller and every change you make is logged to your admin account.
				</p>
			</div>

			<Input
				value={term}
				onChange={(e) => setTerm(e.target.value)}
				placeholder="Search by store name or slug"
				className="max-w-sm"
			/>

			{sellers === undefined ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-20 w-full rounded-2xl" />
					<Skeleton className="h-20 w-full rounded-2xl" />
					<Skeleton className="h-20 w-full rounded-2xl" />
				</div>
			) : filtered.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
					<Store className="size-7 text-muted-foreground" />
					<p className="font-medium">
						{sellers.length === 0 ? "No sellers yet" : "No matches"}
					</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						{sellers.length === 0
							? "Sellers appear here once they've completed onboarding."
							: "Try a different store name or slug."}
					</p>
				</div>
			) : (
				<ul className="flex flex-col gap-2">
					{filtered.map((s) => (
						<SellerCard key={s._id} seller={s} purgeEnabled={purgeEnabled} />
					))}
				</ul>
			)}
		</div>
	);
}

const STATUS_STYLES: Record<string, string> = {
	active: "bg-emerald-100 text-emerald-800",
	trialing: "bg-sky-100 text-sky-800",
	past_due: "bg-red-100 text-red-800",
	cancelled: "bg-muted text-muted-foreground",
};

export function SellerCard({
	seller,
	purgeEnabled,
}: {
	seller: AdminSellerRow;
	purgeEnabled: boolean;
}) {
	const status = seller.subscriptionStatus;
	const navigate = useNavigate();
	const { setActAs } = useActAs();
	const startActAsSession = useMutation(api.admin.startActAsSession);
	const purgeStore = useMutation(api.admin.purgeStoreForAdmin);
	const [purgeOpen, setPurgeOpen] = useState(false);
	const [compOpen, setCompOpen] = useState(false);
	// Server truth (`purging` rides the directory row, so every admin session
	// locks) OR the just-clicked local echo, which bridges the moment before
	// the reactive query refreshes.
	const [localPurging, setLocalPurging] = useState(false);
	const purging = seller.purging || localPurging;

	function manage() {
		if (purging) return;
		// Start the act-as session, then open the vendor's dashboard. From here the
		// session holds across all navigation + CRUD until the admin Exits.
		setActAs(seller._id);
		// Audit the tenant ENTRY (read-side attributability). Fire-and-forget — a
		// failed log must never block onboarding.
		void startActAsSession({ retailerId: seller._id }).catch(() => {});
		navigate({ to: "/app" });
	}

	async function confirmPurge() {
		try {
			const result = await purgeStore({
				retailerId: seller._id,
				confirmSlug: seller.slug,
			});
			setLocalPurging(true);
			// The cascade is async — the row vanishes from this list when the
			// retailer doc goes in its final phase, usually within seconds.
			toast.success(
				`Purging ${result.storeName} — the row disappears once the erase finishes, then that login onboards fresh.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Re-throw so the dialog stays open behind the error toast.
			throw err;
		}
	}

	return (
		// The purge control sits BESIDE the row, not inside it — the whole row is
		// already the "Manage" button, and a button can't nest a button.
		<li className="flex items-center gap-1.5">
			<button
				type="button"
				onClick={manage}
				disabled={purging}
				className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-sm disabled:pointer-events-none disabled:opacity-60"
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex items-center gap-2">
						<span className="truncate font-semibold">{seller.storeName}</span>
						{seller.foundingMemberRank !== undefined ? (
							<span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
								<Award className="size-3" />#{seller.foundingMemberRank}
							</span>
						) : null}
					</div>
					<span className="truncate font-mono text-xs text-muted-foreground">
						/{seller.slug}
						{seller.signupSource ? (
							// Acquisition tag the signup arrived with (z8r3fdd1v0) —
							// verbatim, these are Kedaipal's own `?src=` tags. Absent =
							// direct/untagged, so nothing renders for the common case.
							// A powered-by signup also names the store whose badge it
							// came through (z8r3fdcwd0) — the CAC ledger's "who brings
							// us sellers" column, in the same pill.
							<span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">
								via {seller.signupSource}
								{seller.signupReferrer
									? ` · /${seller.signupReferrer.slug}`
									: null}
							</span>
						) : null}
					</span>
					{/* flex-wrap so the comp chip gets a full line on 375px instead of
					    truncating its text away to a bare icon. */}
					<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
						{seller.ownerIsAdmin ? (
							// Admin-owned store: a single "Admin" pill, not a trial/plan
							// countdown — admins run the app for free with the highest tier
							// unlocked. Matches the dashboard tier-pill's `admin` tone.
							<span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
								<ShieldCheck className="size-3" />
								Admin
							</span>
						) : (
							<>
								{status ? (
									<span
										className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
											STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
										}`}
									>
										{status.replace("_", " ")}
									</span>
								) : (
									<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
										no subscription
									</span>
								)}
								{seller.plan && !seller.comped ? (
									<span className="text-[11px] capitalize text-muted-foreground">
										{seller.plan}
									</span>
								) : null}
								{seller.compEnded && status === "past_due" ? (
									// Why this store is past due: its comp upgrade was turned off,
									// not an unpaid bill — so nobody chases an invoice that doesn't
									// exist. Short enough for the ~135px text column at 375px; the
									// full date rides the title.
									<span
										className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
										title={`Comp upgrade turned off on ${formatShortDate(seller.compEnded.at)}`}
									>
										<Gift className="size-3 shrink-0" />
										Comp off ·{" "}
										{new Date(seller.compEnded.at).toLocaleDateString(undefined, {
											day: "numeric",
											month: "short",
										})}
									</span>
								) : null}
								{seller.comped ? (
									// Comp upgrade on (z8r3fdeub2): kind + label at a glance, so
									// "why is this store free?" never needs a click. The title
									// repeats the full text (plus since-when and the note) for the
									// narrow-screen case where the chip truncates.
									<span
										className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
										title={[
											compChipText(seller),
											seller.comp
												? `on since ${formatShortDate(seller.comp.grantedAt)}`
												: undefined,
											seller.comp?.note,
										]
											.filter(Boolean)
											.join(" — ")}
									>
										<Gift className="size-3 shrink-0" />
										<span className="truncate">{compChipText(seller)}</span>
									</span>
								) : null}
							</>
						)}
					</div>
				</div>
				{purging ? (
					<span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm font-semibold text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Purging…
					</span>
				) : (
					<span className="flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">
						Manage
						<ChevronRight className="size-4" />
					</span>
				)}
			</button>
			{/* Side controls stack vertically on phones — three columns of controls
			    (Manage + comp + purge) would squeeze the text to nothing at 375px. */}
			<div className="flex shrink-0 flex-col gap-1 self-center sm:flex-row sm:items-center sm:gap-1.5">
				{/* Comp upgrade toggle (z8r3fdeub2) — beside the row like the purge
				    control (the whole row is already the Manage button). One dialog turns
				    it on, edits its details, or turns it off. Admin stores keep the button
				    visible but disabled-with-reason. */}
				<button
					type="button"
					onClick={() => setCompOpen(true)}
					disabled={seller.ownerIsAdmin || purging}
					title={
						seller.ownerIsAdmin
							? "Admin store — always free already"
							: seller.comped
								? `Comp upgrade is on for ${seller.storeName} — edit or turn off`
								: `Turn on comp upgrade for ${seller.storeName}`
					}
					aria-label={
						seller.ownerIsAdmin
							? `${seller.storeName} is an admin store — always free`
							: seller.comped
								? `Comp upgrade is on for ${seller.storeName} — edit or turn off`
								: `Turn on comp upgrade for ${seller.storeName}`
					}
					className={`flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
						seller.comped
							? "text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-950"
							: "text-muted-foreground/60 hover:bg-muted hover:text-foreground"
					}`}
				>
					<Gift className="size-4" />
				</button>
				{purgeEnabled ? (
					// Quiet until hovered — a rare dev tool shouldn't shout red down
					// the whole directory. Compact square, centered on the row.
					<button
						type="button"
						onClick={() => setPurgeOpen(true)}
						disabled={purging}
						title="Purge store (dev only)"
						aria-label={`Purge ${seller.storeName} (dev only)`}
						className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
					>
						{purging ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Trash2 className="size-4" />
						)}
					</button>
				) : null}
			</div>
			{compOpen ? (
				<CompDialog seller={seller} onClose={() => setCompOpen(false)} />
			) : null}
			{purgeEnabled ? (
				<ConfirmDialog
					open={purgeOpen}
					onOpenChange={setPurgeOpen}
					destructive
					title={`Purge ${seller.storeName}?`}
					description={
						<>
							Dev-only test reset. Erases <strong>everything</strong> this
							store owns — products, orders, customers, settings, images — and
							the store itself, exactly like the account-deletion cascade. The
							owner's login survives, so opening /onboarding afterwards starts
							a fresh store. This cannot be undone.
						</>
					}
					confirmPhrase={seller.slug}
					confirmLabel="Purge store"
					onConfirm={confirmPurge}
				/>
			) : null}
		</li>
	);
}

/** The comp chip's one-liner: kind · label — everything an admin needs
 * without opening the dialog. */
function compChipText(seller: AdminSellerRow): string {
	const parts = [seller.comp ? COMP_KIND_LABEL[seller.comp.kind] : "Comped"];
	if (seller.comp?.label) parts.push(seller.comp.label);
	return parts.join(" · ");
}

/**
 * The comp upgrade toggle (z8r3fdeub2). A comp has no end date: an admin turns
 * it on and it stays on until an admin turns it off. Mounted only while open,
 * so the fields initialise from the row's current comp on every open — the same
 * dialog turns it ON, edits its details (kind / seller-facing label / internal
 * note) with no gap in access, and turns it OFF behind its own confirm that says
 * exactly what happens next: the store becomes an expired seller. Exported for
 * the dialog-states test.
 */
export function CompDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setComp = useMutation(api.subscriptions.setComp);
	const revokeComp = useMutation(api.subscriptions.revokeComp);
	const on = seller.comped;
	const [kind, setKind] = useState<CompKind>(seller.comp?.kind ?? "sponsor");
	const [label, setLabel] = useState(seller.comp?.label ?? "");
	const [note, setNote] = useState(seller.comp?.note ?? "");
	const [saving, setSaving] = useState(false);
	const [offOpen, setOffOpen] = useState(false);

	async function save() {
		setSaving(true);
		try {
			await setComp({
				retailerId: seller._id,
				kind,
				label: label.trim() || undefined,
				note: note.trim() || undefined,
			});
			toast.success(
				on
					? `Comp details updated for ${seller.storeName}.`
					: `Comp upgrade on — ${seller.storeName} has every feature with no limits, never billed.`,
			);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function turnOff() {
		try {
			await revokeComp({ retailerId: seller._id });
			toast.success(
				`Comp upgrade off — ${seller.storeName} is now an expired store.`,
				{
					description:
						"Storefront stays live; editing is locked until they choose a plan. They've been emailed.",
				},
			);
			setOffOpen(false);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Re-throw so the confirm dialog stays open behind the error toast.
			throw err;
		}
	}

	return (
		<>
			<Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Comp upgrade — {seller.storeName}</DialogTitle>
						<DialogDescription>
							Gives this store what an admin store gets — every feature, no
							limits, never billed — without admin access. There's no end date:
							it stays on until you turn it off.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						{/* The toggle's current position, stated up front. */}
						<div
							className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
								on
									? "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40"
									: "border-input bg-background"
							}`}
						>
							<div className="flex min-w-0 items-center gap-2">
								<Gift
									className={`size-4 shrink-0 ${on ? "text-violet-600 dark:text-violet-300" : "text-muted-foreground"}`}
								/>
								<p className="text-sm font-medium">Comp upgrade</p>
							</div>
							<span
								className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
									on
										? "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300"
										: "bg-muted text-muted-foreground"
								}`}
							>
								{on
									? seller.comp
										? `On · since ${formatShortDate(seller.comp.grantedAt)}`
										: "On"
									: "Off"}
							</span>
						</div>
						{!on ? (
							<p className="text-xs text-muted-foreground">
								Turning it on voids any pending invoice (a past-due lock lifts)
								and reopens a paused store for orders. The seller can't
								subscribe, change plan or pause while it's on.
							</p>
						) : null}
						<div className="flex flex-col gap-1.5">
							<span className="text-sm font-medium">Why is it free?</span>
							<div className="grid grid-cols-2 gap-2">
								{COMP_KINDS.map((k) => (
									<button
										key={k}
										type="button"
										onClick={() => setKind(k)}
										aria-pressed={kind === k}
										className={`h-11 rounded-xl border text-sm font-medium transition-colors ${
											kind === k
												? "border-accent bg-accent/10 text-accent"
												: "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
										}`}
									>
										{COMP_KIND_LABEL[k]}
									</button>
								))}
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="comp-label" className="text-sm font-medium">
								Label{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="comp-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								maxLength={COMP_LABEL_MAX}
								placeholder={'e.g. "Sponsored by Maybank SME"'}
							/>
							<p className="text-xs text-muted-foreground">
								The seller sees this on their billing tab, word for word.
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="comp-note" className="text-sm font-medium">
								Note{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Textarea
								id="comp-note"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								maxLength={COMP_NOTE_MAX}
								rows={2}
								placeholder="Deal terms, contact person…"
							/>
							<p className="text-xs text-muted-foreground">
								Internal — only admins see this.
							</p>
						</div>
					</div>
					<DialogFooter>
						{on ? (
							<Button
								variant="destructive"
								onClick={() => setOffOpen(true)}
								disabled={saving}
								className="sm:mr-auto"
							>
								Turn off…
							</Button>
						) : null}
						<Button variant="outline" onClick={onClose} disabled={saving}>
							Cancel
						</Button>
						<Button onClick={save} disabled={saving}>
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							{on ? "Save changes" : "Turn on comp upgrade"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={offOpen}
				onOpenChange={setOffOpen}
				destructive
				title={`Turn off ${seller.storeName}'s comp upgrade?`}
				description={
					<>
						The store becomes an <strong>expired seller</strong> straight away:
						the storefront stays live and buyers can still order, but the seller
						can't edit products, settings or bookings until they choose a plan
						and pay. No free period, and they're emailed that their sponsored
						access has ended. You can turn it back on any time.
					</>
				}
				confirmLabel="Turn off comp upgrade"
				onConfirm={turnOff}
			/>
		</>
	);
}
