import { useMutation } from "convex/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	type DialIso,
	parseBuyerWaPhone,
} from "../../../convex/lib/buyerPhone";
import type { Country } from "../../../convex/lib/country";
import { splitStoredPhone } from "../../../convex/lib/phoneDial";
import { buyerPhoneRejection } from "../../lib/buyer-phone-rejection";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { BuyerPhoneCountrySwitch, BuyerPhoneInput } from "../ui/my-phone-input";

/**
 * The buyer's number repair on the order page (86eyf1rck): the confirmation
 * push couldn't reach the number they typed at checkout, so they retype it
 * and the push goes again (`orders.updateBuyerPhone`, capability-keyed on the
 * tracking token). Rendered by the track page's `PushFailedCard` only while
 * the buyer is editing — mounted fresh each time they tap "Update my number",
 * so every attempt starts from an empty field and the default country.
 *
 * Same buyer plate as the checkout field it repairs (z8r3fdh274): a country
 * picker, judged by `parseBuyerWaPhone` against the country PICKED — the same
 * parser the mutation runs. The picker opens on the country of the number
 * that failed (a buyer who typo'd a Japanese number most likely retypes a
 * Japanese one), else the store's.
 */
export function BuyerPhoneRepairForm({
	token,
	failedWaPhone,
	storeCountry,
	locale,
	onSaved,
	onCancel,
}: {
	/** The order's tracking token — the mutation's capability. NOT the shortId. */
	token: string;
	/** The stored number the push failed on (`order.customer.waPhone`). */
	failedWaPhone: string | undefined;
	/** From the order payload's `retailerCountry` — the picker's first option. */
	storeCountry: Country;
	locale: string;
	onSaved: () => void;
	onCancel: () => void;
}) {
	const ms = locale === "ms";
	const updatePhone = useMutation(api.orders.updateBuyerPhone);
	const [value, setValue] = useState("");
	// Null until the buyer picks: the default is DERIVED from the order
	// payload on every render, never copied into state.
	const [pickedDialCountry, setPickedDialCountry] = useState<DialIso | null>(
		null,
	);
	const dialCountry =
		pickedDialCountry ??
		(failedWaPhone ? splitStoredPhone(failedWaPhone)?.iso : undefined) ??
		storeCountry;
	// Left the field or tried to save — until then the rejection stays quiet
	// (`buyerPhoneRejection`: a complaint on the first digit is noise).
	const [touched, setTouched] = useState(false);
	const [busy, setBusy] = useState(false);
	const parsed = parseBuyerWaPhone(value, dialCountry);
	const rejection = buyerPhoneRejection(parsed, value, touched);

	// Focus on mount rather than autoFocus: the form only mounts when the buyer
	// taps "Update my number", so this is a response to their action, not a
	// page-load surprise. One-shot — a callback ref would re-fire every keystroke.
	const phoneInputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		phoneInputRef.current?.focus();
	}, []);

	async function handleSave(e: FormEvent) {
		e.preventDefault();
		// Judged here first, by the same parser the mutation runs: every server
		// try spends the per-token `buyerPhoneUpdate` budget (2 per 10 min), and
		// a typo shouldn't cost the buyer one of them. The reason renders under
		// the field; the toast below is left to what only the server can know
		// (the same number again, the budget itself).
		if (!parsed.ok) {
			setTouched(true);
			phoneInputRef.current?.focus();
			return;
		}
		setBusy(true);
		try {
			await updatePhone({
				token,
				waPhone: value.trim(),
				waDialCountry: dialCountry,
			});
			toast.success(
				ms
					? "Nombor dikemas kini — pengesahan sedang dihantar"
					: "Number updated — sending your confirmation now",
			);
			onSaved();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={handleSave} className="flex flex-col gap-2">
			<label
				htmlFor="repair-wa-phone"
				className="text-xs font-medium text-amber-950 dark:text-amber-100"
			>
				{ms ? "Nombor WhatsApp anda" : "Your WhatsApp number"}
			</label>
			{/* Its own neutral chrome inside the amber card, so the control reads
			    as a control and not as part of the warning. */}
			<BuyerPhoneInput
				id="repair-wa-phone"
				aria-describedby={rejection ? "repair-wa-phone-error" : undefined}
				ref={phoneInputRef}
				value={value}
				onChange={setValue}
				onBlur={() => setTouched(true)}
				storeCountry={storeCountry}
				dialCountry={dialCountry}
				onDialCountryChange={setPickedDialCountry}
				isError={rejection !== null}
				className="bg-white dark:bg-amber-950"
			/>
			{rejection ? (
				<>
					<p
						id="repair-wa-phone-error"
						className="text-xs font-medium text-destructive"
					>
						{rejection.message}
					</p>
					{rejection.suggest ? (
						<BuyerPhoneCountrySwitch
							suggest={rejection.suggest}
							onSwitch={setPickedDialCountry}
							locale={locale}
						/>
					) : null}
				</>
			) : null}
			<div className="flex gap-2">
				<Button
					type="submit"
					isLoading={busy}
					disabled={busy || value.trim().length === 0}
					className="h-11 flex-1"
				>
					{ms ? "Simpan & hantar" : "Save & resend"}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={busy}
					className="h-11"
				>
					{ms ? "Batal" : "Cancel"}
				</Button>
			</div>
		</form>
	);
}
