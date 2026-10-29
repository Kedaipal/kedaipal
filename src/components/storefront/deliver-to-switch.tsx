import { Globe } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import { countryName, shipsWithinLabel } from "../../../convex/lib/crossBorder";
import { TONE_PANEL } from "../../lib/tone";
import { cn } from "../../lib/utils";

/**
 * Checkout's "Deliver to" switch (z8r3fdr5yy) — only on a store that delivers
 * abroad. The store's own country first, then each country it delivers to.
 * The same segmented shell as the Delivery / Pickup choice right above it, so
 * the two read as one family of questions rather than two styles of control.
 */
export function DeliverToSwitch({
	storeCountry,
	countries,
	value,
	onChange,
}: {
	storeCountry: Country;
	/** Countries the store is taking cross-border orders to right now. */
	countries: readonly Country[];
	value: Country;
	onChange: (next: Country) => void;
}) {
	const options = [
		storeCountry,
		...countries.filter((c) => c !== storeCountry),
	];
	return (
		<fieldset className="flex min-w-0 flex-col gap-1.5">
			<legend className="mb-1.5 text-sm font-medium text-foreground">
				Deliver to
			</legend>
			<div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
				{options.map((country) => {
					const active = value === country;
					return (
						<button
							key={country}
							type="button"
							aria-pressed={active}
							onClick={() => onChange(country)}
							className={cn(
								"flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
								active
									? "bg-background text-accent-emphasis shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{country !== storeCountry ? (
								<Globe className="size-4" aria-hidden />
							) : null}
							{countryName(country)}
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}

/** The line under an overseas address: who pays what, said before ordering. */
export function OverseasDeliveryNote({
	storeCountry,
	destination,
}: {
	storeCountry: Country;
	destination: Country;
}) {
	return (
		<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
			Shipped from {countryName(storeCountry)} to {countryName(destination)}.
			Any import tax or duty is yours, collected by the courier on delivery.
		</p>
	);
}

/**
 * A cross-border cart holding products that stay home — named, each with a
 * one-tap Remove, never a submit error and never a silent split (Zaki,
 * 28 Oct: one order, one fulfilment contract).
 */
export function HomeOnlyItems({
	storeCountry,
	destination,
	products,
	lines,
	onRemove,
}: {
	storeCountry: Country;
	destination: Country;
	products: ReadonlyArray<{ productId: Id<"products">; name: string }>;
	/** Cart lines, so Remove takes out every choice of that product. */
	lines: ReadonlyArray<{
		productId: Id<"products">;
		variantId: Id<"productVariants">;
		name: string;
		optionLabel?: string;
	}>;
	onRemove: (variantId: Id<"productVariants">) => void;
}) {
	const blocked = lines.filter((line) =>
		products.some((p) => p.productId === line.productId),
	);
	return (
		<div
			role="alert"
			className={cn(
				"flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-sm",
				TONE_PANEL.warn,
			)}
		>
			<p className="font-semibold">
				{blocked.length === 1 ? "This item can't" : "These items can't"} go to{" "}
				{countryName(destination)}
			</p>
			<p className="text-xs">
				{shipsWithinLabel(storeCountry)} — remove{" "}
				{blocked.length === 1 ? "it" : "them"} to deliver to{" "}
				{countryName(destination)}, or deliver to an address in{" "}
				{countryName(storeCountry)}.
			</p>
			<ul className="flex flex-col gap-1.5">
				{blocked.map((line) => (
					<li
						key={line.variantId}
						className="flex items-center justify-between gap-3"
					>
						<span className="min-w-0 truncate">
							{line.name}
							{line.optionLabel ? ` · ${line.optionLabel}` : ""}
						</span>
						<button
							type="button"
							onClick={() => onRemove(line.variantId)}
							className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-semibold underline underline-offset-2"
						>
							Remove
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
