import { Link } from "@tanstack/react-router";
import { ChevronRight, Info, Loader2, Search, X } from "lucide-react";
import {
	type KeyboardEvent,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import {
	type SettingContext,
	type SettingResult,
	searchSettings,
} from "./product-setting-index";
import { revealSetting } from "./reveal-setting";

/**
 * "Find a setting" on the full product form (z8r3fdwwy3): type what you're
 * after ("weight", "SKU", "berat", a choice's name) and pick it — the form
 * opens whatever row, Advanced box or choice list is in the way, scrolls to
 * the field, rings it and puts the cursor in it.
 *
 * A jump list, not a filter over the page: a result names WHERE the field
 * lives, which is the thing the seller didn't know, and most hard-to-find
 * fields sit inside the price card, which can't be half-hidden. The page
 * doesn't change shape while they type.
 *
 * Matching is synchronous over the index, so typing has no loading state on
 * purpose — a spinner there would only flicker. The one real wait is after a
 * pick, while a big Advanced box renders; the status line says what is
 * opening, and says so plainly if the jump had to stop at the section.
 */

/** Results shown at once; the rest are counted under the list. */
const MAX_SHOWN = 8;
/** A jump that lands within this needs no "Opening…" line at all. */
const OPENING_DELAY_MS = 150;

type Status =
	| { kind: "idle" }
	| { kind: "opening"; result: SettingResult; visible: boolean }
	| { kind: "fallback"; result: SettingResult };

const breadcrumb = (where: readonly string[]) => where.join(" → ");

export function SettingSearch({
	context,
	formRef,
	inputRef,
}: {
	context: SettingContext;
	/** The form the results live in — every jump is scoped to it. */
	formRef: RefObject<HTMLFormElement | null>;
	/** Lets the save bar's "Find a setting" button bring the box back. */
	inputRef: RefObject<HTMLInputElement | null>;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const listId = useId();
	const optionId = (i: number) => `${listId}-option-${i}`;
	const cancelReveal = useRef<(() => void) | null>(null);

	// Recomputed every render on purpose: the context is rebuilt from the
	// drafts each time, and a few hundred short strings is well under a
	// millisecond — a memo would never hit.
	const results = searchSettings(context, query);
	const shown = results.slice(0, MAX_SHOWN);
	const typed = query.trim().length > 0;
	const listOpen = open && typed;

	useEffect(() => () => cancelReveal.current?.(), []);

	// Arrowing past the bottom of the list keeps the highlighted result in
	// view. A DOM read, not state — nothing else depends on it.
	const activeId = listOpen ? optionId(active) : null;
	useEffect(() => {
		if (activeId)
			document.getElementById(activeId)?.scrollIntoView?.({
				block: "nearest",
			});
	}, [activeId]);

	// "/" jumps to the search from anywhere on the form, the way most search
	// boxes behave — but never while the seller is typing into a field.
	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
			const t = e.target as HTMLElement | null;
			if (t?.closest("input, textarea, select, [contenteditable='true']"))
				return;
			e.preventDefault();
			inputRef.current?.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [inputRef]);

	function pick(result: SettingResult) {
		const form = formRef.current;
		if (!form) return;
		setOpen(false);
		cancelReveal.current?.();
		setStatus({ kind: "opening", result, visible: false });
		const showOpening = setTimeout(
			() =>
				setStatus((s) =>
					s.kind === "opening" && s.result.key === result.key
						? { ...s, visible: true }
						: s,
				),
			OPENING_DELAY_MS,
		);
		cancelReveal.current = revealSetting(form, result, (outcome) => {
			clearTimeout(showOpening);
			setStatus(
				outcome === "found" ? { kind: "idle" } : { kind: "fallback", result },
			);
		});
	}

	function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Escape") {
			if (typed || open) {
				e.preventDefault();
				setQuery("");
				setOpen(false);
			}
			return;
		}
		if (!typed) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setOpen(true);
			setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			// Never submits the product form from the search box.
			e.preventDefault();
			const r = shown[active];
			if (r) pick(r);
		}
	}

	return (
		<div className="relative flex flex-col gap-1.5">
			<div className="relative">
				<Search
					className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden
				/>
				<Input
					ref={inputRef}
					type="search"
					variant="field"
					role="combobox"
					aria-label="Find a setting on this product"
					aria-expanded={listOpen}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={
						listOpen && shown[active] ? optionId(active) : undefined
					}
					autoComplete="off"
					enterKeyHint="go"
					// Short enough to read whole on a 375px phone.
					placeholder="Find a setting — weight, SKU…"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						// A new query always starts at the best match.
						setActive(0);
						setOpen(true);
						if (status.kind === "fallback") setStatus({ kind: "idle" });
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={onKeyDown}
					// The native search "x" duplicates ours, which has a 44px target.
					className="h-11 pl-9 pr-11 [&::-webkit-search-cancel-button]:appearance-none"
				/>
				{typed ? (
					<button
						type="button"
						aria-label="Clear search"
						// Keeps focus in the box so the list stays put.
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							setQuery("");
							inputRef.current?.focus();
						}}
						className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				) : null}
			</div>

			{listOpen ? (
				<div
					// Above the question rows and the spotlight ring; below dialogs.
					className="absolute inset-x-0 top-12 z-30 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg"
				>
					{shown.length === 0 ? (
						<div className="flex flex-col gap-1 px-4 py-4 text-sm">
							<p className="font-medium">
								Nothing called “{query.trim()}” on a product.
							</p>
							<p className="text-xs leading-relaxed text-muted-foreground">
								Delivery, payments and store-wide rules live in{" "}
								<Link
									to="/app/settings"
									onMouseDown={(e) => e.preventDefault()}
									className="font-medium text-foreground underline underline-offset-2"
								>
									Settings
								</Link>
								.
							</p>
						</div>
					) : (
						<>
							<div
								id={listId}
								role="listbox"
								aria-label="Settings on this product"
								className="flex max-h-[min(60vh,26rem)] flex-col overflow-y-auto overscroll-contain py-1"
							>
								{shown.map((r, i) => (
									// A real button (Enter/Space for free), kept out of the tab
									// order: the search box owns the keyboard and points here via
									// aria-activedescendant — the dial-country-picker pattern.
									<button
										type="button"
										key={r.key}
										id={optionId(i)}
										role="option"
										aria-selected={i === active}
										tabIndex={-1}
										// Keep the input's focus, or its blur closes the list
										// before the tap lands.
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => pick(r)}
										onMouseMove={() => setActive(i)}
										className={cn(
											"flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left",
											i === active && "bg-muted",
										)}
									>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="text-sm font-medium leading-snug">
												{r.label}
											</span>
											{/* Wraps, never truncates: WHERE it lives is the answer the
											    seller came for, and its tail is the most specific part. */}
											<span className="text-pretty text-xs leading-snug text-muted-foreground">
												{breadcrumb(r.where)}
											</span>
											{r.blocked ? (
												<span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
													<Info
														className="mt-px size-3.5 shrink-0"
														aria-hidden
													/>
													{r.blocked}
												</span>
											) : null}
										</span>
										<ChevronRight
											className="size-4 shrink-0 text-muted-foreground"
											aria-hidden
										/>
									</button>
								))}
							</div>
							{results.length > shown.length ? (
								<p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
									{results.length - shown.length} more — keep typing to narrow
									it down
								</p>
							) : null}
						</>
					)}
				</div>
			) : null}

			<p aria-live="polite" className="min-h-0 text-xs text-muted-foreground">
				{status.kind === "opening" && status.visible ? (
					<span className="flex items-center gap-1.5 px-1">
						<Loader2
							className="size-3.5 animate-spin motion-reduce:animate-none"
							aria-hidden
						/>
						Opening {breadcrumb(status.result.where)}…
					</span>
				) : status.kind === "fallback" ? (
					<span className="flex items-start gap-1.5 px-1">
						<Info className="mt-px size-3.5 shrink-0" aria-hidden />
						Couldn’t jump straight to {status.result.label} — it’s in the
						section shown.
					</span>
				) : null}
			</p>
		</div>
	);
}
