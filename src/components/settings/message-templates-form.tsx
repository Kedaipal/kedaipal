import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	defaultTemplate,
	type Locale,
	type MessageTemplates,
	TEMPLATE_KEYS,
} from "../../../convex/lib/whatsappCopy";
import { convexErrorMessage } from "../../lib/format";
import {
	editableTemplates,
	LOCALE_LABELS,
	TEMPLATE_LOCALES,
} from "../../lib/message-templates";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
	Glance,
	HelperBullets,
	InfoDisclosure,
	SectionHeading,
} from "./settings-primitives";

// The card earns its place on one narrow job: a buyer who types their order
// number into the shared number gets this reply. The order's own confirmation is
// a fixed Meta template and is NOT editable here — if TEMPLATE_KEYS ever empties
// out, delete this card rather than shipping an editor that changes nothing.
//
// One collapsed row per language (86eye9xd4, 11A): the first line of what goes
// out, and whether it's Kedaipal's default or the seller's own — the chip
// answers "what have I changed?" without opening anything.
export function MessageTemplatesForm({
	current,
	onSave,
}: {
	current: MessageTemplates | undefined;
	onSave: (templates: MessageTemplates) => Promise<unknown>;
}) {
	const saved = editableTemplates(current);
	const [open, setOpen] = useState<Locale | null>(null);
	const [value, setValue] = useState("");
	const [saving, setSaving] = useState(false);
	const key = TEMPLATE_KEYS[0];
	const customisedCount = TEMPLATE_LOCALES.filter((loc) =>
		Boolean(saved[loc]?.[key]),
	).length;

	// Opens on what goes out today — the seller's own text, or Kedaipal's
	// default — so changing one word is an edit, not a retype of the whole
	// reply and its {shortId}.
	function openRow(loc: Locale) {
		setOpen(loc);
		setValue(saved[loc]?.[key] ?? defaultTemplate(loc, key));
	}

	async function save(loc: Locale, next: string) {
		const rest = { ...saved };
		// The default, saved back as-is (or emptied), IS the default: store
		// nothing, so a later change to Kedaipal's wording still reaches them.
		const trimmed =
			next.trim() === defaultTemplate(loc, key).trim() ? "" : next.trim();
		rest[loc] = trimmed ? { ...(rest[loc] ?? {}), [key]: trimmed } : {};
		setSaving(true);
		try {
			await onSave(editableTemplates(rest));
			toast.success(
				trimmed
					? `${LOCALE_LABELS[loc]} reply saved.`
					: `${LOCALE_LABELS[loc]} is back to the default reply.`,
			);
			setOpen(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Order-number reply"
				description={
					<>
						What our shared number replies when a buyer sends their order number
						(e.g. <code className="font-mono">ORD-1234</code>).
					</>
				}
				glance={
					customisedCount > 0 ? (
						<Glance>Customised</Glance>
					) : (
						<Glance tone="grey">Default</Glance>
					)
				}
			/>

			<div className="flex flex-col">
				{TEMPLATE_LOCALES.map((loc) => {
					const custom = saved[loc]?.[key];
					const preview = (custom ?? defaultTemplate(loc, key)).split("\n")[0];
					const isOpen = open === loc;
					return (
						<div
							key={loc}
							className="flex flex-col border-t border-border/60 first:border-t-0"
						>
							<button
								type="button"
								aria-expanded={isOpen}
								onClick={() => (isOpen ? setOpen(null) : openRow(loc))}
								className="flex min-h-14 w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="text-sm font-semibold text-foreground">
										{LOCALE_LABELS[loc]}
									</span>
									<span className="truncate text-xs text-muted-foreground">
										{preview}
									</span>
								</span>
								{custom ? (
									<Glance>Customised</Glance>
								) : (
									<Glance tone="grey">Default</Glance>
								)}
								<ChevronDown
									aria-hidden
									className={cn(
										"size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
										isOpen && "rotate-180",
									)}
								/>
							</button>
							{isOpen ? (
								<div className="flex flex-col gap-3 pb-4">
									<textarea
										aria-label={`${LOCALE_LABELS[loc]} reply`}
										value={value}
										onChange={(e) => setValue(e.target.value)}
										placeholder={defaultTemplate(loc, key)}
										rows={3}
										maxLength={1000}
										className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
									/>
									<p className="text-xs text-muted-foreground">
										Keep <code className="font-mono">{"{shortId}"}</code> and{" "}
										<code className="font-mono">{"{storeName}"}</code> — they
										fill in for each order.
									</p>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											className="h-11"
											isLoading={saving}
											disabled={
												saving ||
												value.trim() ===
													(custom ?? defaultTemplate(loc, key)).trim() ||
												!value.trim()
											}
											onClick={() => void save(loc, value)}
										>
											Save reply
										</Button>
										{custom ? (
											<Button
												type="button"
												variant="outline"
												className="h-11"
												disabled={saving}
												onClick={() => void save(loc, "")}
											>
												Reset to default
											</Button>
										) : null}
										<Button
											type="button"
											variant="ghost"
											className="h-11"
											onClick={() => setOpen(null)}
										>
											Cancel
										</Button>
									</div>
								</div>
							) : null}
						</div>
					);
				})}
			</div>

			<InfoDisclosure summary="Why the confirmation can't be edited">
				<HelperBullets
					items={[
						"The order confirmation is a fixed Meta-approved template — WhatsApp's rule for messaging someone who hasn't written first",
						"This reply is what goes out when a buyer writes their order number to our shared number",
						<>
							Use <code className="font-mono">{"{shortId}"}</code> and{" "}
							<code className="font-mono">{"{storeName}"}</code> as variables
						</>,
					]}
				/>
			</InfoDisclosure>
		</div>
	);
}
