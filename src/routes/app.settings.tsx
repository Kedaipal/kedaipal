import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	ClipboardList,
	CreditCard,
	Info,
	Landmark,
	MapPinned,
	MessageCircle,
	Plus,
	QrCode,
	ReceiptText,
	ShieldCheck,
	Store,
	Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { SUPPORTED_CURRENCIES } from "../../convex/lib/currency";
import { STORE_DESCRIPTION_MAX } from "../../convex/lib/storeProfile";
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
import { TierPill } from "../components/dashboard/tier-pill";
import { submitThenFocusError } from "../components/forms/focus-error";
import { useAppForm } from "../components/forms/form";
import { BillingTab } from "../components/settings/billing-tab";
import { FulfilmentTab } from "../components/settings/fulfilment-tab";
import { NotificationsCard } from "../components/settings/notifications-card";
import { WaOrderAlertsCard } from "../components/settings/wa-order-alerts-card";
import { OnlinePaymentsCard } from "../components/settings/online-payments-card";
import { AppImage } from "../components/ui/app-image";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MyPhonePrefix } from "../components/ui/my-phone-input";
import { Skeleton } from "../components/ui/skeleton";
import { SortableList } from "../components/ui/sortable-list";
import {
	useActAsRetailerId,
	useDashboardRetailer,
} from "../hooks/useDashboardRetailer";
import { useRevealOnAdd } from "../hooks/useRevealOnAdd";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { useUpdateSettings } from "../hooks/useUpdateSettings";
import { convexErrorMessage } from "../lib/format";
import { normalizeMyDigits, toMyNationalInput } from "../lib/phone";
import {
	ANCHOR_UI_LABELS,
	collectStageConfigErrors,
	MAX_ORDER_STAGES,
	type OrderStage,
	resolveStages,
	STAGE_ANCHORS,
	STAGE_DESCRIPTION_MAX_LENGTH,
	STAGE_LABEL_MAX_LENGTH,
	type StageAnchor,
} from "../lib/orderStatus";
import { reorderByIds } from "../lib/reorder";
import {
	settingsNotifyEmailFormSchema,
	settingsWaPhoneFormSchema,
} from "../lib/schemas";
import { hasFeature, tierPill } from "../lib/subscription";

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({
	value: c,
	label: c,
}));

const LOCALE_OPTIONS = [
	{ value: "en", label: "English" },
	{ value: "ms", label: "Bahasa Malaysia" },
	{ value: "zh", label: "中文" },
] as const;

// Shared display label for a locale, used by the language card, the WhatsApp
// template tabs, and the locale-picker `<select>`s below.
const LOCALE_LABELS: Record<Locale, string> = {
	en: "English",
	ms: "Bahasa Malaysia",
	zh: "中文",
};

type SettingsTab =
	| "store"
	| "billing"
	| "whatsapp"
	| "payments"
	| "fulfilment"
	| "order-status";

// Legacy deep-link support: the fulfilment tab used to be "pickup" (self-collect
// only). Old bookmarks / checklist links carry `?tab=pickup` — normalise them so
// they land on the broadened Fulfilment tab instead of falling back to Store.
const LEGACY_TAB_ALIASES: Record<string, SettingsTab> = {
	pickup: "fulfilment",
};

const SETTINGS_TABS: ReadonlyArray<{
	id: SettingsTab;
	label: string;
	description: string;
	icon: ReactNode;
}> = [
	{
		id: "store",
		label: "Store",
		description: "Name, logo, URL and currency",
		icon: <Store className="size-4" />,
	},
	{
		id: "billing",
		label: "Billing",
		description: "Your Kedaipal subscription + invoices",
		icon: <ReceiptText className="size-4" />,
	},
	{
		id: "whatsapp",
		label: "WhatsApp",
		description: "Contact number and messages",
		icon: <MessageCircle className="size-4" />,
	},
	{
		id: "payments",
		label: "Payments",
		description: "Bank accounts, QR codes & online payments",
		icon: <CreditCard className="size-4" />,
	},
	// One home for "how buyers get their order" — delivery + self-collect toggles
	// and the pickup-location library all live here.
	{
		id: "fulfilment",
		label: "Fulfilment",
		description: "Delivery & self-collect options",
		icon: <MapPinned className="size-4" />,
	},
	{
		id: "order-status",
		label: "Order status",
		description: "Buyer-facing order stages",
		icon: <ClipboardList className="size-4" />,
	},
];

const SETTINGS_TAB_IDS: ReadonlyArray<SettingsTab> = SETTINGS_TABS.map(
	(t) => t.id,
);

