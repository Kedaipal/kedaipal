import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ImagePlus, ShieldX } from "lucide-react";
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
import { convexErrorMessage, formatPrice } from "../lib/format";

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

	return (
		<div className="flex flex-col gap-6 lg:max-w-3xl">
			<PageHeader
				title="Admin · Billing"
				subtitle="Settle invoices + payment details"
			/>
			<h2 className="text-xl font-bold lg:hidden">Admin · Billing</h2>
			<PendingInvoices />
			<PaymentConfigForm />
		</div>
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
					? `Marked paid — Founding Member #${res.rank} claimed 🎉`
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
		<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Pending invoices
			</p>
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
							className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">
									{inv.storeName}{" "}
									<span className="font-mono text-xs text-muted-foreground">
										/{inv.slug}
									</span>
								</p>
								<p className="text-xs text-muted-foreground">
									<span className="font-mono">{inv.invoiceNumber}</span> ·{" "}
									{inv.plan} · due{" "}
									{new Date(inv.dueDate).toLocaleDateString(undefined, {
										day: "numeric",
										month: "short",
									})}
								</p>
							</div>
							<div className="flex items-center gap-3">
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
		</section>
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
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div className="flex flex-col gap-1">
				<p className="text-sm font-semibold">Kedaipal payment details</p>
				<p className="text-xs text-muted-foreground">
					Shown to retailers on their billing page. The WhatsApp number reuses
					the storefront checkout number.
				</p>
			</div>

			{draft === null ? (
				<Skeleton className="h-40 w-full rounded-xl" />
			) : (
				<>
					<label className="flex flex-col gap-1 text-sm font-medium">
						Bank name
						<Input
							value={draft.bankName}
							onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
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

					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">DuitNow QR</span>
						{config?.qrUrl ? (
							<div className="flex items-start gap-3">
								<img
									src={config.qrUrl}
									alt="DuitNow QR"
									className="size-28 rounded-xl border border-border object-contain"
								/>
								<button
									type="button"
									onClick={handleQrRemove}
									className="text-xs text-destructive underline"
								>
									Remove QR
								</button>
							</div>
						) : (
							<label className="flex h-28 w-fit cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-background px-6 text-sm text-muted-foreground hover:border-ring">
								{uploading ? (
									"Uploading…"
								) : (
									<>
										<ImagePlus className="size-4" /> Upload QR
									</>
								)}
								<input
									type="file"
									accept="image/*"
									className="hidden"
									disabled={uploading}
									onChange={(e) => handleQrUpload(e.target.files?.[0] ?? null)}
								/>
							</label>
						)}
					</div>

					<Button
						type="button"
						onClick={handleSave}
						disabled={saving}
						className="h-11 lg:w-auto lg:self-start lg:px-6"
					>
						{saving ? "Saving…" : "Save details"}
					</Button>
				</>
			)}
		</section>
	);
}
