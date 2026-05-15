import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Building2, Info, Music2, Store } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { SUPPORTED_CURRENCIES } from "../../convex/lib/currency";
import {
	defaultTemplate,
	type Locale,
	type MessageTemplates,
	TEMPLATE_KEYS,
	type TemplateKey,
} from "../../convex/lib/whatsappCopy";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { useAppForm } from "../components/forms/form";
import { ShopeeIcon } from "../components/icons/shopee-icon";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { convexErrorMessage } from "../lib/format";
import {
	settingsNotifyEmailFormSchema,
	settingsWaPhoneFormSchema,
} from "../lib/schemas";

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({
	value: c,
	label: c,
}));

const LOCALE_OPTIONS = [
	{ value: "en", label: "English" },
	{ value: "ms", label: "Bahasa Malaysia" },
] as const;

type SettingsTab = "store" | "whatsapp" | "payments" | "integrations";

const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
	{ id: "store", label: "Store" },
	{ id: "whatsapp", label: "WhatsApp" },
	{ id: "payments", label: "Payments" },
	{ id: "integrations", label: "Integrations" },
];

function Card({ children }: { children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			{children}
		</section>
	);
}

function SectionHeading({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold text-foreground">{title}</h3>
			{description ? (
				<p className="text-xs text-muted-foreground leading-relaxed">
					{description}
				</p>
			) : null}
		</div>
	);
}

const SAVE_BTN_CLASS = "h-11 lg:h-10 lg:w-auto lg:self-end lg:min-w-[160px]";

function InfoBanner({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex gap-3 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3.5">
			<Info className="size-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
			<div className="flex flex-col gap-1.5 text-sm text-muted-foreground leading-relaxed">
				<p className="font-medium text-foreground">{title}</p>
				{children}
			</div>
		</div>
	);
}

export const Route = createFileRoute("/app/settings")({
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (["store", "whatsapp", "payments", "integrations"].includes(
			search.tab as string,
		)
			? search.tab
			: "store") as SettingsTab,
	}),
	component: SettingsRoute,
});

function SettingsSkeleton() {
	return (
		<div className="flex flex-col gap-6 lg:max-w-2xl">
			<PageHeaderSkeleton hasSubtitle />
			<section className="flex flex-col gap-2 lg:hidden">
				<Skeleton className="h-7 w-24" />
				<Skeleton className="h-4 w-48" />
			</section>

			{/* Tab bar */}
			<div className="flex gap-1 border-b border-input">
				{[64, 88, 80, 96].map((w) => (
					<Skeleton
						key={w}
						className="h-11 rounded-none"
						style={{ width: w }}
					/>
				))}
			</div>

			{/* Form cards */}
			<div className="flex flex-col gap-6 pt-2">
				{[0, 1, 2].map((n) => (
					<section
						key={n}
						className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-4"
					>
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-2/3" />
						</div>
						<div className="flex flex-col gap-2">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-11 w-full rounded-xl" />
						</div>
						<Skeleton className="h-12 w-full rounded-md" />
					</section>
				))}
			</div>
		</div>
	);
}

