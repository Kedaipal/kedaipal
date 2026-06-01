import { useMutation } from "convex/react";
import { MapPin, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import {
	GoogleAddressAutocomplete,
	type GoogleSelectedAddress,
} from "../forms/google-address-autocomplete";
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

/**
 * Coordinate state held by the dialog while the user picks (or skips) Google
 * autocomplete. The address text itself is the form's source of truth — these
 * three travel together when the user picks a Google suggestion, and stay
 * undefined if the user types freely.
 */
type GeoState = {
	latitude: number | undefined;
	longitude: number | undefined;
	placeId: string | undefined;
};

function initialGeo(loc: Doc<"pickupLocations"> | undefined): GeoState {
	return {
		latitude: loc?.latitude,
		longitude: loc?.longitude,
		placeId: loc?.placeId,
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
	const [geo, setGeo] = useState<GeoState>(() => initialGeo(location));

	const isEditing = location !== undefined;
	const title = isEditing ? "Edit pickup location" : "Add pickup location";
	const submitLabel = isEditing ? "Save changes" : "Add location";

	const form = useAppForm({
		defaultValues: {
			label: location?.label ?? "",
			address: location?.address ?? "",
			notes: location?.notes ?? "",
			managerName: location?.managerName ?? "",
			managerWaPhone: location?.managerWaPhone ?? "",
		},
		onSubmit: async ({ value }) => {
			setServerError(null);
			const label = value.label.trim();
			const address = value.address.trim();
			const notes = value.notes.trim();
			const managerName = value.managerName.trim();
			const managerWaPhone = value.managerWaPhone.trim();
			if (label.length === 0) {
				setServerError("Label is required.");
				return;
			}
			if (address.length < 3) {
				setServerError("Address is required.");
				return;
			}
			try {
				if (isEditing && location) {
					await updateLocation({
						pickupLocationId: location._id,
						label,
						address,
						notes,
						// Pass coordinates through whether they changed or not.
						// `undefined` means "no change" server-side — we never
						// want to clear them implicitly on a label/notes edit.
						latitude: geo.latitude,
						longitude: geo.longitude,
						placeId: geo.placeId,
						// Send manager fields unconditionally so empty input
						// becomes "clear". Server treats empty string as undefined.
						managerName,
						managerWaPhone,
					});
				} else {
					await createLocation({
						retailerId,
						label,
						address,
						notes: notes.length > 0 ? notes : undefined,
						latitude: geo.latitude,
						longitude: geo.longitude,
						placeId: geo.placeId,
						managerName: managerName.length > 0 ? managerName : undefined,
						managerWaPhone:
							managerWaPhone.length > 0 ? managerWaPhone : undefined,
					});
				}
				onClose();
			} catch (err) {
				setServerError(convexErrorMessage(err));
			}
		},
	});

	function handleAutocompleteSelect(payload: GoogleSelectedAddress) {
		// Mirror Google's formatted address into the form's address field so the
		// user sees the canonical version.
		form.setFieldValue("address", payload.formattedAddress);
		setGeo({
			latitude: payload.latitude,
			longitude: payload.longitude,
			placeId: payload.placeId,
		});
	}

	function handleManualAddressEdit(text: string) {
		form.setFieldValue("address", text);
		// If the user clears or edits away from the Google-picked address, drop
		// the stale coordinates — they no longer correspond to what's on file.
		if (geo.placeId !== undefined && text !== location?.address) {
			setGeo({ latitude: undefined, longitude: undefined, placeId: undefined });
		}
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	const hasCoords = geo.latitude !== undefined && geo.longitude !== undefined;

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

							<GoogleAddressAutocomplete
								initialValue={location?.address ?? ""}
								label="Address"
								required
								placeholder="Start typing an address in Malaysia…"
								description={
									hasCoords
										? "✓ Pinned via Google Maps — buyers will get a tappable location pin in WhatsApp."
										: "Pick a Google suggestion to enable the WhatsApp location pin. You can also type freely if your spot isn't on Google yet."
								}
								onSelect={handleAutocompleteSelect}
								onTextChange={handleManualAddressEdit}
							/>

							<form.AppField name="notes">
								{(field) => (
									<field.TextareaField
										label="Notes for buyers (optional)"
										placeholder="Pickup hours, parking instructions, etc."
										rows={3}
									/>
								)}
							</form.AppField>

							<div className="flex flex-col gap-3 rounded-xl border border-input bg-muted/30 p-4">
								<div className="flex flex-col gap-1">
									<h4 className="text-sm font-semibold text-foreground">
										Store manager
									</h4>
									<p className="text-xs text-muted-foreground leading-relaxed">
										Optional. When you set a WhatsApp number, every pickup
										order at this location gets a one-tap{" "}
										<span className="font-medium text-foreground">
											Notify {"<name>"}
										</span>{" "}
										button on the order page so you can forward order details
										on WhatsApp without copy-pasting. The name field is just
										used to label the button — leave it blank for a generic
										"Notify on WhatsApp" button.
									</p>
								</div>
								<form.AppField name="managerName">
									{(field) => (
										<field.TextField
											label="Manager name"
											placeholder="Aishah"
											autoComplete="off"
										/>
									)}
								</form.AppField>
								<form.AppField name="managerWaPhone">
									{(field) => (
										<field.PhoneField
											label="Manager WhatsApp number"
											description="Include country code, e.g. 60123456789."
										/>
									)}
								</form.AppField>
							</div>

							{serverError ? (
								<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{serverError}
								</p>
							) : null}

							{/* Surface the pinned coords when present so the seller knows what
							    they've committed to. Compact, debug-friendly. */}
							{hasCoords ? (
								<div className="flex items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
									<MapPin
										className="size-3.5 shrink-0 text-accent"
										aria-hidden="true"
									/>
									<span className="font-mono">
										{geo.latitude?.toFixed(5)}, {geo.longitude?.toFixed(5)}
									</span>
								</div>
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
