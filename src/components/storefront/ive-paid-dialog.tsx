import { useMutation } from "convex/react";
import { Camera, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface IvePaidDialogProps {
	open: boolean;
	onClose: () => void;
	shortId: string;
	hasExistingClaim: boolean;
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB — receipts are screenshots, this is plenty

export function IvePaidDialog({
	open,
	onClose,
	shortId,
	hasExistingClaim,
}: IvePaidDialogProps) {
	const claimPayment = useMutation(api.orders.claimPayment);
	const generateUploadUrl = useMutation(api.orders.generateOrderProofUploadUrl);

	const [reference, setReference] = useState("");
	const [proofFile, setProofFile] = useState<File | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	function reset() {
		setReference("");
		setProofFile(null);
		setServerError(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setServerError(null);
		try {
			let proofStorageId: string | undefined;
			if (proofFile) {
				if (proofFile.size > MAX_PROOF_BYTES) {
					setServerError("Screenshot must be smaller than 5 MB.");
					setSubmitting(false);
					return;
				}
				const uploadUrl = await generateUploadUrl({ shortId });
				const uploadRes = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": proofFile.type },
					body: proofFile,
				});
				if (!uploadRes.ok) {
					throw new Error("Couldn't upload screenshot. Please try again.");
				}
				const uploaded = (await uploadRes.json()) as { storageId: string };
				proofStorageId = uploaded.storageId;
			}
			const trimmedRef = reference.trim();
			await claimPayment({
				shortId,
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
							{hasExistingClaim ? "Update payment proof" : "I've paid"}
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
							<p className="text-sm text-muted-foreground">
								Paid {shortId}? Send the details below so the store can verify
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
									accept="image/*"
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
										: "Submit"}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