// The mobile index groups sections by meaning: your store's identity/account
// vs how you sell. Desktop keeps the flat tab grid (all destinations visible).
const SETTINGS_GROUPS: ReadonlyArray<{
	label: string;
	tabs: SettingsTab[];
}> = [
	{ label: "Store", tabs: ["store", "billing"] },
	{
		label: "Selling",
		tabs: ["whatsapp", "payments", "fulfilment", "order-status"],
	},
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
	// `tab` stays optional: no tab = the grouped index on mobile (desktop falls
	// back to Store). Deep links (?tab=billing etc.) keep working everywhere.
	validateSearch: (search: Record<string, unknown>) => {
		const raw =
			typeof search.tab === "string"
				? (LEGACY_TAB_ALIASES[search.tab] ?? search.tab)
				: search.tab;
		return {
			tab: SETTINGS_TAB_IDS.includes(raw as SettingsTab)
				? (raw as SettingsTab)
				: undefined,
		};
	},
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
	const actAsRetailerId = useActAsRetailerId();
	const retailer = useDashboardRetailer();
	// Admins get an "Admin" group on the mobile settings index — the natural home
	// for the console entry (the desktop sidebar already carries an Admin group).
	const isAdmin = useQuery(api.billing.amIAdmin) ?? false;
	// A Kedaipal admin on their OWN store reads "Admin" on the tier pill + billing
	// row (never a trial/plan countdown) — same treatment as the sidebar/header.
	// While acting-as a seller we keep the seller's real subscription state visible.
	const adminOwnStore = isAdmin && retailer?.actingAsAdmin !== true;
	const renameSlugMutation = useMutation(api.retailers.renameSlug);
	// In admin act-as, inject the seller's `retailerId` so edits land on THEIR
	// store, not the admin's own (both mutations resolve by identity when it's
	// omitted). Settings writes share the act-as-aware hook (also used by the
	// extracted tab components); renameSlug is wrapped locally the same way.
	const renameSlug = useCallback(
		(args: { newSlug: string }) =>
			renameSlugMutation({ ...args, retailerId: actAsRetailerId }),
		[renameSlugMutation, actAsRetailerId],
	);
	const updateSettings = useUpdateSettings();

	// URL is the source of truth for the active tab, so deep links (e.g. the
	// "View billing" banner → ?tab=billing) actually switch the tab even when the
	// settings page is already mounted. No tab at all = the grouped index on
	// mobile; desktop always shows a section (defaulting to Store).
	const { tab } = Route.useSearch();
	const activeTab: SettingsTab = tab ?? "store";
	const navigate = Route.useNavigate();
	const setActiveTab = (t: SettingsTab) => navigate({ search: { tab: t } });
	const backToIndex = () => navigate({ search: { tab: undefined } });
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
					<Input
						type="text"
						value={newSlug}
						onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
						placeholder="new-slug"
						variant="bare"
						className="min-h-11 flex-1 pr-4 font-mono text-base"
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
			{/* ---- Mobile: grouped list index (no tab in the URL) ---------------
			     A 7-tab horizontal scroller hides most destinations on a phone; a
			     grouped list shows all of them with descriptions + status glances.
			     Every row keeps the same ?tab= deep link the rest of the app uses. */}
			{tab === undefined ? (
				<div className="flex flex-col gap-4 lg:hidden">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Settings
					</h2>

					{/* Store identity card — doubles as the deep link + tier badge. */}
					<div className="flex items-center gap-3 rounded-2xl bg-foreground p-3.5 text-background">
						<span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent font-heading text-base font-extrabold text-accent-foreground">
							<AppImage
								src={retailer.logoUrl}
								alt=""
								aspect="size-full"
								fallback={
									<span className="flex h-full w-full items-center justify-center">
										{retailer.storeName.charAt(0).toUpperCase()}
									</span>
								}
							/>
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="truncate text-[15px] font-bold">
								{retailer.storeName}
							</span>
							<span className="truncate font-mono text-xs text-accent">
								kedaipal.com/{retailer.slug}
							</span>
						</div>
						<TierPill
							subscription={retailer.subscription}
							foundingRank={retailer.foundingMemberRank}
							admin={adminOwnStore}
							compact
							className="shrink-0"
						/>
					</div>

					{SETTINGS_GROUPS.map((group) => (
						<div key={group.label} className="flex flex-col gap-1.5">
							<span className="pl-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
								{group.label}
							</span>
							<div className="overflow-hidden rounded-2xl border border-border bg-card">
								{group.tabs.map((id, i) => {
									const t = SETTINGS_TABS.find((x) => x.id === id);
									if (!t) return null;
									// Status at a glance where we have live state — no tap
									// needed to check health.
									const subtitle =
										t.id === "billing" && retailer.subscription
											? tierPill(
													retailer.subscription,
													Date.now(),
													// Keep the plain tier label here (founding rank stays
													// on the header pill only); just fold in the admin case.
													undefined,
													adminOwnStore,
												).label
											: t.description;
									const waConnected =
										t.id === "whatsapp" && Boolean(retailer.waPhone?.trim());
									return (
										<button
											key={t.id}
											type="button"
											onClick={() => setActiveTab(t.id)}
											className={`flex min-h-[60px] w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 ${
												i > 0 ? "border-t border-border/60" : ""
											}`}
										>
											<span
												className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${
													waConnected
														? "bg-accent/15 text-accent-emphasis"
														: "bg-muted text-foreground"
												}`}
											>
												{t.icon}
											</span>
											<span className="flex min-w-0 flex-1 flex-col">
												<span className="text-sm font-semibold">{t.label}</span>
												<span className="truncate text-xs text-muted-foreground">
													{subtitle}
												</span>
											</span>
											{waConnected ? (
												<span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent-emphasis">
													Connected
												</span>
											) : (
												<ChevronRight
													className="size-4 shrink-0 text-muted-foreground/50"
													aria-hidden="true"
												/>
											)}
										</button>
									);
								})}
							</div>
						</div>
					))}

					{/* Kedaipal admins: the console entry lives here on mobile (desktop
					    has the sidebar Admin group). Once inside /app/admin/*, the
					    bottom nav swaps to the admin tabs, which lead with an "App"
					    tab back to this store. See docs/admin-console.md. */}
					{isAdmin ? (
						<div className="flex flex-col gap-1.5">
							<span className="pl-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
								Admin
							</span>
							<div className="overflow-hidden rounded-2xl border border-border bg-card">
								<Link
									to="/app/admin/sellers"
									className="flex min-h-[60px] w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50"
								>
									<span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
										<ShieldCheck className="size-4.5" aria-hidden="true" />
									</span>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="text-sm font-semibold">Admin console</span>
										<span className="truncate text-xs text-muted-foreground">
											All sellers, billing &amp; WABA safety
										</span>
									</span>
									<ChevronRight
										className="size-4 shrink-0 text-muted-foreground/50"
										aria-hidden="true"
									/>
								</Link>
							</div>
						</div>
					) : null}
				</div>
			) : (
				/* ---- Mobile: section view (tab set) — back to the index. */
				<div className="flex items-center gap-3 lg:hidden">
					<button
						type="button"
						onClick={backToIndex}
						aria-label="Back to settings"
						className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
					>
						<ArrowLeft className="size-5" />
					</button>
					<h2 className="min-w-0 flex-1 truncate font-heading text-lg font-extrabold leading-tight">
						{SETTINGS_TABS.find((t) => t.id === activeTab)?.label}
					</h2>
				</div>
			)}

			{/* ---- Desktop: flat tab grid (all destinations visible at once). */}
			<div className="hidden gap-2 lg:grid lg:grid-cols-3">
				{SETTINGS_TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setActiveTab(t.id)}
						className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
							activeTab === t.id
								? "border-accent bg-accent/10 text-foreground shadow-sm"
								: "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground"
						}`}
					>
						<span
							className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${
								activeTab === t.id
									? "bg-accent text-accent-foreground"
									: "bg-muted text-muted-foreground"
							}`}
						>
							{t.icon}
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-semibold leading-tight">
								{t.label}
							</span>
							<span className="mt-0.5 hidden text-xs leading-snug text-muted-foreground sm:block">
								{t.description}
							</span>
						</span>
					</button>
				))}
			</div>

			{/* Section content — hidden on mobile while the index is showing
			    (desktop always renders the active section, defaulting to Store). */}
			<div
				className={
					tab === undefined ? "hidden lg:flex lg:flex-col lg:gap-6" : "contents"
				}
			>
				{activeTab === "store" ? (
					<div className="flex flex-col gap-6 pt-2">
						<Card>
							<StoreNameForm
								current={retailer.storeName}
								onSave={(storeName) => updateSettings({ storeName })}
							/>
						</Card>
						<Card>
							<NotificationsCard />
						</Card>
						{/* Notification surfaces live together: browser (above), WhatsApp,
						    email (below). The WA card only mounts when the deployment has
						    an approved seller template configured (86eyhw9zy). */}
						{retailer.waOrderAlertsAvailable ? (
							<Card>
								<WaOrderAlertsCard
									enabled={retailer.orderWaAlerts === true}
									currentPhone={retailer.notifyWaPhone ?? ""}
									fallbackPhone={retailer.waPhone ?? ""}
									optedOut={retailer.notifyWaPhoneOptedOut === true}
									canUse={hasFeature(retailer.subscription, "waOrderAlerts")}
									onSave={(patch) => updateSettings(patch)}
								/>
							</Card>
						) : null}
						<Card>
							<NotifyEmailForm
								current={retailer.notifyEmail ?? ""}
								onSave={(notifyEmail) => updateSettings({ notifyEmail })}
							/>
						</Card>
						<Card>
							<StoreDescriptionForm
								current={retailer.storeDescription ?? ""}
								onSave={(storeDescription) =>
									updateSettings({ storeDescription })
								}
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
							<CoverImageForm
								currentCoverUrl={retailer.coverImageUrl}
								onSave={(coverImageStorageId) =>
									updateSettings({ coverImageStorageId })
								}
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

				{activeTab === "billing" ? <BillingTab retailer={retailer} /> : null}

				{activeTab === "whatsapp" ? (
					<div className="flex flex-col gap-6 pt-2">
						<InfoBanner title="How WhatsApp works on Kedaipal">
							<p>
								Every order sends the buyer{" "}
								<span className="font-medium text-foreground">
									one WhatsApp message
								</span>{" "}
								— the confirmation — from{" "}
								<span className="font-medium text-foreground">
									Kedaipal's shared WhatsApp Business number
								</span>{" "}
								on your behalf, no Meta account needed.
							</p>
							<p>
								That message links to the buyer's own order page, which updates
								itself. Packing, shipping, payment and cancellation no longer
								send a WhatsApp — the buyer sees them on that page.
							</p>
							<p>
								Add your personal WhatsApp number below so buyers can reach you
								directly. It appears as a tappable contact link on their order
								page.
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
							<PaymentMethodsForm
								current={retailer.paymentMethods ?? []}
								onSave={(paymentMethods) => updateSettings({ paymentMethods })}
							/>
						</Card>
						<Card>
							<OnlinePaymentsCard
								hitpay={retailer.hitpay}
								canUse={hasFeature(retailer.subscription, "onlinePayments")}
								onSave={(patch) => updateSettings(patch)}
							/>
						</Card>
						{/* Says plainly that nothing chases the buyer automatically, and
						    names the one manual tool that exists — so the behaviour is
						    discoverable without a seller assuming a nudge went out that
						    didn't (docs/payment-reminder.md). */}
						<p className="px-1 text-xs text-muted-foreground">
							Kedaipal doesn't chase unpaid orders automatically. Each order
							gets one WhatsApp — the confirmation — and it links the buyer to
							their order page, where these payment details and the “I've
							paid” button live. If an order is still unpaid on day 11, a
							“Send payment reminder” button appears on its order page (once
							per day, until day 14) — sending it is always your call.
						</p>
					</div>
				) : null}

				{activeTab === "fulfilment" ? (
					<FulfilmentTab
						retailerId={retailer._id}
						offerSelfCollect={retailer.offerSelfCollect ?? false}
						offerDelivery={retailer.offerDelivery ?? true}
						deliveryConfig={retailer.deliveryConfig}
						businessAddress={retailer.businessAddress}
						deliveryBooking={retailer.deliveryBooking}
						minFulfilmentNoticeDays={retailer.minFulfilmentNoticeDays}
						minOrderValue={retailer.minOrderValue}
						subscription={retailer.subscription}
					/>
				) : null}

				{activeTab === "order-status" ? (
					<div className="flex flex-col gap-6 pt-2">
						<InfoBanner title="How order stages work">
							<p>
								Build the steps your orders move through — name them however you
								work. Buyers see them as a live timeline; you advance orders
								step-by-step from the dashboard.
							</p>
							<p>
								Every step maps to one of four built-in milestones via{" "}
								<span className="font-medium text-foreground">“Counts as”</span>
								, so payments, packing and tracking keep working:{" "}
								<span className="font-medium text-foreground">Accepted</span> →{" "}
								<span className="font-medium text-foreground">
									In production
								</span>{" "}
								→ <span className="font-medium text-foreground">Ready</span> →{" "}
								<span className="font-medium text-foreground">Done</span>.
							</p>
							<p>
								<span className="font-medium text-foreground">
									Your first step should count as “Accepted”, your last as
									“Done”
								</span>{" "}
								— map the steps in between to whichever milestone fits. E.g. a
								cake shop: “Order received” (Accepted) → “Baking” (In
								production) → “Ready for pickup” (Ready) → “Collected” (Done).
							</p>
						</InfoBanner>

						<Card>
							<StageEditor
								seed={resolveStages({
									orderStages: retailer.orderStages,
									labels: retailer.statusLabels,
									deliveryMethod: retailer.offerSelfCollect
										? "self_collect"
										: "delivery",
								})}
								isCustomized={Boolean(retailer.orderStages?.length)}
								onSave={(orderStages) => updateSettings({ orderStages })}
							/>
						</Card>
					</div>
				) : null}
			</div>
		</div>
	);
}

// One editable payment method in the settings form. `qrPreviewUrl` is the
// resolved (or freshly-uploaded object) URL for display only — not persisted.
type MethodDraft = {
	// Stable React key so reordering doesn't remount inputs / lose focus.
	_key: string;
	type: "bank" | "qr";
	label: string;
	bankName: string;
	bankAccountName: string;
	bankAccountNumber: string;
	qrImageStorageId: string;
	qrPreviewUrl?: string;
	note: string;
};

const MAX_METHODS = 8;

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
				<Input
					type="text"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="Your Store Name"
					maxLength={80}
					variant="field"
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

function StoreDescriptionForm({
	current,
	onSave,
}: {
	current: string;
	onSave: (storeDescription: string) => Promise<unknown>;
}) {
	const [value, setValue] = useState(current);
	const [saving, setSaving] = useState(false);
	// Trim for comparison so whitespace-only edits aren't "dirty", but allow
	// clearing a previously-set description (going to empty).
	const dirty = value.trim() !== current.trim();

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!dirty) return;
		setSaving(true);
		try {
			await onSave(value.trim());
			toast.success(
				value.trim().length > 0
					? "Store description updated."
					: "Store description cleared.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<SectionHeading
				title="Store description"
				description="A short line shown on your storefront under your store name — say what you sell, your lead time, or area. Leave blank to hide it."
			/>
			<div className="flex flex-col gap-1.5">
				<textarea
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="e.g. Home-based frozen food, Semenyih — DM for bulk orders"
					rows={2}
					maxLength={STORE_DESCRIPTION_MAX}
					className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
				<span className="self-end text-xs text-muted-foreground tabular-nums">
					{value.length}/{STORE_DESCRIPTION_MAX}
				</span>
			</div>
			<Button
				type="submit"
				disabled={!dirty || saving}
				className={SAVE_BTN_CLASS}
			>
				{saving ? "Saving…" : "Save description"}
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
					<AppImage
						src={previewUrl}
						alt="Store logo"
						aspect="h-24 w-24"
						rounded="rounded-2xl"
						objectFit="contain"
						className="border border-input bg-background"
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

function CoverImageForm({
	currentCoverUrl,
	onSave,
}: {
	currentCoverUrl: string | undefined;
	onSave: (coverImageStorageId: string) => Promise<unknown>;
}) {
	const generateCoverImageUploadUrl = useMutation(
		api.retailers.generateCoverImageUploadUrl,
	);
	const [localPreview, setLocalPreview] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);

	const previewUrl = localPreview ?? currentCoverUrl ?? null;

	async function handleFile(file: File | null) {
		if (!file) return;
		setUploading(true);
		try {
			const url = await generateCoverImageUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			setLocalPreview(URL.createObjectURL(file));
			await onSave(storageId);
			toast.success("Cover image saved.");
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
			toast.success("Cover image removed.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Cover image"
				description="Best size 1200 × 400 px (wide 3:1). Fills your storefront header and shows as the preview when you share your link. Max ~2MB."
			/>

			{previewUrl ? (
				<div className="flex flex-col gap-3">
					<AppImage
						src={previewUrl}
						alt="Store cover"
						aspect="aspect-[3/1] w-full"
						rounded="rounded-2xl"
						className="border border-input bg-muted"
					/>
					<div className="flex items-center gap-3">
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
							Remove cover
						</button>
					</div>
				</div>
			) : (
				<label className="flex aspect-[3/1] w-full cursor-pointer items-center justify-center rounded-2xl border border-dashed border-input bg-background text-sm text-muted-foreground hover:bg-accent/5">
					{uploading ? "Uploading…" : "Tap to upload a cover image"}
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

type PaymentMethodWire = {
	type: "bank" | "qr";
	label: string;
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	qrImageStorageId?: string;
	note?: string;
	sortOrder: number;
};

function newDraft(type: "bank" | "qr"): MethodDraft {
	return {
		_key: crypto.randomUUID(),
		type,
		label: "",
		bankName: "",
		bankAccountName: "",
		bankAccountNumber: "",
		qrImageStorageId: "",
		qrPreviewUrl: undefined,
		note: "",
	};
}

function PaymentMethodsForm({
	current,
	onSave,
}: {
	current: Array<{
		type: "bank" | "qr";
		label: string;
		bankName?: string;
		bankAccountName?: string;
		bankAccountNumber?: string;
		qrImageStorageId?: string;
		qrImageUrl?: string;
		note?: string;
	}>;
	onSave: (methods: PaymentMethodWire[]) => Promise<unknown>;
}) {
	const generateQrUploadUrl = useMutation(
		api.retailers.generatePaymentQrUploadUrl,
	);

	// Methods are kept grouped (all banks, then all QRs) so the array order ==
	// the order buyers see them in on their order page's "How to pay" section.
	// Sorting is therefore within a type only.
	const [methods, setMethods] = useState<MethodDraft[]>(() => {
		const seeded = current.map((m) => ({
			_key: crypto.randomUUID(),
			type: m.type,
			label: m.label,
			bankName: m.bankName ?? "",
			bankAccountName: m.bankAccountName ?? "",
			bankAccountNumber: m.bankAccountNumber ?? "",
			qrImageStorageId: m.qrImageStorageId ?? "",
			qrPreviewUrl: m.qrImageUrl,
			note: m.note ?? "",
		}));
		return [
			...seeded.filter((m) => m.type === "bank"),
			...seeded.filter((m) => m.type === "qr"),
		];
	});
	const [uploadingKey, setUploadingKey] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const { markAdded, revealRef } = useRevealOnAdd();

	const banks = methods.filter((m) => m.type === "bank");
	const qrs = methods.filter((m) => m.type === "qr");

	function toggleExpand(key: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}
	function update(key: string, patch: Partial<MethodDraft>) {
		setMethods((prev) =>
			prev.map((m) => (m._key === key ? { ...m, ...patch } : m)),
		);
	}
	function removeMethod(key: string) {
		setMethods((prev) => prev.filter((m) => m._key !== key));
		setExpanded((prev) => {
			const next = new Set(prev);
			next.delete(key);
			return next;
		});
	}
	function addMethod(type: "bank" | "qr") {
		if (methods.length >= MAX_METHODS) {
			toast.error(`You can add at most ${MAX_METHODS} payment methods`);
			return;
		}
		const draft = newDraft(type);
		setExpanded((prev) => new Set(prev).add(draft._key));
		markAdded(draft._key);
		setMethods((prev) => {
			const b = prev.filter((m) => m.type === "bank");
			const q = prev.filter((m) => m.type === "qr");
			// New bank slots at the end of the bank group; new QR at the very end.
			return type === "bank" ? [...b, draft, ...q] : [...b, ...q, draft];
		});
	}
	// Reorder within a single type, preserving the other group + the grouping.
	function reorderType(type: "bank" | "qr", orderedKeys: string[]) {
		setMethods((prev) => {
			const b = prev.filter((m) => m.type === "bank");
			const q = prev.filter((m) => m.type === "qr");
			const reorder = (list: MethodDraft[]) =>
				reorderByIds(list, orderedKeys, (m) => m._key);
			return type === "bank" ? [...reorder(b), ...q] : [...b, ...reorder(q)];
		});
	}

	async function handleQrFile(key: string, file: File | null) {
		if (!file) return;
		setUploadingKey(key);
		try {
			const url = await generateQrUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			update(key, {
				qrImageStorageId: storageId,
				qrPreviewUrl: URL.createObjectURL(file),
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploadingKey(null);
		}
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			// `methods` is already banks-then-QRs, so index === sortOrder.
			const wire: PaymentMethodWire[] = methods.map((m, i) => {
				const label =
					m.label.trim() ||
					(m.type === "qr" ? "QR code" : m.bankName.trim() || "Bank transfer");
				return {
					type: m.type,
					label,
					bankName:
						m.type === "bank" ? m.bankName.trim() || undefined : undefined,
					bankAccountName:
						m.type === "bank"
							? m.bankAccountName.trim() || undefined
							: undefined,
					bankAccountNumber:
						m.type === "bank"
							? m.bankAccountNumber.trim() || undefined
							: undefined,
					qrImageStorageId:
						m.type === "qr" ? m.qrImageStorageId || undefined : undefined,
					note: m.note.trim() || undefined,
					sortOrder: i,
				};
			});
			await onSave(wire);
			toast.success("Payment methods saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	// One method's editable card. `handle` is the drag grip from SortableList.
	// While a drag is in progress (`state.isSorting`), the whole group collapses
	// to single-line rows (just the label) so a tall list is easy to rearrange;
	// the floating overlay copy (`state.isOverlay`) gets a lifted shadow.
	function methodCard(
		m: MethodDraft,
		handle: ReactNode,
		state: { isSorting: boolean; isOverlay: boolean },
	) {
		const displayLabel =
			m.label.trim() ||
			(m.type === "bank" ? m.bankName.trim() || "Bank account" : "QR code");
		const MethodIcon = m.type === "bank" ? Landmark : QrCode;
		if (state.isSorting) {
			return (
				<div
					className={`flex items-center gap-2 rounded-xl border bg-card p-3 ${
						state.isOverlay ? "border-accent shadow-lg" : "border-border"
					}`}
				>
					{handle}
					<MethodIcon className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate text-sm font-medium">{displayLabel}</span>
				</div>
			);
		}
		const isExpanded = expanded.has(m._key);
		if (!isExpanded) {
			return (
				<div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
					{handle}
					<button
						type="button"
						onClick={() => toggleExpand(m._key)}
						aria-expanded={false}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<MethodIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-sm font-medium">
							{displayLabel}
						</span>
						<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{m.type === "bank" ? "Bank" : "QR"}
						</span>
						<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
					</button>
				</div>
			);
		}
		return (
			<div
				ref={revealRef(m._key)}
				className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
			>
				<div className="flex items-center gap-2">
					{handle}
					<button
						type="button"
						onClick={() => toggleExpand(m._key)}
						aria-expanded={true}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<MethodIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-sm font-medium">
							{displayLabel}
						</span>
						<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{m.type === "bank" ? "Bank" : "QR"}
						</span>
						<ChevronDown className="size-4 shrink-0 rotate-180 text-muted-foreground" />
					</button>
				</div>

				<label className="flex flex-col gap-1">
					<span className="text-sm font-medium">Label</span>
					<Input
						type="text"
						value={m.label}
						onChange={(e) => update(m._key, { label: e.target.value })}
						placeholder={m.type === "bank" ? "Maybank" : "DuitNow QR"}
						maxLength={60}
						variant="field"
					/>
				</label>

				{m.type === "bank" ? (
					<>
						<label className="flex flex-col gap-1">
							<span className="text-sm font-medium">Bank name</span>
							<Input
								type="text"
								value={m.bankName}
								onChange={(e) => update(m._key, { bankName: e.target.value })}
								placeholder="Maybank"
								maxLength={120}
								variant="field"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-sm font-medium">Account holder name</span>
							<Input
								type="text"
								value={m.bankAccountName}
								onChange={(e) =>
									update(m._key, { bankAccountName: e.target.value })
								}
								placeholder="Your Business Sdn Bhd"
								maxLength={120}
								variant="field"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-sm font-medium">Account number</span>
							<Input
								type="text"
								value={m.bankAccountNumber}
								onChange={(e) =>
									update(m._key, { bankAccountNumber: e.target.value })
								}
								placeholder="5123 4567 8901"
								inputMode="numeric"
								maxLength={120}
								variant="field"
								className="font-mono"
							/>
						</label>
					</>
				) : (
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">QR image</span>
						{m.qrPreviewUrl ? (
							<div className="flex flex-col items-start gap-2">
								<AppImage
									src={m.qrPreviewUrl}
									alt="Payment QR"
									aspect="h-44 w-44"
									rounded="rounded-xl"
									objectFit="contain"
									className="border border-input"
								/>
								<button
									type="button"
									onClick={() =>
										update(m._key, {
											qrImageStorageId: "",
											qrPreviewUrl: undefined,
										})
									}
									className="text-xs text-destructive underline"
								>
									Remove QR
								</button>
							</div>
						) : (
							<label className="flex h-28 cursor-pointer items-center justify-center rounded-xl border border-dashed border-input bg-background text-sm text-muted-foreground hover:bg-accent/5">
								{uploadingKey === m._key
									? "Uploading…"
									: "Tap to upload QR image"}
								<input
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) =>
										handleQrFile(m._key, e.target.files?.[0] ?? null)
									}
									disabled={uploadingKey === m._key}
								/>
							</label>
						)}
					</div>
				)}

				<label className="flex flex-col gap-1">
					<span className="text-sm font-medium">Note (optional)</span>
					<textarea
						value={m.note}
						onChange={(e) => update(m._key, { note: e.target.value })}
						placeholder="e.g. Send your receipt after transfer."
						rows={2}
						maxLength={500}
						className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
					/>
				</label>

				<button
					type="button"
					onClick={() => removeMethod(m._key)}
					className="flex h-9 items-center gap-1.5 self-start rounded-lg px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
				>
					<Trash2 className="size-3.5" />
					Remove payment method
				</button>
			</div>
		);
	}

	const atCap = methods.length >= MAX_METHODS;

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-6">
			<SectionHeading
				title="Payment methods"
				description="Add your banks and QR codes. For your buyers' security, these are no longer pasted into the WhatsApp chat — instead the order confirmation links each buyer to their own order page, where all of them show with one-tap copy. Never shown on your public storefront. Drag the handle to reorder within each group."
			/>

			{/* Bank accounts — shown on the buyer's order page (linked from WhatsApp). */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-2">
					<span className="inline-flex items-center gap-1.5 text-sm font-semibold">
						<Landmark className="size-4" />
						Bank accounts
					</span>
					<Button
						type="button"
						variant="outline"
						className="h-9"
						onClick={() => addMethod("bank")}
						disabled={atCap}
					>
						<Plus className="size-4" />
						Add bank
					</Button>
				</div>
				{banks.length === 0 ? (
					<p className="rounded-xl border border-dashed border-input bg-muted/20 px-4 py-4 text-center text-sm text-muted-foreground">
						No bank accounts yet.
					</p>
				) : (
					<SortableList
						items={banks}
						getId={(m) => m._key}
						onReorder={(ids) => reorderType("bank", ids)}
						renderItem={(m, handle, state) => methodCard(m, handle, state)}
						className="flex flex-col gap-3"
					/>
				)}
			</div>

			{/* QR codes — shown on the buyer's order page (linked from WhatsApp). */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-2">
					<span className="inline-flex items-center gap-1.5 text-sm font-semibold">
						<QrCode className="size-4" />
						QR codes
					</span>
					<Button
						type="button"
						variant="outline"
						className="h-9"
						onClick={() => addMethod("qr")}
						disabled={atCap}
					>
						<Plus className="size-4" />
						Add QR
					</Button>
				</div>
				{qrs.length === 0 ? (
					<p className="rounded-xl border border-dashed border-input bg-muted/20 px-4 py-4 text-center text-sm text-muted-foreground">
						No QR codes yet.
					</p>
				) : (
					<SortableList
						items={qrs}
						getId={(m) => m._key}
						onReorder={(ids) => reorderType("qr", ids)}
						renderItem={(m, handle, state) => methodCard(m, handle, state)}
						className="flex flex-col gap-3"
					/>
				)}
			</div>

			<Button
				type="submit"
				className="h-11 lg:h-10 lg:self-end lg:min-w-[180px]"
				disabled={saving || uploadingKey !== null}
			>
				{uploadingKey !== null
					? "Uploading…"
					: saving
						? "Saving…"
						: "Save payment methods"}
			</Button>
		</form>
	);
}

// Only the keys still in TEMPLATE_KEYS are editable — the status/fallback copy
// no longer has a sender, so it has no label here either. Partial + fallback so
// a key added back to TEMPLATE_KEYS renders instead of crashing.
const TEMPLATE_LABELS: Partial<Record<TemplateKey, string>> = {
	confirm: "Your reply",
};

// The card earns its place on one narrow job: a buyer who types their order
// number into the shared number gets this reply. The order's own confirmation is
// a fixed Meta template and is NOT editable here — if TEMPLATE_KEYS ever empties
// out, delete this card rather than shipping an editor that changes nothing.
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

	const locales: Locale[] = ["en", "ms", "zh"];

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 className="text-sm font-semibold text-foreground">
					Reply when a buyer messages their order number
				</h3>
				<p className="text-xs text-muted-foreground leading-relaxed">
					The confirmation your buyers receive is a fixed Meta-approved template
					— WhatsApp's rule for messaging someone who hasn't replied yet — so it
					can't be customised. This copy is the reply sent when a buyer writes
					their order number (e.g.{" "}
					<code className="font-mono">ORD-1234</code>) to our shared number. Use{" "}
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
						{LOCALE_LABELS[loc]}
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
									{TEMPLATE_LABELS[key] ?? key}
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

// One editable stage in the StageEditor. `_key` is a stable React key so drag
// reordering doesn't remount inputs; `id` is the server id ("" = new stage).
type StageDraft = {
	_key: string;
	id: string;
	anchor: StageAnchor;
	labelEn: string;
	labelMs: string;
	labelZh: string;
	descEn: string;
	descMs: string;
	descZh: string;
};

function seedToDraft(s: OrderStage): StageDraft {
	return {
		_key: crypto.randomUUID(),
		// Synthesized defaults ("default:<anchor>") aren't real ids — saving turns
		// them into configured stages with fresh ids.
		id: s.id.startsWith("default:") ? "" : s.id,
		anchor: s.anchor,
		labelEn: s.label.en,
		labelMs: s.label.ms ?? "",
		labelZh: s.label.zh ?? "",
		descEn: s.description?.en ?? "",
		descMs: s.description?.ms ?? "",
		descZh: s.description?.zh ?? "",
	};
}

// Map drafts to the wire/validation shape (stable id for dup-checking).
function draftsToStages(drafts: StageDraft[]): OrderStage[] {
	return drafts.map((d, i) => ({
		id: d.id || d._key,
		anchor: d.anchor,
		label: {
			en: d.labelEn.trim(),
			...(d.labelMs.trim() ? { ms: d.labelMs.trim() } : {}),
			...(d.labelZh.trim() ? { zh: d.labelZh.trim() } : {}),
		},
		...(d.descEn.trim() || d.descMs.trim() || d.descZh.trim()
			? {
					description: {
						...(d.descEn.trim() ? { en: d.descEn.trim() } : {}),
						...(d.descMs.trim() ? { ms: d.descMs.trim() } : {}),
						...(d.descZh.trim() ? { zh: d.descZh.trim() } : {}),
					},
				}
			: {}),
		sortOrder: i,
	}));
}

function StageEditor({
	seed,
	isCustomized,
	onSave,
}: {
	seed: OrderStage[];
	isCustomized: boolean;
	onSave: (stages: OrderStage[]) => Promise<unknown>;
}) {
	const [drafts, setDrafts] = useState<StageDraft[]>(() =>
		seed.map(seedToDraft),
	);
	const [saving, setSaving] = useState(false);
	// Cards collapse to a one-line summary by default (a full stage card is tall on
	// mobile, so the page reads better at a glance). Click a card to expand it.
	// During a drag the row always renders compact (state.isSorting), and the
	// expanded set is preserved so cards re-open exactly as they were afterwards.
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const { markAdded, revealRef } = useRevealOnAdd();
	function toggleExpand(key: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	function update(key: string, patch: Partial<StageDraft>) {
		setDrafts((prev) =>
			prev.map((d) => (d._key === key ? { ...d, ...patch } : d)),
		);
	}
	function remove(key: string) {
		setDrafts((prev) => prev.filter((d) => d._key !== key));
	}
	function addStage() {
		if (drafts.length >= MAX_ORDER_STAGES) {
			toast.error(`You can have at most ${MAX_ORDER_STAGES} stages.`);
			return;
		}
		const key = crypto.randomUUID();
		// Open the new (empty) stage so the seller can fill it in immediately, and
		// reveal it (scroll + focus) — it appends below the fold on a phone.
		setExpanded((prev) => new Set(prev).add(key));
		markAdded(key);
		setDrafts((prev) => [
			...prev,
			{
				_key: key,
				id: "",
				// Default to the last stage's anchor so the monotonic rule holds and
				// the seller usually doesn't need to touch the dropdown.
				anchor: prev[prev.length - 1]?.anchor ?? "confirmed",
				labelEn: "",
				labelMs: "",
				labelZh: "",
				descEn: "",
				descMs: "",
				descZh: "",
			},
		]);
	}

	const errors = collectStageConfigErrors(draftsToStages(drafts));
	const canSave = drafts.length > 0 && errors.length === 0 && !saving;

	async function handleSave() {
		setSaving(true);
		try {
			await onSave(draftsToStages(drafts));
			toast.success("Order stages saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		setSaving(true);
		try {
			await onSave([]); // empty → server clears → synthesized defaults
			toast.success("Reset to the default stages.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function stageCard(
		d: StageDraft,
		index: number,
		handle: ReactNode,
		state: { isSorting: boolean; isOverlay: boolean },
	) {
		const displayLabel = d.labelEn.trim() || `Stage ${index + 1}`;
		if (state.isSorting) {
			return (
				<div
					className={`flex items-center gap-2 rounded-xl border bg-card p-3 ${
						state.isOverlay ? "border-accent shadow-lg" : "border-border"
					}`}
				>
					{handle}
					<span className="truncate text-sm font-medium">{displayLabel}</span>
					<span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						{ANCHOR_UI_LABELS[d.anchor]}
					</span>
				</div>
			);
		}

		const isExpanded = expanded.has(d._key);
		if (!isExpanded) {
			// Collapsed-by-default summary — same info as the drag row; click to open.
			return (
				<div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
					{handle}
					<button
						type="button"
						onClick={() => toggleExpand(d._key)}
						aria-expanded={false}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<span className="truncate text-sm font-medium">{displayLabel}</span>
						<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{ANCHOR_UI_LABELS[d.anchor]}
						</span>
						<ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
					</button>
				</div>
			);
		}

		return (
			<div
				ref={revealRef(d._key)}
				className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
			>
				{/* Header mirrors the collapsed row exactly (handle + label + chevron
				    far-right) so the toggle target doesn't jump when expanding. */}
				<div className="flex items-center gap-2">
					{handle}
					<button
						type="button"
						onClick={() => toggleExpand(d._key)}
						aria-expanded={true}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<span className="truncate text-sm font-medium">{displayLabel}</span>
						<ChevronDown className="ml-auto size-4 shrink-0 rotate-180 text-muted-foreground" />
					</button>
				</div>

				{/* Stack on mobile (full-width, never misaligned); three columns at sm+
				    where each label fits one line so the inputs line up. */}
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Label (English)
						</span>
						<Input
							type="text"
							variant="field"
							maxLength={STAGE_LABEL_MAX_LENGTH}
							value={d.labelEn}
							onChange={(e) => update(d._key, { labelEn: e.target.value })}
							placeholder="e.g. Sewing"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Label (Bahasa Malaysia)
						</span>
						<Input
							type="text"
							variant="field"
							maxLength={STAGE_LABEL_MAX_LENGTH}
							value={d.labelMs}
							onChange={(e) => update(d._key, { labelMs: e.target.value })}
							placeholder="Optional"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Label (中文)
						</span>
						<Input
							type="text"
							variant="field"
							maxLength={STAGE_LABEL_MAX_LENGTH}
							value={d.labelZh}
							onChange={(e) => update(d._key, { labelZh: e.target.value })}
							placeholder="Optional"
						/>
					</label>
				</div>

				<label className="flex flex-col gap-1">
					<span className="text-xs font-medium text-muted-foreground">
						Counts as{" "}
						<span className="font-normal">
							— which milestone this step represents
						</span>
					</span>
					<select
						value={d.anchor}
						onChange={(e) =>
							update(d._key, { anchor: e.target.value as StageAnchor })
						}
						className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
					>
						{STAGE_ANCHORS.map((a) => (
							<option key={a} value={a}>
								{ANCHOR_UI_LABELS[a]}
							</option>
						))}
					</select>
					<span className="text-xs text-muted-foreground">
						{d.anchor === "confirmed"
							? "The order has been accepted. Use this for your first step."
							: d.anchor === "delivered"
								? "The order is complete. Use this for your last step."
								: "A step while you're fulfilling the order."}
					</span>
				</label>

				<div className="grid grid-cols-1 gap-2">
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Buyer note (optional) — English
						</span>
						<textarea
							value={d.descEn}
							onChange={(e) => update(d._key, { descEn: e.target.value })}
							placeholder="e.g. Drying — usually 1–2 days depending on weather"
							rows={2}
							maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
							className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Buyer note (optional) — Bahasa Malaysia
						</span>
						<textarea
							value={d.descMs}
							onChange={(e) => update(d._key, { descMs: e.target.value })}
							placeholder="Pilihan"
							rows={2}
							maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
							className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-muted-foreground">
							Buyer note (optional) — 中文
						</span>
						<textarea
							value={d.descZh}
							onChange={(e) => update(d._key, { descZh: e.target.value })}
							placeholder="可选"
							rows={2}
							maxLength={STAGE_DESCRIPTION_MAX_LENGTH}
							className="rounded-xl border border-input bg-background px-4 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
					</label>
				</div>

				{/* Destructive action lives at the bottom (out of the toggle header) so
				    it can't be hit while quick-expanding/collapsing. */}
				<button
					type="button"
					onClick={() => remove(d._key)}
					className="flex h-9 items-center gap-1.5 self-start rounded-lg px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
				>
					<Trash2 className="size-3.5" />
					Remove stage
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-2">
				<SectionHeading
					title="Stages"
					description="Drag to reorder. Each stage must “count as” the same milestone as the one before it, or a later one."
				/>
				<Button
					type="button"
					variant="outline"
					className="h-9 shrink-0"
					onClick={addStage}
					disabled={drafts.length >= MAX_ORDER_STAGES}
				>
					<Plus className="size-4" />
					Add stage
				</Button>
			</div>

			{/* Stages used to be able to fire a WhatsApp each. They can't any more, so
			    say what they still do — otherwise a seller who relied on stage pings
			    just sees the toggle gone. */}
			<p className="text-xs text-muted-foreground leading-relaxed">
				Stages are your own words for the steps an order goes through. They name
				the steps on the buyer's order page too — advancing a stage updates that
				page instantly, but doesn't send the buyer a WhatsApp.
			</p>

			{drafts.length === 0 ? (
				<p className="rounded-xl border border-dashed border-input bg-muted/20 px-4 py-4 text-center text-sm text-muted-foreground">
					No stages — add at least one, or reset to the defaults.
				</p>
			) : (
				<SortableList
					items={drafts}
					getId={(d) => d._key}
					onReorder={(ids) =>
						setDrafts((prev) => reorderByIds(prev, ids, (d) => d._key))
					}
					renderItem={(d, handle, state) =>
						stageCard(d, drafts.indexOf(d), handle, state)
					}
					className="flex flex-col gap-3"
				/>
			)}

			{errors.length > 0 ? (
				<ul className="flex flex-col gap-1 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
					{errors.map((e) => (
						<li key={e}>• {e}</li>
					))}
				</ul>
			) : null}

			<div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
				{isCustomized ? (
					<Button
						type="button"
						variant="ghost"
						onClick={handleReset}
						disabled={saving}
						className="h-11 lg:h-10 lg:w-auto"
					>
						Reset to defaults
					</Button>
				) : null}
				<Button
					type="button"
					onClick={handleSave}
					disabled={!canSave}
					className={SAVE_BTN_CLASS}
				>
					{saving ? "Saving…" : "Save stages"}
				</Button>
			</div>
		</div>
	);
}

function LocaleForm({
	current,
	onSave,
}: {
	current: Locale;
	onSave: (locale: Locale) => Promise<unknown>;
}) {
	const [value, setValue] = useState<Locale>(current);
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
				<span className="text-sm font-medium">Message language</span>
				<select
					value={value}
					onChange={(e) => setValue(e.target.value as Locale)}
					className="min-h-11 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				>
					{LOCALE_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
				{/* The field reaches further than its old "sent to shoppers" copy
				    admitted: retailer email alerts have always rendered in it, and
				    the WhatsApp order alerts (86eyhw9zy) now do too. */}
				<span className="text-xs text-muted-foreground">
					Used for the order confirmation buyers receive and their order
					page — and for the order alerts we send you on WhatsApp.
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
		submitThenFocusError(form, e);
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
		submitThenFocusError(form, e);
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
						description="We'll email you here whenever a new order arrives or a buyer says they've paid. If WhatsApp order alerts are on, these arrive on WhatsApp instead — and this email is the backup if one can't be delivered. Leave blank to turn off email notifications."
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
		// Seeded as the national part — the field wears a fixed `+60` plate, so
		// the stored `60…` form would render the country code twice.
		defaultValues: { waPhone: toMyNationalInput(current) },
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
		submitThenFocusError(form, e);
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<form.AppField name="waPhone">
				{(field) => (
					<field.TextField
						label="Your contact WhatsApp number"
						type="tel"
						inputMode="tel"
						autoComplete="tel"
						prefix={<MyPhonePrefix />}
						placeholder="12-345 6789"
						required
						description="Shown to buyers on their order page (and in the order confirmation) so they can message you directly. Malaysian mobile — it's also the sender contact when a rider collects from you."
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
					// Compare digits-only, both normalized to the stored `60…` form:
					// the field holds the national part beside the plate, `current`
					// carries the country code.
					const dirty =
						normalizeMyDigits(values.waPhone) !== normalizeMyDigits(current);
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
