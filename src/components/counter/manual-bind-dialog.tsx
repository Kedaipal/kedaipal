import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type DialIso,
	dialCodeLabel,
	dialCountryName,
	parseBuyerWaPhone,
} from "../../../convex/lib/buyerPhone";
import type { Country } from "../../../convex/lib/country";
import { buyerPhoneRejection } from "../../lib/buyer-phone-rejection";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { BuyerPhoneCountrySwitch, BuyerPhoneInput } from "../ui/my-phone-input";

/**
 * The counter's "Enter buyer's number" bind (86ey8vqp6) — the no-scan path:
 * the cashier keys a walk-in buyer's name and WhatsApp number, and the buyer
 * still gets the one WhatsApp confirmation with their order link.
 *
 * The number is a BUYER's, so since z8r3fdh274 it wears the buyer plate: a
 * country picker defaulting to the store's country, judged by
 * `parseBuyerWaPhone` — the same parser `bindSessionManualPhone` runs — against
 * the country PICKED. A Bruneian tourist or a UK visitor is one tap on the
 * plate (or one `+CC` typed) away — a hint under the field says so. A
 * rejection takes the hint's place, and names the same way out ("…or tap +60
 * to change the country"), with a one-tap switch when the digits fit the other
 * supported country. See docs/counter-checkout.md
 * §Manual entry.
 *
 * Its own component (it lived inline in `app.checkout.tsx`) so the picker,
 * the inline rejection and the reset-on-close have a test.
 */
export function ManualBindDialog({
	open,
	onOpenChange,
	retailerId,
	storeCountry,
	onStarted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The act-as store when an admin is operating it; undefined = own store. */
	retailerId: Id<"retailers"> | undefined;
	/** The picker's default. Pass it straight from the dashboard retailer — the
	 * form derives from it on every render, never copies it into state. */
	storeCountry: Country;
	onStarted: (sessionId: string) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Enter buyer's number</DialogTitle>
					<DialogDescription>
						We'll send one WhatsApp confirming the order, with a link to their
						order page — no scan needed. That message includes our
						privacy-policy link.
					</DialogDescription>
				</DialogHeader>
				{/* The form's state lives in a child that unmounts with the dialog
				    content, so every open starts clean: the last buyer's picked
				    country, number and rejection can't leak into the next bind, and
				    no close path (Cancel, Esc, overlay, success) can forget to
				    reset one of them. */}
				<ManualBindForm
					retailerId={retailerId}
					storeCountry={storeCountry}
					onCancel={() => onOpenChange(false)}
					onStarted={(sessionId) => {
						onOpenChange(false);
						onStarted(sessionId);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

/** The plate's own line under the field: how to reach the picker, and — once
 * the cashier has used it — which country is on. */
function phoneHelp(storeCountry: Country, dialCountry: DialIso): string {
	return dialCountry === storeCountry
		? `Serving a visitor? Tap ${dialCodeLabel(dialCountry)} to pick their country.`
		: `Number from ${dialCountryName(dialCountry)} — tap ${dialCodeLabel(dialCountry)} to change it.`;
}

function ManualBindForm({
	retailerId,
	storeCountry,
	onCancel,
	onStarted,
}: {
	retailerId: Id<"retailers"> | undefined;
	storeCountry: Country;
	onCancel: () => void;
	onStarted: (sessionId: string) => void;
}) {
	const bindManual = useMutation(api.counterCheckout.bindSessionManualPhone);
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	// Null until the cashier picks. The default is DERIVED, never seeded:
	// `storeCountry` reads "MY" while the dashboard retailer is still loading,
	// so copying it into state at mount would open an SG store's picker on +60.
	const [pickedDialCountry, setPickedDialCountry] = useState<DialIso | null>(
		null,
	);
	// Left the field or tried to submit — until then the rejection stays quiet
	// (`buyerPhoneRejection`: a complaint on the first digit is noise).
	const [phoneTouched, setPhoneTouched] = useState(false);
	const [busy, setBusy] = useState(false);

	const dialCountry = pickedDialCountry ?? storeCountry;
	const parsed = parseBuyerWaPhone(phone, dialCountry);
	const phoneEntered = /\d/.test(phone);
	const rejection = buyerPhoneRejection(parsed, phone, phoneTouched);
	// A name is at least 3 chars (a single letter isn't a name) — mirrors the
	// storefront checkout + the server validator.
	const nameReady = name.trim().length >= 3;
	const ready = nameReady && parsed.ok;
	// Why "Start checkout" is disabled, said where the cashier is looking. A
	// visible phone rejection already says it, so it isn't repeated here.
	const blockedReason = !nameReady
		? "Enter the buyer's name (at least 3 letters) to start."
		: parsed.ok || rejection
			? null
			: phoneEntered
				? "Finish their WhatsApp number to start."
				: "Enter their WhatsApp number to start.";

	async function submit() {
		if (busy) return;
		if (!parsed.ok) {
			setPhoneTouched(true);
			return;
		}
		if (!nameReady) return;
		setBusy(true);
		try {
			const { sessionId } = await bindManual({
				retailerId,
				waPhone: phone,
				waDialCountry: dialCountry,
				name,
			});
			onStarted(sessionId);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<label className="block">
				<span className="text-xs font-medium text-muted-foreground">
					Buyer's name
				</span>
				<Input
					type="text"
					autoComplete="off"
					autoFocus
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. Aiman"
					className="mt-1 h-12 text-base"
				/>
			</label>
			<div className="flex flex-col gap-1">
				<label
					htmlFor="manual-bind-phone"
					className="text-xs font-medium text-muted-foreground"
				>
					WhatsApp number
				</label>
				<BuyerPhoneInput
					id="manual-bind-phone"
					aria-describedby={
						rejection ? "manual-bind-phone-error" : "manual-bind-phone-hint"
					}
					// The cashier is keying SOMEONE ELSE's number — the plate's `tel`
					// default would have the browser offer the seller's own.
					autoComplete="off"
					countryLabel="Country of the buyer's WhatsApp number"
					storeCountry={storeCountry}
					dialCountry={dialCountry}
					onDialCountryChange={setPickedDialCountry}
					value={phone}
					onChange={setPhone}
					onBlur={() => setPhoneTouched(true)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void submit();
					}}
					isError={rejection !== null}
					// Matches the name field's 48px row above it.
					className="min-h-12"
				/>
				{/* One line under the field: the picker hint, or — once the number
				    is refused — the reason in its place. The buyer rejection names
				    the picker itself ("…or tap +60 to change the country"), so the
				    likeliest refusal here, a visitor's number keyed without its
				    code, still points at the way out; saying it twice would not. */}
				{rejection ? (
					<p
						id="manual-bind-phone-error"
						className="text-xs font-medium text-destructive"
					>
						{rejection.message}
					</p>
				) : (
					<p
						id="manual-bind-phone-hint"
						className="text-xs text-muted-foreground"
					>
						{phoneHelp(storeCountry, dialCountry)}
					</p>
				)}
				{rejection?.suggest ? (
					<BuyerPhoneCountrySwitch
						suggest={rejection.suggest}
						onSwitch={setPickedDialCountry}
						inputId="manual-bind-phone"
					/>
				) : null}
			</div>
			{blockedReason ? (
				<p className="text-xs text-muted-foreground">{blockedReason}</p>
			) : null}
			<DialogFooter className="gap-2 sm:gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					className="h-11"
				>
					Cancel
				</Button>
				<Button
					type="button"
					onClick={submit}
					isLoading={busy}
					disabled={busy || !ready}
					className="h-11"
				>
					Start checkout
				</Button>
			</DialogFooter>
		</div>
	);
}
