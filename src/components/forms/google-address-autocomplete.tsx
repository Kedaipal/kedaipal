import { useAction } from "convex/react";
import { ChevronDown, Loader2, MapPin, Search, X } from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { GoogleAddressComponent } from "../../../convex/google";
import { useDebounce } from "../../hooks/useDebounce";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";

/**
 * Structured payload emitted when the user picks a Google suggestion. The
 * `addressComponents` are passed through raw so each consuming form can parse
 * them in its own way — checkout maps to line1/city/state/postcode; the
 * pickup-settings form just stores `formattedAddress` + lat/lng directly.
 */
export type GoogleSelectedAddress = {
	formattedAddress: string;
	placeId: string;
	latitude: number;
	longitude: number;
	addressComponents: GoogleAddressComponent[];
};

interface Prediction {
	placeId: string;
	primaryText: string;
	secondaryText: string;
}

interface GoogleAddressAutocompleteProps {
	/** Initial text shown in the input. */
	initialValue?: string;
	/** Required for unauthenticated (storefront) callers. Authenticated callers
	 * can omit — the Convex action falls back to Clerk identity for rate-limit
	 * scoping. */
	retailerId?: Id<"retailers">;
	placeholder?: string;
	label?: string;
	required?: boolean;
	description?: string;
	/** Fires when the user picks a Google suggestion. */
	onSelect: (payload: GoogleSelectedAddress) => void;
	/** Fires whenever the user types or clears the input — lets the parent
	 * mirror the current text into a manual-entry fallback field. */
	onTextChange?: (text: string) => void;
	disabled?: boolean;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Generate a UUID for Google's session-token billing. Modern browsers all
 * have `crypto.randomUUID`; the fallback path is defensive for older
 * Safari / Android WebView, since this runs on the public storefront too.
 */
function newSessionToken(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	// RFC4122 v4 fallback. Same entropy bucket, just not native.
	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
		const n = Number(c);
		const r =
			(typeof crypto !== "undefined"
				? crypto.getRandomValues(new Uint8Array(1))[0]
				: Math.floor(Math.random() * 256)) & 15;
		return (n ^ (r >> (n / 4))).toString(16);
	});
}

