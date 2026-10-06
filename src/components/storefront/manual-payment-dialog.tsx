import { useMutation } from "convex/react";
import { Camera, Check, Download, RotateCcw, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { PaymentMethod } from "../../../convex/lib/payment";
import { qrFilenameBase, saveImageFromUrl } from "../../lib/download";
import { convexErrorMessage } from "../../lib/format";
import { IMAGE_ACCEPT, prepareImageUpload } from "../../lib/image-upload";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Input } from "../ui/input";
import { LinkifiedText } from "../ui/linkified-text";
import { ZoomableImage } from "../ui/zoomable-image";
import { manualPaymentCopy } from "./manual-payment-copy";

/**
 * The manual-payment sheet (86eyb6z3a UX revision): ONE door for "pay by
 * bank transfer / QR" — the store's payment methods (one-tap copy + QR save)
 * followed by the I've-paid claim form, replacing the always-visible "How to
 * pay" section the order page used to carry. Opened by the payment card's
 * primary button on manual-only stores, by the "Paid by bank transfer
 * instead?" fallback on gateway stores, and by "Update proof" on a claimed
 * order (same sheet — the methods stay visible in case the buyer still
 * needs them).
 *
 * **The screenshot is mandatory and leads the form (z8r3fdnpxf).** It used to be
 * an optional field below the reference number, so buyers skipped it and the
 * seller got a claimed payment with nothing to check against — then went back to
 * WhatsApp to ask for the receipt, which is the exact chase Kedaipal sells
 * against. Three things make that real rather than nominal:
 *
 * 1. **It uploads the moment it is picked**, not on submit. That is what lets
 *    the submit be held until the image is genuinely stored, and it gives the
 *    buyer a thumbnail to check they attached the right screenshot — on mobile
 *    data an upload is also the slow part, so doing it while they type the
 *    reference is faster than doing it after.
 * 2. **The submit says why it is disabled, before the tap.** A buyer who can't
 *    submit must never have to guess which field is the problem.
 * 3. **There is always a way out.** A mandatory field with no escape is a dead
 *    end, so a buyer who genuinely cannot produce an image is pointed at the
 *    store's own WhatsApp, where the seller can mark the payment received by
 *    hand. Same reason the rejection copy here says "take a screenshot instead"
 *    rather than naming a desktop conversion step — see `manual-payment-copy.ts`.
 *
 * The rule is on the ORDER, not on each submission (`hasExistingProof`): once a
 * screenshot is on file the seller can verify the payment, so the common
 * resubmit — "I forgot the reference number" — doesn't demand the same image
 * again. `claimPayment` enforces exactly that, so a direct call can't skip it.
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
	/** Does the order ALREADY carry a buyer-sent screenshot (payload's
	 * `hasPaymentProof`)? When it does, this submission doesn't have to bring
	 * one — the seller can already verify the payment. */
	hasExistingProof: boolean;
	/** The STORE's locale (`retailerLocale`), not a buyer choice. */
	locale: string;
	/** The vendor's own WhatsApp number, for the "can't attach one?" way out.
	 * Undefined => the line still shows, without a link to tap. */
	storeWaPhone?: string;
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB — receipts are screenshots, this is plenty

/**
 * The attachment's lifecycle. A union rather than a bag of booleans because the
 * states are genuinely exclusive and each carries different data — `failed`
 * keeps the `File` so Retry re-runs the same attempt, and `ready` keeps the
 * blob URL behind the thumbnail alongside the stored id.
 */
type ProofState =
	| { status: "empty" }
	| { status: "uploading"; name: string }
	| { status: "failed"; name: string; file: File; message: string }
	| { status: "ready"; name: string; storageId: string; previewUrl: string };

