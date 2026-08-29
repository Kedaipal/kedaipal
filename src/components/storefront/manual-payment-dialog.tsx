import { useMutation } from "convex/react";
import { Camera, Download, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { PaymentMethod } from "../../../convex/lib/payment";
import { qrFilenameBase, saveImageFromUrl } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { IMAGE_ACCEPT, prepareImageUpload } from "../../lib/image-upload";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Input } from "../ui/input";
import { ZoomableImage } from "../ui/zoomable-image";

/**
 * The manual-payment sheet (86eyb6z3a UX revision): ONE door for "pay by
 * bank transfer / QR" — the store's payment methods (one-tap copy + QR save)
 * followed by the I've-paid claim form, replacing the always-visible "How to
 * pay" section the order page used to carry. Opened by the payment card's
 * primary button on manual-only stores, by the "Paid by bank transfer
 * instead?" fallback on gateway stores, and by "Update proof" on a claimed
 * order (same sheet — the methods stay visible in case the buyer still
 * needs them).
 */

type ResolvedMethod = PaymentMethod & { qrImageUrl?: string };

interface ManualPaymentDialogProps {
	open: boolean;
	onClose: () => void;
	// Capability for the public payment mutations (unguessable). NOT the shortId.
	token: string;
	// Human-readable order ref, display only (e.g. "Paid ORD-A7K9?").
	shortId: string;
	storeName: string;
	methods: ResolvedMethod[];
	hasExistingClaim: boolean;
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB — receipts are screenshots, this is plenty

export function ManualPaymentDialog({
	open,
	onClose,
	token,
	shortId,
	storeName,
	methods,
	hasExistingClaim,
}: ManualPaymentDialogProps) {
	const claimPayment = useMutation(api.orders.claimPayment);
	const generateUploadUrl = useMutation(api.orders.generateOrderProofUploadUrl);

	const [reference, setReference] = useState("");
	const [proofFile, setProofFile] = useState<File | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	// Index of the payment-QR currently being saved (spinner on that button only).
	const [savingQrIndex, setSavingQrIndex] = useState<number | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	function reset() {
		setReference("");
		setProofFile(null);
		setServerError(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	async function handleSaveQr(label: string, url: string, index: number) {
		setSavingQrIndex(index);
		try {
			const outcome = await saveImageFromUrl(url, qrFilenameBase(label));
			if (outcome === "downloaded") {
				toast.success("QR saved — open it from your downloads to scan.");
			} else if (outcome === "failed") {
				toast.error("Couldn't save the QR — please try again.");
			}
			// "shared" → the OS sheet took over; "cancelled" → intentional. Silent.
		} finally {
			setSavingQrIndex(null);
		}
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setServerError(null);
		try {
			let proofStorageId: string | undefined;
			if (proofFile) {
				// A proof the seller can't open is worse here than anywhere else
				// in the app: they're being asked to confirm a payment against an
				// image that renders as a broken box, with nothing telling either
				// side why. So the proof is decoded (and shrunk) before it is
				// stored — see lib/image-upload.ts.
				const prepared = await prepareImageUpload(proofFile);
				if (!prepared.ok) {
					setServerError(prepared.message);
					setSubmitting(false);
					return;
				}
				// Checked AFTER preparing, not before: the file is re-encoded on
				// the way through, so a big phone photo now shrinks under the cap
				// instead of being refused for a size it no longer has.
				if (prepared.blob.size > MAX_PROOF_BYTES) {
					setServerError("Screenshot must be smaller than 5 MB.");
					setSubmitting(false);
					return;
				}
				const uploadUrl = await generateUploadUrl({ token });
				const uploadRes = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": prepared.contentType },
					body: prepared.blob,
				});
				if (!uploadRes.ok) {
					throw new Error("Couldn't upload screenshot. Please try again.");
				}
				const uploaded = (await uploadRes.json()) as { storageId: string };
				proofStorageId = uploaded.storageId;
			}
			const trimmedRef = reference.trim();
			await claimPayment({
				token,
				reference: trimmedRef.length > 0 ? trimmedRef : undefined,
				proofStorageId,
			});
			reset();
			onClose();
		} catch (err) {
			setServerError(convexErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					reset();
					onClose();
				}
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							{hasExistingClaim ? "Update payment proof" : `Pay ${storeName}`}
						</Dialog.Title>
						<Dialog.Close asChild>
							<button
								type="button"
								className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
								aria-label="Close"
							>
								<X className="size-5" />
							</button>
						</Dialog.Close>
					</div>

					<form
						onSubmit={handleSubmit}
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
							{/* 1 · The store's payment methods (one-tap copy / QR save) */}
							{methods.length > 0 ? (
								<div className="flex flex-col gap-4">
									<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
										1 · Pay with any of these
									</p>
									{methods.map((m, i) => (
										<div
											// biome-ignore lint/suspicious/noArrayIndexKey: payment methods are a render-stable embedded array with no stable id; label+index is fine and stable within a render
											key={`${m.label}-${i}`}
											className="flex flex-col gap-2 border-border [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:pt-4"
										>
											<p className="text-sm font-semibold">{m.label}</p>
											{m.type === "bank" ? (
												<>
													{m.bankName && m.bankName !== m.label ? (
														<div className="flex items-baseline justify-between gap-3 text-sm">
															<span className="text-muted-foreground">
																Bank
															</span>
															<span className="font-medium">{m.bankName}</span>
														</div>
													) : null}
													{m.bankAccountName ? (
														<div className="flex items-baseline justify-between gap-3 text-sm">
															<span className="text-muted-foreground">
																Name
															</span>
															<span className="text-right font-medium">
																{m.bankAccountName}
															</span>
														</div>
													) : null}
													{m.bankAccountNumber ? (
														<div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
															<div className="min-w-0">
																<p className="text-xs text-muted-foreground">
																	Account number
																</p>
																<p className="break-all font-mono text-base font-semibold">
																	{m.bankAccountNumber}
																</p>
															</div>
															<CopyButton
																value={m.bankAccountNumber}
																ariaLabel="Copy account number"
																successMessage="Account number copied"
															/>
														</div>
													) : null}
												</>
											) : m.qrImageUrl ? (
												<div className="flex flex-col items-center gap-1.5">
													<ZoomableImage
														src={m.qrImageUrl}
														alt={`${m.label} QR code`}
														caption={m.label}
														className="max-h-56 w-auto rounded-lg border border-border bg-white"
													/>
													<p className="text-xs text-muted-foreground">
														Tap to enlarge &amp; scan
													</p>
													<Button
														type="button"
														variant="outline"
														onClick={() =>
															m.qrImageUrl
																? handleSaveQr(m.label, m.qrImageUrl, i)
																: undefined
														}
														isLoading={savingQrIndex === i}
														disabled={savingQrIndex !== null}
														className="mt-0.5 h-11 rounded-full px-5"
													>
														{savingQrIndex !== i && (
															<Download className="size-4" />
														)}
														Save QR
													</Button>
													<p className="max-w-64 text-center text-xs text-muted-foreground">
														Paying on this phone? Save the QR to your gallery,
														then scan it from inside TNG eWallet or your banking
														app.
													</p>
												</div>
											) : null}
											{m.note ? (
												<p className="whitespace-pre-line break-words text-sm text-muted-foreground">
													{m.note}
												</p>
											) : null}
										</div>
									))}
									<div className="border-t border-border" />
								</div>
							) : (
								<p className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
									{storeName} hasn't added payment details here — check your
									WhatsApp chat with them for how to pay, then confirm below.
								</p>
							)}

							{/* 2 · Tell the store the money is on its way */}
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								{methods.length > 0
									? "2 · Then tell the store"
									: "Tell the store"}
							</p>
							<p className="text-sm text-muted-foreground">
								Paid {shortId}? Send the details below so {storeName} can verify
								your payment.
							</p>

							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="payment-reference"
									className="text-sm font-medium"
								>
									Reference number{" "}
									<span className="text-xs text-muted-foreground">
										(optional)
									</span>
								</label>
								<Input
									id="payment-reference"
									type="text"
									inputMode="text"
									autoComplete="off"
									value={reference}
									onChange={(e) => setReference(e.target.value)}
									placeholder="e.g. TXN20260429-9988"
									maxLength={80}
									variant="field"
									className="h-12 px-3"
								/>
								<p className="text-xs text-muted-foreground">
									From your bank app — helps the store match your transfer.
								</p>
							</div>

							<div className="flex flex-col gap-1.5">
								<label htmlFor="payment-proof" className="text-sm font-medium">
									Receipt screenshot{" "}
									<span className="text-xs text-muted-foreground">
										(optional)
									</span>
								</label>
								<label
									htmlFor="payment-proof"
									className="flex min-h-[3rem] cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-muted"
								>
									<Camera className="size-5 text-muted-foreground" />
									<span className="truncate">
										{proofFile ? proofFile.name : "Tap to attach a screenshot"}
									</span>
								</label>
								<input
									id="payment-proof"
									ref={fileInputRef}
									type="file"
									accept={IMAGE_ACCEPT}
									onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
									className="hidden"
								/>
								<p className="text-xs text-muted-foreground">
									PNG or JPG, up to 5 MB.
								</p>
							</div>

							{serverError ? (
								<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{serverError}
								</p>
							) : null}
						</div>

						<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<Button
								type="submit"
								isLoading={submitting}
								disabled={submitting}
								className="h-12 w-full text-base"
							>
								{submitting
									? "Submitting…"
									: hasExistingClaim
										? "Update"
										: "I've paid"}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
