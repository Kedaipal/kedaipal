import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	AlertOctagon,
	Ban,
	CircleCheck,
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
import { convexErrorMessage } from "../lib/format";

export const Route = createFileRoute("/app/admin/waba")({
	component: AdminWabaRoute,
});

function AdminWabaRoute() {
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
	const vendors = useQuery(api.wabaProtection.adminListVendors, { search });
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
										value={String(v.optOuts30d)}
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

			{target ? (
				<ConfirmDialog vendor={target} onClose={() => setTarget(null)} />
			) : null}
		</div>
	);
}

function HealthBanner() {
	const health = useQuery(api.wabaProtection.adminGetWabaHealth, {});
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