export function ManualPaymentDialog({
	open,
	onClose,
	token,
	shortId,
	storeName,
	methods,
	hasExistingClaim,
	hasExistingProof,
	locale,
	storeWaPhone,
}: ManualPaymentDialogProps) {
	const copy = manualPaymentCopy(locale);
	const claimPayment = useMutation(api.orders.claimPayment);
	const generateUploadUrl = useMutation(api.orders.generateOrderProofUploadUrl);

	const [reference, setReference] = useState("");
	const [proof, setProof] = useState<ProofState>({ status: "empty" });
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	// Index of the payment-QR currently being saved (spinner on that button only).
	const [savingQrIndex, setSavingQrIndex] = useState<number | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	// The live blob URL behind the thumbnail. Held in a ref as well as in state
	// so it can be revoked on replace and on unmount without either path having
	// to read the state it is about to overwrite.
	const previewUrlRef = useRef<string | null>(null);

	function revokePreview() {
		if (previewUrlRef.current) {
			URL.revokeObjectURL(previewUrlRef.current);
			previewUrlRef.current = null;
		}
	}

	// The sheet outlives a single claim (the track page keeps it mounted), so the
	// last preview would otherwise leak for the life of the page. Reads only the
	// ref, deliberately: closing over `revokePreview` would make this re-run its
	// cleanup on every render and revoke a URL the thumbnail is still showing.
	useEffect(
		() => () => {
			if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
		},
		[],
	);

	function reset() {
		setReference("");
		revokePreview();
		setProof({ status: "empty" });
		setServerError(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	async function handleSaveQr(label: string, url: string, index: number) {
		setSavingQrIndex(index);
		try {
			const outcome = await saveImageFromUrl(url, qrFilenameBase(label));
			if (outcome === "downloaded") {
				toast.success(copy.qrSaved);
			} else if (outcome === "failed") {
				toast.error(copy.qrSaveFailed);
			}
			// "shared" → the OS sheet took over; "cancelled" → intentional. Silent.
		} finally {
			setSavingQrIndex(null);
		}
	}

	/**
	 * Decode, shrink and store the picked screenshot, leaving `proof` in the
	 * state that describes the outcome. Every failure is recoverable in place:
	 * the file is kept so Retry is one tap, and Replace is always available.
	 */
	async function uploadProof(file: File) {
		setProof({ status: "uploading", name: file.name });
		setServerError(null);
		const fail = (message: string) =>
			setProof({ status: "failed", name: file.name, file, message });
		// A proof the seller can't open is worse here than anywhere else in the
		// app: they're being asked to confirm a payment against an image that
		// renders as a broken box, with nothing telling either side why. So the
		// proof is decoded (and shrunk) before it is stored — see
		// lib/image-upload.ts.
		const prepared = await prepareImageUpload(file);
		if (!prepared.ok) {
			fail(copy.rejectMessage(prepared.reason));
			return;
		}
		// Checked AFTER preparing, not before: the file is re-encoded on the way
		// through, so a big phone photo now shrinks under the cap instead of being
		// refused for a size it no longer has.
		if (prepared.blob.size > MAX_PROOF_BYTES) {
			fail(copy.rejectMessage("too_large"));
			return;
		}
		try {
			const uploadUrl = await generateUploadUrl({ token });
			const uploadRes = await fetch(uploadUrl, {
				method: "POST",
				headers: { "Content-Type": prepared.contentType },
				body: prepared.blob,
			});
			if (!uploadRes.ok) throw new Error(copy.uploadFailed);
			const uploaded = (await uploadRes.json()) as { storageId: string };
			revokePreview();
			const previewUrl = URL.createObjectURL(prepared.blob);
			previewUrlRef.current = previewUrl;
			setProof({
				status: "ready",
				name: file.name,
				storageId: uploaded.storageId,
				previewUrl,
			});
		} catch (err) {
			// `convexErrorMessage` carries the rate limiter's own "try again in N"
			// wording through, which is the honest thing to show for the one
			// failure a buyer can fix only by waiting.
			fail(err instanceof Error ? convexErrorMessage(err) : copy.uploadFailed);
		}
	}

	const trimmedRef = reference.trim();
	const uploading = proof.status === "uploading";
	const proofReady = proof.status === "ready";
	// First claim: nothing goes without a screenshot. Resubmit on an order the
	// seller can already verify: a reference on its own is a legitimate fix, but
	// an empty resubmit that changes nothing isn't worth a row of history.
	const needsProof = !hasExistingProof && !proofReady;
	const nothingToSend =
		hasExistingProof && !proofReady && trimmedRef.length === 0;
	const canSubmit = !submitting && !uploading && !needsProof && !nothingToSend;
	// Said BESIDE the disabled button rather than after a tap — and suppressed
	// while the attachment tile is already carrying the message (its spinner, or
	// its failure + Retry), so the buyer only ever reads one instruction.
	const blockedReason =
		uploading || proof.status === "failed"
			? null
			: needsProof
				? copy.needProof
				: nothingToSend
					? copy.needChange
					: null;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		// The button is disabled, but a text field can still submit a form
		// implicitly — so the guard also has to say what's missing rather than
		// swallowing the gesture.
		if (!canSubmit) {
			if (blockedReason) setServerError(blockedReason);
			return;
		}
		setSubmitting(true);
		setServerError(null);
		try {
			await claimPayment({
				token,
				reference: trimmedRef.length > 0 ? trimmedRef : undefined,
				proofStorageId: proof.status === "ready" ? proof.storageId : undefined,
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
							{hasExistingClaim ? copy.titleUpdate : copy.title(storeName)}
						</Dialog.Title>
						<Dialog.Close asChild>
							<button
								type="button"
								className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
								aria-label={copy.close}
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
										{copy.stepPay}
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
																{copy.bank}
															</span>
															<span className="font-medium">{m.bankName}</span>
														</div>
													) : null}
													{m.bankAccountName ? (
														<div className="flex items-baseline justify-between gap-3 text-sm">
															<span className="text-muted-foreground">
																{copy.accountName}
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
																	{copy.accountNumber}
																</p>
																<p className="break-all font-mono text-base font-semibold">
																	{m.bankAccountNumber}
																</p>
															</div>
															<CopyButton
																value={m.bankAccountNumber}
																ariaLabel={copy.copyAccountNumber}
																successMessage={copy.accountNumberCopied}
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
														{copy.tapToEnlarge}
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
														{copy.saveQr}
													</Button>
													<p className="max-w-64 text-center text-xs text-muted-foreground">
														{copy.qrHint}
													</p>
												</div>
											) : null}
											{m.note ? (
												<p className="whitespace-pre-line break-words text-sm text-muted-foreground">
													<LinkifiedText text={m.note} />
												</p>
											) : null}
										</div>
									))}
									<div className="border-t border-border" />
								</div>
							) : (
								<p className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
									{copy.noMethods(storeName)}
								</p>
							)}

							{/* 2 · Tell the store the money is on its way */}
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								{methods.length > 0 ? copy.stepTellNumbered : copy.stepTell}
							</p>
							<p className="text-sm text-muted-foreground">
								{copy.intro(shortId, storeName)}
							</p>

							{/* The screenshot LEADS the form — it is the one thing the seller
							    actually verifies against, and the field buyers skipped while
							    it sat below the reference number. */}
							<div className="flex flex-col gap-1.5">
								<label htmlFor="payment-proof" className="text-sm font-medium">
									{copy.proofLabel}{" "}
									{/* The marker retires the moment the requirement is MET —
									    a red "(required)" beside an attached screenshot reads
									    as an unmet error on a field that is already done. */}
									{needsProof ? (
										<span className="text-xs font-semibold text-destructive">
											{copy.required}
										</span>
									) : null}
								</label>

								{proof.status === "ready" ? (
									<div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-2">
										<img
											src={proof.previewUrl}
											alt={copy.proofPreviewAlt}
											className="size-16 shrink-0 rounded-lg border border-border object-cover"
										/>
										<div className="min-w-0 flex-1">
											<p className="flex items-center gap-1.5 text-sm font-medium text-accent-emphasis">
												<Check className="size-4 shrink-0" />
												{copy.proofAttached}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{proof.name}
											</p>
										</div>
										<label
											htmlFor="payment-proof"
											className="flex h-11 shrink-0 cursor-pointer items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
										>
											{copy.proofReplace}
										</label>
									</div>
								) : (
									<label
										htmlFor="payment-proof"
										aria-disabled={uploading}
										className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-sm transition-colors hover:bg-muted aria-disabled:cursor-wait aria-disabled:opacity-70"
									>
										{uploading ? (
											<span
												aria-hidden
												className="size-5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
											/>
										) : (
											<Camera className="size-5 shrink-0 text-muted-foreground" />
										)}
										<span className="truncate">
											{uploading
												? copy.proofUploading
												: proof.status === "failed"
													? proof.name
													: copy.proofAttach}
										</span>
									</label>
								)}

								<input
									id="payment-proof"
									ref={fileInputRef}
									type="file"
									accept={IMAGE_ACCEPT}
									disabled={uploading}
									onChange={(e) => {
										const file = e.target.files?.[0];
										// Cleared so picking the SAME file again still fires a
										// change event — otherwise "retry by re-selecting" is a
										// tap that silently does nothing.
										e.target.value = "";
										if (file) void uploadProof(file);
									}}
									className="hidden"
								/>

								{proof.status === "failed" ? (
									<div className="flex flex-col items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2">
										<p role="alert" className="text-sm text-destructive">
											{proof.message}
										</p>
										<button
											type="button"
											onClick={() => void uploadProof(proof.file)}
											className="flex h-11 items-center gap-1.5 text-sm font-semibold text-destructive underline-offset-2 hover:underline"
										>
											<RotateCcw className="size-4" />
											{copy.proofRetry}
										</button>
									</div>
								) : null}

								<p className="text-xs text-muted-foreground">
									{hasExistingProof ? copy.proofOnFile : copy.proofHint}
								</p>

								{/* The way out. A mandatory field with no alternative is a dead
								    end; the seller can always mark a payment received by hand. */}
								{needsProof ? (
									storeWaPhone ? (
										<a
											href={`https://wa.me/${storeWaPhone.replace(/\D/g, "")}?text=${encodeURIComponent(copy.waMessage(shortId))}`}
											target="_blank"
											rel="noopener noreferrer"
											className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
										>
											{copy.cantAttach(storeName)}
										</a>
									) : (
										<p className="text-xs text-muted-foreground">
											{copy.cantAttach(storeName)}
										</p>
									)
								) : null}
							</div>

							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="payment-reference"
									className="text-sm font-medium"
								>
									{copy.referenceLabel}{" "}
									<span className="text-xs text-muted-foreground">
										{copy.optional}
									</span>
								</label>
								<Input
									id="payment-reference"
									type="text"
									inputMode="text"
									autoComplete="off"
									value={reference}
									onChange={(e) => setReference(e.target.value)}
									placeholder={copy.referencePlaceholder}
									maxLength={80}
									variant="field"
									className="h-12 px-3"
								/>
								<p className="text-xs text-muted-foreground">
									{copy.referenceHint}
								</p>
							</div>

							{serverError ? (
								<p
									role="alert"
									className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
								>
									{serverError}
								</p>
							) : null}
						</div>

						<div className="flex flex-col gap-2 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<Button
								type="submit"
								isLoading={submitting}
								disabled={!canSubmit}
								className="h-12 w-full text-base"
							>
								{submitting
									? copy.submitting
									: hasExistingClaim
										? copy.submitUpdate
										: copy.submit}
							</Button>
							{blockedReason ? (
								<p className="text-center text-xs text-muted-foreground">
									{blockedReason}
								</p>
							) : null}
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
