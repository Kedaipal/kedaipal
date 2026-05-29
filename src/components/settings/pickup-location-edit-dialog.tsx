import { useMutation } from "convex/react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import {
	emptyPickupLocationForm,
	type PickupLocationFormInput,
	pickupLocationFormSchema,
} from "../../lib/schemas";
import { useAppForm } from "../forms/form";
import { Button } from "../ui/button";

interface PickupLocationEditDialogProps {
	open: boolean;
	onClose: () => void;
	/**
	 * When set, the dialog edits this existing location. When undefined, the
	 * dialog creates a new one against `retailerId`.
	 */
	location: Doc<"pickupLocations"> | undefined;
	retailerId: Id<"retailers">;
}

function toFormValues(
	loc: Doc<"pickupLocations"> | undefined,
): PickupLocationFormInput {
	if (!loc) return emptyPickupLocationForm;
	return {
		label: loc.label,
		address: loc.address,
		mapsUrl: loc.mapsUrl ?? "",
		notes: loc.notes ?? "",
	};
}

export function PickupLocationEditDialog({
	open,
	onClose,
	location,
	retailerId,
}: PickupLocationEditDialogProps) {
	const createLocation = useMutation(api.pickupLocations.create);
	const updateLocation = useMutation(api.pickupLocations.update);
	const [serverError, setServerError] = useState<string | null>(null);

	const isEditing = location !== undefined;
	const title = isEditing ? "Edit pickup location" : "Add pickup location";
	const submitLabel = isEditing ? "Save changes" : "Add location";

	const form = useAppForm({
		defaultValues: toFormValues(location),
		validators: { onChange: pickupLocationFormSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			const label = value.label.trim();
			const address = value.address.trim();
			const mapsUrl = value.mapsUrl.trim();
			const notes = value.notes.trim();
			try {
				if (isEditing && location) {
					await updateLocation({
						pickupLocationId: location._id,
						label,
						address,
						mapsUrl,
						notes,
					});
				} else {
					await createLocation({
						retailerId,
						label,
						address,
						mapsUrl: mapsUrl.length > 0 ? mapsUrl : undefined,
						notes: notes.length > 0 ? notes : undefined,
					});
				}
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
							{title}
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
							<form.AppField name="label">
								{(field) => (
									<field.TextField
										label="Label"
										required
										placeholder="Main store, KL warehouse, Sunday market…"
										autoComplete="off"
									/>
								)}
							</form.AppField>
							<form.AppField name="address">
								{(field) => (
									<field.TextareaField
										label="Address"
										required
										placeholder="No 12, Jalan Tun Razak, 50400 Kuala Lumpur"
										rows={3}
									/>
								)}
							</form.AppField>
							<form.AppField name="mapsUrl">
								{(field) => (
									<field.TextField
										label="Waze or Google Maps link (optional)"
										placeholder="https://maps.app.goo.gl/…"
										type="url"
										inputMode="url"
										description="Paste a share link from Waze or Google Maps so buyers can navigate in one tap."
									/>
								)}
							</form.AppField>
							<form.AppField name="notes">
								{(field) => (
									<field.TextareaField
										label="Notes for buyers (optional)"
										placeholder="Pickup hours, parking instructions, etc."
										rows={3}
									/>
								)}
							</form.AppField>
							{serverError ? (
								<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
										{isSubmitting ? "Saving…" : submitLabel}
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
