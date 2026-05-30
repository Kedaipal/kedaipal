import { useMutation } from "convex/react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import {
	addressEditFormSchema,
	type CheckoutAddressValues,
	emptyAddress,
} from "../../lib/schemas";
import { useAppForm } from "../forms/form";
import { Button } from "../ui/button";
import { AddressFieldset } from "./address-fieldset";

interface AddressEditDialogProps {
	open: boolean;
	onClose: () => void;
	shortId: string;
	currentAddress: Doc<"orders">["deliveryAddress"];
	/**
	 * Used by the Google autocomplete inside the field group to scope rate
	 * limiting (the dialog is unauthenticated — same trust model as the
	 * tracking page itself).
	 */
	retailerId: Id<"retailers"> | undefined;
}

function toFormValues(
	addr: Doc<"orders">["deliveryAddress"],
): CheckoutAddressValues {
	if (!addr) return emptyAddress;
	return {
		line1: addr.line1,
		line2: addr.line2 ?? "",
		city: addr.city,
		state: addr.state,
		postcode: addr.postcode,
		notes: addr.notes ?? "",
		mapsUrl: addr.mapsUrl ?? "",
		latitude: addr.latitude !== undefined ? String(addr.latitude) : "",
		longitude: addr.longitude !== undefined ? String(addr.longitude) : "",
	};
}

export function AddressEditDialog({
	open,
	onClose,
	shortId,
	currentAddress,
	retailerId,
}: AddressEditDialogProps) {
	const updateAddress = useMutation(api.orders.updateDeliveryAddress);
	const [serverError, setServerError] = useState<string | null>(null);

	const form = useAppForm({
		defaultValues: toFormValues(currentAddress),
		validators: { onChange: addressEditFormSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			const line2 = value.line2.trim();
			const notes = value.notes.trim();
			const mapsUrl = value.mapsUrl.trim();
			const latNum = value.latitude.trim().length > 0 ? Number(value.latitude) : NaN;
			const lngNum =
				value.longitude.trim().length > 0 ? Number(value.longitude) : NaN;
			const validCoords =
				Number.isFinite(latNum) &&
				Number.isFinite(lngNum) &&
				latNum >= -90 &&
				latNum <= 90 &&
				lngNum >= -180 &&
				lngNum <= 180;
			try {
				await updateAddress({
					shortId,
					deliveryAddress: {
						line1: value.line1.trim(),
						line2: line2.length > 0 ? line2 : undefined,
						city: value.city.trim(),
						state: value.state,
						postcode: value.postcode.trim(),
						notes: notes.length > 0 ? notes : undefined,
						mapsUrl: mapsUrl.length > 0 ? mapsUrl : undefined,
						latitude: validCoords ? latNum : undefined,
						longitude: validCoords ? lngNum : undefined,
					},
				});
				onClose();
			} catch (err) {
				setServerError(convexErrorMessage(err));
			}
		},
	});

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							Edit delivery address
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
						<div className="flex-1 overflow-y-auto px-5 py-4">
							<AddressFieldset
								form={form}
								fields={{
									line1: "line1",
									line2: "line2",
									city: "city",
									state: "state",
									postcode: "postcode",
									notes: "notes",
									mapsUrl: "mapsUrl",
									latitude: "latitude",
									longitude: "longitude",
								}}
								retailerId={retailerId}
							/>
							{serverError ? (
								<p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{serverError}
								</p>
							) : null}
						</div>

						<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<form.Subscribe
								selector={(s) => ({
									canSubmit: s.canSubmit,
									isSubmitting: s.isSubmitting,
								})}
							>
								{({ canSubmit, isSubmitting }) => (
									<Button
										type="submit"
										disabled={!canSubmit || isSubmitting}
										className="h-12 w-full text-base"
									>
										{isSubmitting ? "Saving…" : "Save address"}
									</Button>
								)}
							</form.Subscribe>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