export function GoogleAddressAutocomplete({
	initialValue = "",
	retailerId,
	placeholder = "Start typing an address…",
	label,
	required = false,
	description,
	onSelect,
	onTextChange,
	disabled = false,
}: GoogleAddressAutocompleteProps) {
	const autocomplete = useAction(api.google.autocompleteAddress);
	const getDetails = useAction(api.google.getPlaceDetails);

	const [input, setInput] = useState(initialValue);
	const [predictions, setPredictions] = useState<Prediction[]>([]);
	const [loading, setLoading] = useState(false);
	const [resolving, setResolving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);

	// Session token persists across the whole "type → see suggestions → pick"
	// cycle so Google bundles autocomplete + details into one billable session.
	// Rotated after a successful pick to start a fresh session.
	const sessionTokenRef = useRef<string>(newSessionToken());

	// Track the latest in-flight autocomplete call so a slow earlier response
	// doesn't overwrite a fresher one (race condition during fast typing).
	const requestIdRef = useRef(0);

	const debouncedInput = useDebounce(input.trim(), DEBOUNCE_MS);

	// Fire autocomplete when the debounced input changes.
	useEffect(() => {
		// Don't query for tiny inputs — wastes session budget and yields noise.
		if (debouncedInput.length < MIN_QUERY_LENGTH) {
			setPredictions([]);
			setLoading(false);
			return;
		}
		const requestId = ++requestIdRef.current;
		setLoading(true);
		setError(null);
		autocomplete({
			input: debouncedInput,
			sessionToken: sessionTokenRef.current,
			retailerId,
		})
			.then((result) => {
				if (requestId !== requestIdRef.current) return; // stale
				setPredictions(result.predictions);
				setActiveIndex(0);
			})
			.catch((err) => {
				if (requestId !== requestIdRef.current) return;
				setPredictions([]);
				setError(convexErrorMessage(err));
			})
			.finally(() => {
				if (requestId !== requestIdRef.current) return;
				setLoading(false);
			});
	}, [debouncedInput, autocomplete, retailerId]);

	const handleInputChange = useCallback(
		(value: string) => {
			setInput(value);
			setOpen(true);
			onTextChange?.(value);
		},
		[onTextChange],
	);

	const handleSelect = useCallback(
		async (prediction: Prediction) => {
			setResolving(true);
			setError(null);
			try {
				const details = await getDetails({
					placeId: prediction.placeId,
					sessionToken: sessionTokenRef.current,
					retailerId,
				});
				// Reflect Google's canonical formatted address in the input so
				// the user sees what they actually picked.
				setInput(details.formattedAddress);
				setOpen(false);
				onTextChange?.(details.formattedAddress);
				onSelect({
					formattedAddress: details.formattedAddress,
					placeId: prediction.placeId,
					latitude: details.latitude,
					longitude: details.longitude,
					addressComponents: details.addressComponents,
				});
				// New session for the next pick.
				sessionTokenRef.current = newSessionToken();
			} catch (err) {
				setError(convexErrorMessage(err));
			} finally {
				setResolving(false);
			}
		},
		[getDetails, retailerId, onSelect, onTextChange],
	);

	const handleClear = useCallback(() => {
		setInput("");
		setPredictions([]);
		setOpen(false);
		setError(null);
		onTextChange?.("");
	}, [onTextChange]);

	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (!open || predictions.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIndex((i) => Math.min(i + 1, predictions.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const pick = predictions[activeIndex];
			if (pick) handleSelect(pick);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	}

	const showDropdown =
		open &&
		(loading ||
			error !== null ||
			predictions.length > 0 ||
			(input.trim().length >= MIN_QUERY_LENGTH && !loading));

	return (
		<div className="flex flex-col gap-1.5">
			{label ? (
				<label className="text-sm font-medium" htmlFor="google-address-input">
					{label}
					{required ? <span className="ml-0.5 text-destructive">*</span> : null}
				</label>
			) : null}
			<div className="relative">
				<div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
					<Search
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						id="google-address-input"
						type="text"
						value={input}
						placeholder={placeholder}
						disabled={disabled || resolving}
						onChange={(e) => handleInputChange(e.target.value)}
						onFocus={() => setOpen(true)}
						onBlur={() => {
							// Defer close so onClick on a prediction row can fire first.
							setTimeout(() => setOpen(false), 150);
						}}
						onKeyDown={handleKeyDown}
						className="min-h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
						autoComplete="off"
						role="combobox"
						aria-expanded={showDropdown}
						aria-autocomplete="list"
					/>
					{resolving ? (
						<Loader2
							className="size-4 shrink-0 animate-spin text-muted-foreground"
							aria-hidden="true"
						/>
					) : input.length > 0 ? (
						<button
							type="button"
							onClick={handleClear}
							className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
							aria-label="Clear address"
						>
							<X className="size-4" />
						</button>
					) : (
						<ChevronDown
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					)}
				</div>

				{showDropdown ? (
					<div
						className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-input bg-background py-1 shadow-lg"
						role="listbox"
					>
						{loading ? (
							<div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" aria-hidden="true" />
								Searching…
							</div>
						) : error ? (
							<div className="px-3 py-2.5 text-sm text-destructive">
								{error}
							</div>
						) : predictions.length === 0 ? (
							<div className="px-3 py-2.5 text-sm text-muted-foreground">
								No matches — keep typing, or fill the fields manually below.
							</div>
						) : (
							predictions.map((p, i) => (
								<button
									type="button"
									key={p.placeId}
									onMouseDown={(e) => {
										// Use onMouseDown not onClick so it fires before the
										// input's onBlur closes the dropdown.
										e.preventDefault();
										handleSelect(p);
									}}
									onMouseEnter={() => setActiveIndex(i)}
									role="option"
									aria-selected={i === activeIndex}
									className={cn(
										"flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors",
										i === activeIndex ? "bg-muted" : "hover:bg-muted/60",
									)}
								>
									<MapPin
										className="size-4 shrink-0 text-accent mt-0.5"
										aria-hidden="true"
									/>
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm font-medium">
											{p.primaryText}
										</span>
										{p.secondaryText ? (
											<span className="truncate text-xs text-muted-foreground">
												{p.secondaryText}
											</span>
										) : null}
									</div>
								</button>
							))
						)}
					</div>
				) : null}
			</div>
			{description ? (
				<p className="text-xs text-muted-foreground">{description}</p>
			) : null}
		</div>
	);
}
