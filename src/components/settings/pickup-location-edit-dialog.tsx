import { useMutation } from "convex/react";
import { MapPin, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	convexErrorMessage,
	normalizePriceInput,
	parsePriceInput,
} from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { submitThenFocusError } from "../forms/focus-error";
import { useAppForm } from "../forms/form";
import {
	GoogleAddressAutocomplete,
	type GoogleSelectedAddress,
} from "../forms/google-address-autocomplete";
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
	/** Whether the plan allows charging a pickup fee (Pro+). When false the fee
	 * input renders disabled-with-reason; the server gate is the real lock. */
	canChargeFee: boolean;
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

/** Segmented kind selector button at the top of the dialog. */
function KindButton({
	active,
	onClick,
	title,
	subtitle,
}: {
	active: boolean;
	onClick: () => void;
	title: string;
	subtitle: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${
				active
					? "border-accent bg-accent/5"
					: "border-border bg-card hover:border-accent/40"
			}`}
		>
			<span
				className={`text-sm font-semibold ${active ? "text-accent" : "text-foreground"}`}
			>
				{title}
			</span>
			<span className="text-xs text-muted-foreground">{subtitle}</span>
		</button>
	);
}

export function PickupLocationEditDialog({
	open,
	onClose,
	location,
	retailerId,
	canChargeFee,
}: PickupLocationEditDialogProps) {
	const createLocation = useMutation(api.pickupLocations.create);
	const updateLocation = useMutation(api.pickupLocations.update);
	const [serverError, setServerError] = useState<string | null>(null);
	// Submit-time errors for the two inputs that aren't shared form fields — the
	// Google-autocomplete address and the local fee input. Inline on the input
	// (marked aria-invalid so the focus helper lands there), never a banner.
	const [addressError, setAddressError] = useState<string | null>(null);
	const [feeError, setFeeError] = useState<string | null>(null);
	const [geo, setGeo] = useState<GeoState>(() => initialGeo(location));
	// Pickup kind lives in local state (segmented control), not the form — it's
	// a discrete choice, not a text field. Legacy rows default to self-collect.
	const [kind, setKind] = useState<"self_collect" | "drop_off">(
		location?.locationType ?? "self_collect",
	);
	// Fee as a display string (RM) — same local-state pattern as `kind`. Stored
	// in minor units server-side; converted at submit.
	const [feeInput, setFeeInput] = useState<string>(
		location?.fee && location.fee > 0 ? (location.fee / 100).toFixed(2) : "",
	);
	// A downgraded (locked) seller can't set/change a fee, but MUST be able to
	// clear an existing one — the server keeps clearing un-gated precisely so a
	// downgrade never traps a seller charging buyers a fee they can't turn off.
	// This stages that clear (applied on Save, reversible via "Keep fee").
	const [feePendingRemoval, setFeePendingRemoval] = useState(false);

	const isEditing = location !== undefined;
	const title = isEditing ? "Edit pickup point" : "Add pickup point";
	const submitLabel = isEditing ? "Save changes" : "Add point";
	// Locked plan sitting on an existing charge — the only fee action allowed is
	// removal, surfaced as a dedicated "Remove fee" control below.
	const lockedWithExistingFee =
		!canChargeFee && Boolean(location?.fee && location.fee > 0);

	const form = useAppForm({
		defaultValues: {
			label: location?.label ?? "",
			address: location?.address ?? "",
			scheduleNote: location?.scheduleNote ?? "",
			notes: location?.notes ?? "",
			managerName: location?.managerName ?? "",
			managerWaPhone: location?.managerWaPhone ?? "",
		},
		// Label errors render on the field itself (aria-invalid + message beneath);
		// the address + fee inputs aren't shared fields, so they carry their own
		// inline error state below. Other fields are optional — plain strings.
		validators: {
			onChange: z.object({
				label: z.string().trim().min(1, "Give this pickup point a name."),
				address: z.string(),
				scheduleNote: z.string(),
				notes: z.string(),
				managerName: z.string(),
				managerWaPhone: z.string(),
			}),
		},
		onSubmit: async ({ value }) => {
			setServerError(null);
			setAddressError(null);
			setFeeError(null);
			const label = value.label.trim();
			const address = value.address.trim();
			const scheduleNote = value.scheduleNote.trim();
			const notes = value.notes.trim();
			const managerName = value.managerName.trim();
			const managerWaPhone = value.managerWaPhone.trim();
			if (address.length < 3) {
				setAddressError("Enter the address (at least 3 characters).");
				return;
			}
			// Fee: display RM string → integer sen. Blank = free. Parse errors
			// surface inline (server re-validates the amount + the Pro gate).
			let feeSen: number | undefined;
			if (canChargeFee && feeInput.trim().length > 0) {
				const rm = parsePriceInput(feeInput);
				if (rm === null) {
					setFeeError("Not a valid amount — numbers only, e.g. 5.00");
					return;
				}
				feeSen = Math.round(rm * 100);
			}
			try {
				if (isEditing && location) {
					await updateLocation({
						pickupLocationId: location._id,
						label,
						address,
						locationType: kind,
						// Empty string clears the note server-side; a value re-sets it.
						scheduleNote,
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
						// On Pro: blank/0 clears back to free (null), a value re-sets it.
						// On a locked plan we send nothing by default — an existing fee
						// is never silently rewritten by an unrelated edit — UNLESS the
						// seller explicitly staged a removal, which is always allowed
						// (the server keeps clearing un-gated so a downgrade can't trap).
						fee: canChargeFee
							? feeSen && feeSen > 0
								? feeSen
								: null
							: feePendingRemoval
								? null
								: undefined,
					});
				} else {
					await createLocation({
						retailerId,
						label,
						address,
						locationType: kind,
						scheduleNote: scheduleNote.length > 0 ? scheduleNote : undefined,
						notes: notes.length > 0 ? notes : undefined,
						latitude: geo.latitude,
						longitude: geo.longitude,
						placeId: geo.placeId,
						managerName: managerName.length > 0 ? managerName : undefined,
						managerWaPhone:
							managerWaPhone.length > 0 ? managerWaPhone : undefined,
						fee: feeSen,
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
		setAddressError(null);
		setGeo({
			latitude: payload.latitude,
			longitude: payload.longitude,
			placeId: payload.placeId,
		});
	}

	function handleManualAddressEdit(text: string) {
		form.setFieldValue("address", text);
		setAddressError(null);
		// If the user clears or edits away from the Google-picked address, drop
		// the stale coordinates — they no longer correspond to what's on file.
		if (geo.placeId !== undefined && text !== location?.address) {
			setGeo({ latitude: undefined, longitude: undefined, placeId: undefined });
		}
	}

	function handleSubmit(e: FormEvent) {
		submitThenFocusError(form, e);
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
							{/* Kind first — it frames everything below (a drop-off leans on
							    the schedule note; self-collect doesn't). */}
							<fieldset className="flex flex-col gap-2">
								<legend className="text-sm font-medium">
									What kind of point is this?
								</legend>
								<div className="grid grid-cols-2 gap-2">
									<KindButton
										active={kind === "self_collect"}
										onClick={() => setKind("self_collect")}
										title="Self-collect"
										subtitle="Your own place"
									/>
									<KindButton
										active={kind === "drop_off"}
										onClick={() => setKind("drop_off")}
										title="Drop-off"
										subtitle="Agreed meetup point"
									/>
								</div>
							</fieldset>

							<form.AppField name="label">
								{(field) => (
									<field.TextField
										label="Label"
										required
										placeholder={
											kind === "drop_off"
												? "Pasar Tani Seksyen 7, Surau Al-Hidayah…"
												: "Main store, KL warehouse…"
										}
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
								errorText={addressError ?? undefined}
							/>

							<form.AppField name="scheduleNote">
								{(field) => (
									<field.TextField
										label={
											kind === "drop_off"
												? "When are you there?"
												: "Availability (optional)"
										}
										placeholder="e.g. Every Sat 3–5pm"
										autoComplete="off"
										description={
											kind === "drop_off"
												? "Buyers see this next to the date picker so they pick a day the meetup happens. Max 120 characters."
												: "Optional opening hours for this point. Max 120 characters."
										}
									/>
								)}
							</form.AppField>

							{/* Fee sits between the point's logistics (where/when) and the
							    buyer notes — it's pricing for the point itself. */}
							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="pickup-fee-input"
									className="flex items-center gap-2 text-sm font-medium"
								>
									Pickup fee (optional)
									{canChargeFee ? null : <ProBadge />}
								</label>
								<div className="relative">
									<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
										RM
									</span>
									<input
										id="pickup-fee-input"
										type="text"
										inputMode="decimal"
										// Blank the shown amount once removal is staged so the
										// input matches what Save will write (free).
										value={feePendingRemoval ? "" : feeInput}
										disabled={!canChargeFee}
										onChange={(e) => {
											setFeeInput(e.target.value);
											setFeeError(null);
										}}
										onBlur={() => setFeeInput(normalizePriceInput(feeInput))}
										placeholder="0.00"
										aria-invalid={feeError ? true : undefined}
										className={`h-11 w-full rounded-lg border bg-background pl-11 pr-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
											feeError
												? "border-destructive ring-2 ring-destructive/20"
												: "border-input"
										}`}
									/>
								</div>
								{feeError ? (
									<p role="alert" className="text-sm text-destructive">
										{feeError}
									</p>
								) : null}
								{canChargeFee ? (
									<p className="text-xs text-muted-foreground leading-relaxed">
										Leave blank for free pickup. Buyers who choose this point
										see the fee added to their order total at checkout — use it
										to pass on a real cost, like a host who charges or a
										collection run.
									</p>
								) : lockedWithExistingFee ? (
									feePendingRemoval ? (
										<div className="flex items-center justify-between gap-2">
											<p className="text-xs font-medium text-amber-700 leading-relaxed">
												Pickup fee will be removed when you save.
											</p>
											<button
												type="button"
												onClick={() => setFeePendingRemoval(false)}
												className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
											>
												Keep fee
											</button>
										</div>
									) : (
										<div className="flex flex-col gap-2">
											<p className="text-xs text-muted-foreground leading-relaxed">
												Charging a pickup fee is a Pro feature. This point's
												existing fee still applies to new orders — upgrade in
												Settings → Billing to change it, or remove it now to
												make this point free.
											</p>
											<button
												type="button"
												onClick={() => setFeePendingRemoval(true)}
												className="h-9 self-start rounded-lg border border-input px-3 text-xs font-medium text-foreground hover:bg-muted"
											>
												Remove fee
											</button>
										</div>
									)
								) : (
									<p className="text-xs text-muted-foreground leading-relaxed">
										Charging a pickup fee is a Pro feature — upgrade in Settings
										→ Billing to pass on a collection cost (like a paid drop-off
										host) to buyers who choose this point.
									</p>
								)}
							</div>

							<form.AppField name="notes">
								{(field) => (
									<field.TextareaField
										label="Notes for buyers (optional)"
										placeholder="Parking instructions, what to bring, etc."
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
										Optional. When you set a WhatsApp number, every pickup order
										at this location gets a one-tap{" "}
										<span className="font-medium text-foreground">
											Notify {"<name>"}
										</span>{" "}
										button on the order page so you can forward order details on
										WhatsApp without copy-pasting. The name field is just used
										to label the button — leave it blank for a generic "Notify
										on WhatsApp" button.
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
								<p
									data-form-error
									role="alert"
									className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
								>
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