function SettingsRoute() {
	const retailer = useQuery(api.retailers.getMyRetailer);
	const renameSlug = useMutation(api.retailers.renameSlug);
	const updateSettings = useMutation(api.retailers.updateSettings);

	const { tab } = Route.useSearch();
	const [activeTab, setActiveTab] = useState<SettingsTab>(tab);
	const [newSlug, setNewSlug] = useState("");
	const [saving, setSaving] = useState(false);

	const availability = useSlugAvailability(newSlug);

	if (!retailer) return <SettingsSkeleton />;

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		if (availability.status !== "available") return;
		if (!retailer) return;
		const previous = retailer.slug;
		setSaving(true);
		try {
			await renameSlug({ newSlug });
			toast.success(
				`Renamed. Links to /${previous} will redirect for 90 days.`,
			);
			setNewSlug("");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	const slugRenameForm = (
		<Card>
			<SectionHeading
				title="Storefront URL"
				description="Rename your public storefront slug. Old links keep redirecting for 90 days."
			/>
			<form onSubmit={onSubmit} className="flex flex-col gap-3">
				<div className="flex items-center rounded-xl border border-input bg-background pl-4 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
					<span className="select-none text-sm text-muted-foreground">
						kedaipal.com/
					</span>
					<input
						type="text"
						value={newSlug}
						onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
						placeholder="new-slug"
						className="min-h-11 flex-1 bg-transparent pl-0 pr-4 font-mono text-base outline-none"
					/>
				</div>
				<Hint state={availability} />
				<Button
					type="submit"
					disabled={availability.status !== "available" || saving}
					className={SAVE_BTN_CLASS}
				>
					{saving ? "Saving…" : "Rename"}
				</Button>
			</form>
		</Card>
	);

	return (
		<div className="flex flex-col gap-6 lg:max-w-2xl">
			<PageHeader
				title="Settings"
				subtitle={
					<span>
						Current slug: <span className="font-mono">{retailer.slug}</span>
					</span>
				}
			/>
			<section className="flex flex-col gap-2 lg:hidden">
				<h2 className="text-xl font-bold">Settings</h2>
				<p className="text-sm text-muted-foreground">
					Current slug: <span className="font-mono">{retailer.slug}</span>
				</p>
			</section>

			<div className="-mx-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-input px-4 lg:mx-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{SETTINGS_TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setActiveTab(t.id)}
						className={`relative min-h-11 whitespace-nowrap px-4 text-sm font-medium transition-colors ${
							activeTab === t.id
								? "text-primary after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{activeTab === "store" ? (
				<div className="flex flex-col gap-6 pt-2">
					<Card>
						<StoreNameForm
							current={retailer.storeName}
							onSave={(storeName) => updateSettings({ storeName })}
						/>
					</Card>
					{slugRenameForm}
					<Card>
						<LogoForm
							currentLogoUrl={retailer.logoUrl}
							onSave={(logoStorageId) => updateSettings({ logoStorageId })}
						/>
					</Card>
					<Card>
						<NotifyEmailForm
							current={retailer.notifyEmail ?? ""}
							onSave={(notifyEmail) => updateSettings({ notifyEmail })}
						/>
					</Card>
					<Card>
						<CurrencyForm
							current={retailer.currency}
							onSave={(currency) => updateSettings({ currency })}
						/>
					</Card>
				</div>
			) : null}

			{activeTab === "whatsapp" ? (
				<div className="flex flex-col gap-6 pt-2">
					<InfoBanner title="How WhatsApp works on Kedaipal">
						<p>
							All automated order messages (confirmations, packed, shipped,
							delivered) are sent from{" "}
							<span className="font-medium text-foreground">
								Kedaipal's shared WhatsApp Business number
							</span>{" "}
							on your behalf — no Meta account needed.
						</p>
						<p>
							Add your personal WhatsApp number below so buyers can reach you
							directly. It appears as a tappable contact link in automated
							messages.
						</p>
					</InfoBanner>

					<Card>
						<WaPhoneForm
							current={retailer.waPhone ?? ""}
							onSave={(waPhone) => updateSettings({ waPhone })}
						/>
					</Card>
					<Card>
						<LocaleForm
							current={retailer.locale}
							onSave={(locale) => updateSettings({ locale })}
						/>
					</Card>
					<Card>
						<MessageTemplatesForm
							current={retailer.messageTemplates}
							onSave={(messageTemplates) =>
								updateSettings({ messageTemplates })
							}
						/>
					</Card>
				</div>
			) : null}

			{activeTab === "payments" ? (
				<div className="flex flex-col gap-6 pt-2">
					<Card>
						<PaymentInstructionsForm
							current={retailer.paymentInstructions}
							currentQrUrl={retailer.paymentQrImageUrl}
							onSave={(paymentInstructions) =>
								updateSettings({ paymentInstructions })
							}
						/>
					</Card>
				</div>
			) : null}

			{activeTab === "integrations" ? (
				<div className="flex flex-col gap-6 pt-2">
					<InfoBanner title="Sales channels">
						<p>
							Connect your marketplace accounts to sync products and orders
							automatically. More channels are on the way.
						</p>
					</InfoBanner>

					<IntegrationCard
						name="Shopee"
						description="Sync your Shopee products and orders into Kedaipal. Manage everything from one dashboard."
						tint="bg-[#EE4D2D]/10 text-[#EE4D2D]"
						icon={<ShopeeIcon className="size-6" />}
					/>
					<IntegrationCard
						name="Lazada"
						description="Sync your Lazada products and orders into Kedaipal. Manage everything from one dashboard."
						tint="bg-[#0F146D]/10 text-[#0F146D] dark:bg-[#0F146D]/30 dark:text-[#9aa6ff]"
						icon={<Store className="size-6" />}
					/>
					<IntegrationCard
						name="TikTok Shop"
						description="Sync your TikTok Shop orders into Kedaipal so you never miss a sale."
						tint="bg-foreground/10 text-foreground"
						icon={<Music2 className="size-6" />}
					/>
					<IntegrationCard
						name="StoreHub"
						description="Reconcile your in-store StoreHub sales alongside online orders."
						tint="bg-[#FF7A00]/10 text-[#FF7A00]"
						icon={<Building2 className="size-6" />}
					/>
				</div>
			) : null}
		</div>
	);
}

type PaymentInstructionsDraft = {
	bankName: string;
	bankAccountName: string;
	bankAccountNumber: string;
	qrImageStorageId: string;
	note: string;
};

const EMPTY_PAYMENT_DRAFT: PaymentInstructionsDraft = {
	bankName: "",
	bankAccountName: "",
	bankAccountNumber: "",
	qrImageStorageId: "",
	note: "",
};

function StoreNameForm({
	current,
	onSave,
}: {
	current: string;
	onSave: (storeName: string) => Promise<unknown>;
}) {
	const [value, setValue] = useState(current);
	const [saving, setSaving] = useState(false);
	const dirty = value.trim() !== current.trim() && value.trim().length > 0;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!dirty) return;
		setSaving(true);
		try {
			await onSave(value.trim());
			toast.success("Business name updated.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<SectionHeading
				title="Business name"
				description="Shown on your storefront header and WhatsApp messages."
			/>
			<div className="flex flex-col gap-1.5">
				<input
					type="text"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="Your Store Name"
					maxLength={80}
					className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
				<span className="self-end text-xs text-muted-foreground tabular-nums">
					{value.trim().length}/80
				</span>
			</div>
			<Button
				type="submit"
				disabled={!dirty || saving}
				className={SAVE_BTN_CLASS}
			>
				{saving ? "Saving…" : "Save name"}
			</Button>
		</form>
	);
}

function LogoForm({
	currentLogoUrl,
	onSave,
}: {
	currentLogoUrl: string | undefined;
	onSave: (logoStorageId: string) => Promise<unknown>;
}) {
	const generateLogoUploadUrl = useMutation(
		api.retailers.generateLogoUploadUrl,
	);
	const [localPreview, setLocalPreview] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);

	const previewUrl = localPreview ?? currentLogoUrl ?? null;

	async function handleFile(file: File | null) {
		if (!file) return;
		setUploading(true);
		try {
			const url = await generateLogoUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			setLocalPreview(URL.createObjectURL(file));
			await onSave(storageId);
			toast.success("Logo saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	async function handleRemove() {
		try {
			await onSave("");
			setLocalPreview(null);
			toast.success("Logo removed.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Store logo"
				description="Square images work best. Shown on your storefront header and dashboard. Max ~2MB."
			/>

			{previewUrl ? (
				<div className="flex items-start gap-4">
					<img
						src={previewUrl}
						alt="Store logo"
						className="h-24 w-24 rounded-2xl border border-input bg-background object-contain"
					/>
					<div className="flex flex-1 flex-col gap-2">
						<label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border border-input bg-background px-4 text-sm font-medium hover:bg-accent/5">
							{uploading ? "Uploading…" : "Replace"}
							<input
								type="file"
								accept="image/*"
								className="hidden"
								disabled={uploading}
								onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
							/>
						</label>
						<button
							type="button"
							onClick={handleRemove}
							disabled={uploading}
							className="text-xs text-destructive underline disabled:opacity-50"
						>
							Remove logo
						</button>
					</div>
				</div>
			) : (
				<label className="flex h-32 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-input bg-background text-sm text-muted-foreground hover:bg-accent/5">
					{uploading ? "Uploading…" : "Tap to upload your logo"}
					<input
						type="file"
						accept="image/*"
						className="hidden"
						disabled={uploading}
						onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
					/>
				</label>
			)}
		</div>
	);
}

function PaymentInstructionsForm({
	current,
	currentQrUrl,
	onSave,
}: {
	current:
		| {
				bankName?: string;
				bankAccountName?: string;
				bankAccountNumber?: string;
				qrImageStorageId?: string;
				note?: string;
		  }
		| undefined;
	currentQrUrl: string | undefined;
	onSave: (instructions: PaymentInstructionsDraft) => Promise<unknown>;
}) {
	const generateQrUploadUrl = useMutation(
		api.retailers.generatePaymentQrUploadUrl,
	);

	const [draft, setDraft] = useState<PaymentInstructionsDraft>(() => ({
		bankName: current?.bankName ?? "",
		bankAccountName: current?.bankAccountName ?? "",
		bankAccountNumber: current?.bankAccountNumber ?? "",
		qrImageStorageId: current?.qrImageStorageId ?? "",
		note: current?.note ?? "",
	}));
	// Local preview URL for a freshly uploaded file (object URL). Falls back to
	// the persisted Convex storage URL on initial render.
	const [localPreview, setLocalPreview] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);

	const previewUrl = localPreview ?? currentQrUrl ?? null;

	function setField<K extends keyof PaymentInstructionsDraft>(
		key: K,
		value: PaymentInstructionsDraft[K],
	) {
		setDraft((prev) => ({ ...prev, [key]: value }));
	}

	async function handleQrFile(file: File | null) {
		if (!file) return;
		setUploading(true);
		try {
			const url = await generateQrUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			setField("qrImageStorageId", storageId);
			setLocalPreview(URL.createObjectURL(file));
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	function removeQr() {
		setField("qrImageStorageId", "");
		setLocalPreview(null);
	}

	function clearAll() {
		setDraft(EMPTY_PAYMENT_DRAFT);
		setLocalPreview(null);
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		try {
			await onSave(draft);
			toast.success("Payment details saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<SectionHeading
				title="Payment details"
				description="Shown to shoppers in the WhatsApp confirmation reply after they place an order. Leave any field blank to skip it. Visible only after order — not on your public storefront."
			/>

			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium">Bank name</span>
				<input
					type="text"
					value={draft.bankName}
					onChange={(e) => setField("bankName", e.target.value)}
					placeholder="Maybank"
					maxLength={120}
					className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
			</label>

			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium">Account holder name</span>
				<input
					type="text"
					value={draft.bankAccountName}
					onChange={(e) => setField("bankAccountName", e.target.value)}
					placeholder="Acme Outdoor Sdn Bhd"
					maxLength={120}
					className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
			</label>

			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium">Account number</span>
				<input
					type="text"
					value={draft.bankAccountNumber}
					onChange={(e) => setField("bankAccountNumber", e.target.value)}
					placeholder="5123 4567 8901"
					inputMode="numeric"
					maxLength={120}
					className="min-h-11 rounded-xl border border-input bg-background px-4 font-mono text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
			</label>

			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium">
					Payment QR code (DuitNow / TNG / etc.)
				</span>
				{previewUrl ? (
					<div className="flex flex-col items-start gap-2">
						<img
							src={previewUrl}
							alt="Payment QR"
							className="h-48 w-48 rounded-xl border border-input object-contain"
						/>
						<button
							type="button"
							onClick={removeQr}
							className="text-xs text-destructive underline"
						>
							Remove QR
						</button>
					</div>
				) : (
					<label className="flex h-32 cursor-pointer items-center justify-center rounded-xl border border-dashed border-input bg-background text-sm text-muted-foreground hover:bg-accent/5">
						{uploading ? "Uploading…" : "Tap to upload QR image"}
						<input
							type="file"
							accept="image/*"
							className="hidden"
							onChange={(e) => handleQrFile(e.target.files?.[0] ?? null)}
							disabled={uploading}
						/>
					</label>
				)}
			</div>

			<label className="flex flex-col gap-1">
				<span className="text-sm font-medium">Note to shopper</span>
				<textarea
					value={draft.note}
					onChange={(e) => setField("note", e.target.value)}
					placeholder="Send your payment receipt to our WhatsApp number after transfer."
					rows={3}
					maxLength={500}
					className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
				<span className="text-xs text-muted-foreground">
					{draft.note.length}/500
				</span>
			</label>

			<div className="flex gap-2 lg:justify-end">
				<Button
					type="button"
					variant="outline"
					className="h-11 lg:h-10"
					onClick={clearAll}
				>
					Clear all
				</Button>
				<Button
					type="submit"
					className="h-11 flex-1 lg:h-10 lg:flex-none lg:min-w-[180px]"
					disabled={uploading}
				>
					{uploading ? "Uploading…" : "Save payment details"}
				</Button>
			</div>
		</form>
	);
}

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
	confirm: "Order confirmation",
	packed: "Packed",
	shipped: "Shipped",
	delivered: "Delivered",
	cancelled: "Cancelled",
	unknownFallback: "Unknown message reply",
};

function MessageTemplatesForm({
	current,
	onSave,
}: {
	current: MessageTemplates | undefined;
	onSave: (templates: MessageTemplates) => Promise<unknown>;
}) {
	const [activeLocale, setActiveLocale] = useState<Locale>("en");
	const [draft, setDraft] = useState<MessageTemplates>(() => current ?? {});

	function setField(locale: Locale, key: TemplateKey, value: string) {
		setDraft((prev) => ({
			...prev,
			[locale]: { ...(prev[locale] ?? {}), [key]: value },
		}));
	}

	function resetField(locale: Locale, key: TemplateKey) {
		setDraft((prev) => {
			const next = { ...(prev[locale] ?? {}) };
			delete next[key];
			return { ...prev, [locale]: next };
		});
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		try {
			await onSave(draft);
			toast.success("Templates saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	const locales: Locale[] = ["en", "ms"];

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 className="text-sm font-semibold text-foreground">
					WhatsApp message templates
				</h3>
				<p className="text-xs text-muted-foreground leading-relaxed">
					Override the default copy. Use{" "}
					<code className="font-mono">{"{shortId}"}</code> and{" "}
					<code className="font-mono">{"{storeName}"}</code> as variables. Leave
					blank to use the default.
				</p>
			</div>

			<div className="flex gap-2 border-b border-input">
				{locales.map((loc) => (
					<button
						key={loc}
						type="button"
						onClick={() => setActiveLocale(loc)}
						className={`min-h-11 px-4 text-sm font-medium ${
							activeLocale === loc
								? "border-b-2 border-primary text-primary"
								: "text-muted-foreground"
						}`}
					>
						{loc === "en" ? "English" : "Bahasa Malaysia"}
					</button>
				))}
			</div>

			<div className="flex flex-col gap-4">
				{TEMPLATE_KEYS.map((key) => {
					const value = draft[activeLocale]?.[key] ?? "";
					const placeholder = defaultTemplate(activeLocale, key);
					return (
						<label key={key} className="flex flex-col gap-1">
							<div className="flex items-center justify-between">
								<span className="text-sm font-medium">
									{TEMPLATE_LABELS[key]}
								</span>
								{value ? (
									<button
										type="button"
										onClick={() => resetField(activeLocale, key)}
										className="text-xs text-muted-foreground underline"
									>
										Reset to default
									</button>
								) : null}
							</div>
							<textarea
								value={value}
								onChange={(e) => setField(activeLocale, key, e.target.value)}
								placeholder={placeholder}
								rows={3}
								maxLength={1000}
								className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
							/>
						</label>
					);
				})}
			</div>

			<Button type="submit" className={SAVE_BTN_CLASS}>
				Save templates
			</Button>
		</form>
	);
}

function LocaleForm({
	current,
	onSave,
}: {
	current: "en" | "ms";
	onSave: (locale: "en" | "ms") => Promise<unknown>;
}) {
	const [value, setValue] = useState<"en" | "ms">(current);
	const dirty = value !== current;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		try {
			await onSave(value);
			toast.success("Language saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<label className="flex flex-col gap-2">
				<span className="text-sm font-medium">WhatsApp message language</span>
				<select
					value={value}
					onChange={(e) => setValue(e.target.value as "en" | "ms")}
					className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				>
					{LOCALE_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
				<span className="text-xs text-muted-foreground">
					Used for order confirmations and shipping updates sent to shoppers.
				</span>
			</label>

			<Button type="submit" disabled={!dirty} className={SAVE_BTN_CLASS}>
				Save language
			</Button>
		</form>
	);
}

function CurrencyForm({
	current,
	onSave,
}: {
	current: string;
	onSave: (currency: string) => Promise<unknown>;
}) {
	const form = useAppForm({
		defaultValues: { currency: current },
		onSubmit: async ({ value }) => {
			try {
				await onSave(value.currency);
				toast.success("Currency saved.");
			} catch (err) {
				toast.error(convexErrorMessage(err));
			}
		},
	});

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<form.AppField name="currency">
				{(field) => (
					<field.SelectField
						label="Storefront currency"
						options={CURRENCY_OPTIONS}
						required
						description="Used for new products and order totals. Existing products keep their original currency."
					/>
				)}
			</form.AppField>

			<form.Subscribe
				selector={(s) => ({
					canSubmit: s.canSubmit,
					isSubmitting: s.isSubmitting,
					values: s.values,
				})}
			>
				{({ canSubmit, isSubmitting, values }) => {
					const dirty = values.currency !== current;
					return (
						<Button
							type="submit"
							disabled={!dirty || !canSubmit || isSubmitting}
							className={SAVE_BTN_CLASS}
						>
							{isSubmitting ? "Saving…" : "Save currency"}
						</Button>
					);
				}}
			</form.Subscribe>
		</form>
	);
}

function NotifyEmailForm({
	current,
	onSave,
}: {
	current: string;
	onSave: (notifyEmail: string) => Promise<unknown>;
}) {
	const form = useAppForm({
		defaultValues: { notifyEmail: current },
		validators: { onChange: settingsNotifyEmailFormSchema },
		onSubmit: async ({ value }) => {
			try {
				await onSave(value.notifyEmail.trim());
				toast.success("Notification email saved.");
			} catch (err) {
				toast.error(convexErrorMessage(err));
			}
		},
	});

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<form.AppField name="notifyEmail">
				{(field) => (
					<field.TextField
						label="Notification email"
						placeholder="orders@yourstore.com"
						type="email"
						inputMode="email"
						description="We'll email you here whenever a new order arrives or is confirmed in WhatsApp. Leave blank to turn off email notifications."
					/>
				)}
			</form.AppField>

			<form.Subscribe
				selector={(s) => ({
					canSubmit: s.canSubmit,
					isSubmitting: s.isSubmitting,
					values: s.values,
				})}
			>
				{({ canSubmit, isSubmitting, values }) => {
					const dirty = values.notifyEmail.trim() !== current.trim();
					return (
						<Button
							type="submit"
							disabled={!dirty || !canSubmit || isSubmitting}
							className={SAVE_BTN_CLASS}
						>
							{isSubmitting ? "Saving…" : "Save email"}
						</Button>
					);
				}}
			</form.Subscribe>
		</form>
	);
}

function WaPhoneForm({
	current,
	onSave,
}: {
	current: string;
	onSave: (waPhone: string) => Promise<unknown>;
}) {
	const form = useAppForm({
		defaultValues: { waPhone: current },
		validators: { onChange: settingsWaPhoneFormSchema },
		onSubmit: async ({ value }) => {
			try {
				await onSave(value.waPhone);
				toast.success("WhatsApp number saved.");
			} catch (err) {
				toast.error(convexErrorMessage(err));
			}
		},
	});

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<form.AppField name="waPhone">
				{(field) => (
					<field.TextField
						label="Your contact WhatsApp number"
						placeholder="60123456789"
						type="tel"
						inputMode="tel"
						mono
						required
						description="Country code + number, digits only. Shown to buyers in order confirmations and updates so they can reach you directly."
					/>
				)}
			</form.AppField>

			<form.Subscribe
				selector={(s) => ({
					canSubmit: s.canSubmit,
					isSubmitting: s.isSubmitting,
					values: s.values,
				})}
			>
				{({ canSubmit, isSubmitting, values }) => {
					const dirty = values.waPhone.trim() !== current.trim();
					return (
						<Button
							type="submit"
							disabled={!dirty || !canSubmit || isSubmitting}
							className={SAVE_BTN_CLASS}
						>
							{isSubmitting ? "Saving…" : "Save contact number"}
						</Button>
					);
				}}
			</form.Subscribe>
		</form>
	);
}

function IntegrationCard({
	name,
	description,
	tint,
	icon,
}: {
	name: string;
	description: string;
	tint: string;
	icon: ReactNode;
}) {
	return (
		<Card>
			<div className="flex items-start gap-4">
				<div
					className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tint}`}
				>
					{icon}
				</div>
				<div className="flex flex-1 flex-col gap-1">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold">{name}</h3>
						<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
							Coming soon
						</span>
					</div>
					<p className="text-xs text-muted-foreground">{description}</p>
				</div>
			</div>
			<Button
				disabled
				className="h-11 w-full lg:h-10 lg:w-auto lg:self-end lg:min-w-[160px]"
			>
				Connect {name}
			</Button>
		</Card>
	);
}

function Hint({ state }: { state: ReturnType<typeof useSlugAvailability> }) {
	if (state.status === "idle") return null;
	if (state.status === "checking")
		return <p className="text-sm text-muted-foreground">Checking…</p>;
	if (state.status === "available")
		return <p className="text-sm text-accent">✓ Available</p>;
	if (state.status === "taken")
		return <p className="text-sm text-destructive">✗ Taken</p>;
	return <p className="text-sm text-destructive">✗ {state.message}</p>;
}
