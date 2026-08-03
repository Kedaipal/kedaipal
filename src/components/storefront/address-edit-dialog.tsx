import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import {
	addressEditFormSchema,
	type CheckoutAddressValues,
	emptyAddress,
} from "../../lib/schemas";
import { useLiveDeliveryQuote } from "../../lib/use-live-delivery-quote";
import { submitThenFocusError } from "../forms/focus-error";
import { useAppForm } from "../forms/form";
import { Button } from "../ui/button";
import { AddressFieldset } from "./address-fieldset";

interface AddressEditDialogProps {
	open: boolean;
	onClose: () => void;
	// Capability for the public address mutation (unguessable). NOT the shortId.
	token: string;
	currentAddress: Doc<"orders">["deliveryAddress"];
	/**
	 * Used by the Google autocomplete inside the field group to scope rate
	 * limiting (the dialog is unauthenticated — same trust model as the
	 * tracking page itself), and to detect live-priced (Lalamove) stores.
	 */
	retailerId: Id<"retailers"> | undefined;
	/** Order item subtotal (sen) — feeds the reactive delivery quote (the flat
	 * mode's free-above threshold needs it; live-mode detection ignores it). */
	subtotal: number;
	/** The order's fulfilment day (epoch-ms MYT midnight) — a live re-quote is
	 * priced for THAT day, matching how the original checkout quoted it. */
	fulfilmentDate?: number;
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
		placeId: addr.placeId ?? "",
	};
}

export function AddressEditDialog({
	open,
	onClose,
	token,
	currentAddress,
	retailerId,
	subtotal,
	fulfilmentDate,
}: AddressEditDialogProps) {
	const updateAddress = useMutation(api.orders.updateDeliveryAddress);
	const [serverError, setServerError] = useState<string | null>(null);

	// Live-priced (Lalamove) store? The reactive quote answers {kind:"live"};
	// the address edit then needs its own fresh provider quote (strict since
	// 27 Jul — an address change must show the buyer the new rider price, never
	// drop the order onto a seller-calculates path).
	const deliveryQuote = useQuery(
		api.delivery.quote,
		open && retailerId ? { retailerId, subtotal } : "skip",
	);
	const isLiveMode = deliveryQuote?.kind === "live";

	const form = useAppForm({
		defaultValues: toFormValues(currentAddress),
		validators: { onChange: addressEditFormSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			const line2 = value.line2.trim();
			const notes = value.notes.trim();
			const mapsUrl = value.mapsUrl.trim();
			const latNum =
				value.latitude.trim().length > 0 ? Number(value.latitude) : NaN;
			const lngNum =
				value.longitude.trim().length > 0 ? Number(value.longitude) : NaN;
			const validCoords =
				Number.isFinite(latNum) &&
				Number.isFinite(lngNum) &&
				latNum >= -90 &&
				latNum <= 90 &&
				lngNum >= -180 &&
				lngNum <= 180;
			const placeId = value.placeId.trim();
			try {
				await updateAddress({
					token,
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
						placeId: placeId.length > 0 ? placeId : undefined,
					},
					deliveryQuoteId:
						liveQuote.state === "quoted" ? liveQuote.quoteId : undefined,
				});
				onClose();
			} catch (err) {
				setServerError(convexErrorMessage(err));
			}
		},
	});

	// Watch the pin the Google autocomplete stamps into form state and fetch
	// the live price for it (same shared hook as the checkout sheet).
	const watchedLat = useStore(form.store, (s) => s.values.latitude);
	const watchedLng = useStore(form.store, (s) => s.values.longitude);
	const latNum = watchedLat.trim().length > 0 ? Number(watchedLat) : NaN;
	const lngNum = watchedLng.trim().length > 0 ? Number(watchedLng) : NaN;
	const hasCoords = Number.isFinite(latNum) && Number.isFinite(lngNum);
	const liveQuote = useLiveDeliveryQuote({
		enabled: isLiveMode && open,
		retailerId,
		latitude: hasCoords ? latNum : undefined,
		longitude: hasCoords ? lngNum : undefined,
		getAddressLabel: () => {
			const v = form.store.state.values;
			return [v.line1, v.line2, `${v.postcode} ${v.city}`.trim(), v.state]
				.filter((part) => part && part.trim().length > 0)
				.join(", ");
		},
		fulfilmentDate,
	});
	// A live-priced store can only save a PRICED address — the buyer sees the
	// new rider fee before confirming, mirroring checkout.
	const liveSaveBlocked = isLiveMode && liveQuote.state !== "quoted";

	function handleSubmit(e: FormEvent) {
		submitThenFocusError(form, e);
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
									placeId: "placeId",
								}}
								retailerId={retailerId}
								// The dialog's own title already says "Edit delivery address".
								legend={undefined}
								// A live-quoted (Lalamove) order is re-priced from the pin —
								// `liveSaveBlocked` refuses a save without a fresh quote — so a
								// hand-typed address here would be a dead end. Every other mode
								// keeps the manual escape hatch. See 86eye50qv.
								allowManualEntry={!isLiveMode}
							/>
							{/* Live-priced store: the new address's rider price, shown
							    BEFORE saving — the save stays disabled until it resolves. */}
							{isLiveMode ? (
								!hasCoords ? (
									<p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
										Pick your address from the suggestions to get the delivery
										price for it.
									</p>
								) : liveQuote.state === "quoted" ? (
									<p className="mt-4 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent-emphasis">
										Delivery to this address:{" "}
										<b>
											{liveQuote.fee === 0
												? "Free"
												: formatPrice(liveQuote.fee, "MYR")}
										</b>{" "}
										— your order total updates when you save.
									</p>
								) : liveQuote.state === "out_of_range" ? (
									// Permanent for this address — never suggest retrying it.
									<p
										role="alert"
										className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
									>
										This address is too far — the delivery rider service
										doesn&apos;t cover it. Pick an address closer to the store,
										or message the store to sort it out.
									</p>
								) : liveQuote.state === "store_unavailable" ? (
									// Seller-side breakage — retrying can't help the buyer.
									<p
										role="alert"
										className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
									>
										Delivery pricing isn&apos;t working for this store right now
										— it&apos;s on the store&apos;s side, not yours. Message
										them on WhatsApp to sort it out.
									</p>
								) : liveQuote.state === "unavailable" ? (
									<p
										role="alert"
										className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
									>
										We couldn&apos;t price delivery to this address — re-pick it
										from the suggestions, or try again shortly.
									</p>
								) : (
									<p className="mt-4 animate-pulse rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
										Getting the delivery price…
									</p>
								)
							) : null}
							{serverError ? (
								<p
									data-form-error
									role="alert"
									className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
								>
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
										disabled={!canSubmit || isSubmitting || liveSaveBlocked}
										className="h-12 w-full text-base"
									>
										{isSubmitting
											? "Saving…"
											: liveSaveBlocked
												? "Save address — needs a delivery price"
												: "Save address"}
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
