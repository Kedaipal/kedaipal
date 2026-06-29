import { useMutation } from "convex/react";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { cn } from "../../lib/utils";
import type { ChecklistItem } from "../../routes/app.index";
import { Button } from "../ui/button";

type GreetingLang = "en" | "ms";

/**
 * Greeting message templates funneling a customer who DM's the seller's
 * personal number to their Kedaipal storefront. `{{storeName}}` / `{{storeSlug}}`
 * are interpolated server-side of the UI from the retailer record — the seller
 * never edits them.
 */
const TEMPLATES: Record<GreetingLang, string> = {
	en: `Hi! Thanks for reaching out to {{storeName}} 😊

You can browse our menu and place your order here:
👉 kedaipal.com/{{storeSlug}}

We'll get back to you shortly. See you there!`,
	ms: `Hi! Terima kasih kerana menghubungi {{storeName}} 😊

Boleh tengok menu dan order terus kat sini:
👉 kedaipal.com/{{storeSlug}}

Kami akan balas dalam masa terdekat. Jumpa kat sana!`,
};

function fillTemplate(
	lang: GreetingLang,
	storeName: string,
	slug: string,
): string {
	return TEMPLATES[lang]
		.replaceAll("{{storeName}}", storeName)
		.replaceAll("{{storeSlug}}", slug);
}

const SETUP_STEPS = [
	"Open WhatsApp Business app",
	"Settings → Business tools → Greeting message",
	"Toggle ON",
	"Paste your message",
	"Save",
];

/**
 * Inline setup-checklist row for the optional "WhatsApp Business greeting
 * message" onboarding step. Unlike {@link ChecklistRow}, the expanded state is
 * a self-contained card (language toggle + copyable template + instructions)
 * rather than a link to a settings page — there is no in-app config, the seller
 * sets the greeting in their own WhatsApp app.
 */
export function GreetingChecklistRow({
	item,
	expanded,
	storeName,
	slug,
	locale,
}: {
	item: ChecklistItem;
	expanded: boolean;
	storeName: string;
	slug: string;
	locale: GreetingLang;
}) {
	const Icon = item.icon;
	const markDone = useMutation(api.retailers.markGreetingSetupDone);
	const [lang, setLang] = useState<GreetingLang>(locale);
	const [copied, setCopied] = useState(false);
	const [saving, setSaving] = useState(false);

	if (item.done) {
		return (
			<li className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
				<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
					<Check className="size-3" />
				</div>
				<p className="flex-1 text-sm font-medium text-muted-foreground line-through">
					{item.title}
				</p>
				<span className="text-xs text-muted-foreground">Done</span>
			</li>
		);
	}

	if (!expanded) {
		return (
			<li>
				<div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-[10px] font-bold text-muted-foreground">
						{item.step}
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
				</div>
			</li>
		);
	}

	const message = fillTemplate(lang, storeName, slug);

	async function copy() {
		try {
			await navigator.clipboard.writeText(message);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {
			// ignore — clipboard may be unavailable (insecure context / permissions)
		}
	}

	async function complete() {
		if (saving) return;
		setSaving(true);
		try {
			await markDone({});
		} catch {
			setSaving(false);
		}
	}

	return (
		<li className="flex flex-col gap-3 rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
			<div className="flex items-start gap-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
					<Icon className="size-4" />
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2">
						<span className="text-[10px] font-bold uppercase tracking-wider text-accent">
							Step {item.step}
						</span>
						<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
							Optional
						</span>
						<span className="text-[10px] text-muted-foreground">
							{item.time}
						</span>
					</div>
					<p className="mt-0.5 text-sm font-semibold">{item.title}</p>
					<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
						{item.why}
					</p>
				</div>
			</div>

			{/* Language toggle */}
			<div className="flex gap-1.5">
				<LangButton active={lang === "en"} onClick={() => setLang("en")}>
					English
				</LangButton>
				<LangButton active={lang === "ms"} onClick={() => setLang("ms")}>
					Bahasa Malaysia
				</LangButton>
			</div>

			{/* Pre-filled template (read-only) */}
			<pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 font-sans text-xs leading-relaxed text-foreground">
				{message}
			</pre>

			<Button size="sm" className="h-10 w-full gap-2" onClick={copy}>
				{copied ? (
					<>
						<Check className="size-3.5" />
						Copied!
					</>
				) : (
					<>
						<Copy className="size-3.5" />
						Copy message
					</>
				)}
			</Button>

			{/* Step-by-step instructions */}
			<ol className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
				{SETUP_STEPS.map((step, i) => (
					<li key={step} className="flex gap-2">
						<span className="font-semibold text-foreground">{i + 1}.</span>
						<span>{step}</span>
					</li>
				))}
			</ol>

			<div className="flex items-center justify-between gap-2">
				<Button
					size="sm"
					variant="outline"
					className="h-9"
					onClick={complete}
					disabled={saving}
				>
					Mark as done
				</Button>
				<button
					type="button"
					className={cn(
						"text-xs font-medium text-muted-foreground underline-offset-4 hover:underline",
						saving && "pointer-events-none opacity-50",
					)}
					onClick={complete}
				>
					Skip for now
				</button>
			</div>
		</li>
	);
}

function LangButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-full border px-3 py-1 text-xs font-medium transition-colors",
				active
					? "border-accent bg-accent text-accent-foreground"
					: "border-border bg-background text-muted-foreground hover:bg-muted",
			)}
		>
			{children}
		</button>
	);
}
