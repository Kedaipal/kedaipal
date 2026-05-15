import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	ArrowRight,
	CheckCircle2,
	Clock,
	CreditCard,
	Globe,
	type LucideIcon,
	MessageCircle,
	Package,
	Phone,
	QrCode,
	Share2,
} from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { StorefrontQrDialog } from "../components/dashboard/storefront-qr-dialog";
import { ShopeeIcon } from "../components/icons/shopee-icon";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { formatPrice } from "../lib/format";

export const Route = createFileRoute("/app/")({
	component: DashboardHome,
});

function DashboardSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			{/* Hero section */}
			<section className="rounded-3xl border border-border bg-card p-6">
				<div className="flex flex-col gap-3">
					<Skeleton className="h-3 w-24" />
					<div className="flex items-center gap-3">
						<Skeleton className="h-14 w-14 rounded-2xl" />
						<Skeleton className="h-7 w-40" />
					</div>
					<Skeleton className="h-4 w-56" />
					<div className="mt-2 flex gap-2">
						<Skeleton className="h-11 flex-1 rounded-md" />
						<Skeleton className="h-11 flex-1 rounded-md" />
						<Skeleton className="h-11 w-11 rounded-md" />
					</div>
				</div>
			</section>

			{/* Stats grid */}
			<section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{[0, 1, 2, 3].map((n) => (
					<div
						key={n}
						className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
					>
						<Skeleton className="h-8 w-8 rounded-lg" />
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-7 w-10" />
							<Skeleton className="h-3 w-16" />
							<Skeleton className="h-3 w-20" />
						</div>
					</div>
				))}
			</section>

			{/* Recent orders */}
			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
				<div className="flex items-center justify-between">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-3 w-16" />
				</div>
				{[0, 1, 2].map((n) => (
					<div
						key={n}
						className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
					>
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-3 w-32" />
						</div>
						<div className="flex flex-col items-end gap-1.5">
							<Skeleton className="h-4 w-16" />
							<Skeleton className="h-4 w-14 rounded-full" />
						</div>
					</div>
				))}
			</section>
		</div>
	);
}

function DashboardHome() {
	const retailer = useQuery(api.retailers.getMyRetailer);
	const products = useQuery(
		api.products.listAll,
		retailer ? { retailerId: retailer._id } : "skip",
	);
	const orderCounts = useQuery(
		api.orders.countActionable,
		retailer ? { retailerId: retailer._id } : "skip",
	);
	const recentOrdersPage = useQuery(
		api.orders.listByRetailer,
		retailer
			? {
					retailerId: retailer._id,
					paginationOpts: { numItems: 5, cursor: null },
				}
			: "skip",
	);
	const [copied, setCopied] = useState(false);
	const [qrOpen, setQrOpen] = useState(false);

	if (!retailer) return <DashboardSkeleton />;

	const storefrontUrl = `${typeof window !== "undefined" ? window.location.origin : "https://kedaipal.com"}/${retailer.slug}`;

	async function copy() {
		try {
			await navigator.clipboard.writeText(storefrontUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {
			// ignore
		}
	}

	const hasWaPhone = Boolean(retailer.waPhone?.trim());
	const productCount = products?.length ?? 0;
	const activeProductCount = products?.filter((p) => p.active).length ?? 0;
	const hasProduct = productCount > 0;
	const payment = retailer.paymentInstructions;
	const hasPayment = Boolean(
		payment &&
			(payment.bankName ||
				payment.bankAccountName ||
				payment.bankAccountNumber ||
				payment.qrImageStorageId ||
				payment.note),
	);

	const checklist: ChecklistItem[] = [
		{
			key: "wa",
			step: 1,
			done: hasWaPhone,
			icon: Phone,
			title: "Add your WhatsApp number",
			why: "Shoppers tap Checkout and their cart arrives as a WhatsApp message to this number. Without it, orders can't reach you.",
			time: "~1 min",
			cta: "Go to Settings",
			to: "/app/settings",
			tab: "whatsapp",
		},
		{
			key: "product",
			step: 2,
			done: hasProduct,
			icon: Package,
			title: "Add your first product",
			why: "Your storefront is empty until you add at least one item. Add a name, price, and photo — it goes live instantly.",
			time: "~3 min",
			cta: "Add a product",
			to: "/app/products/new",
		},
		{
			key: "payment",
			step: 3,
			done: hasPayment,
			icon: CreditCard,
			title: "Add payment details",
			why: "Your bank account or DuitNow QR is included automatically in the order confirmation message sent to every shopper.",
			time: "~2 min",
			cta: "Go to Settings",
			to: "/app/settings",
			tab: "payments",
		},
	];

	const completedCount = checklist.filter((c) => c.done).length;
	const allDone = completedCount === checklist.length;
	const isNew = completedCount === 0;

	const pendingCount = orderCounts?.pending ?? 0;
	const confirmedCount = orderCounts?.confirmed ?? 0;
	const recentOrders = recentOrdersPage?.page ?? [];

	return (
		<div className="flex flex-col gap-6">
			{/* Welcome banner — only for brand-new users */}
			{isNew ? (
				<section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent/20 via-accent/10 to-background p-6">
					<div
						className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20 blur-3xl"
						aria-hidden="true"
					/>
					<div className="relative flex flex-col gap-2">
						<p className="text-xs font-semibold uppercase tracking-widest text-accent">
							Welcome to Kedaipal 👋
						</p>
						<h2 className="text-2xl font-bold leading-snug">
							Let's get your store ready in 3 steps
						</h2>
						<p className="text-sm text-muted-foreground">
							Your storefront is live at{" "}
							<span className="font-mono text-foreground">
								kedaipal.com/{retailer.slug}
							</span>
							. Complete the steps below and you'll be accepting WhatsApp orders
							in minutes.
						</p>
					</div>
				</section>
			) : (
				/* Hero — for returning users */
				<section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent/15 via-card to-card p-6">
					<div
						className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/20 blur-3xl"
						aria-hidden="true"
					/>
					<div className="relative flex min-w-0 flex-col gap-3">
						<p className="text-xs font-semibold uppercase tracking-widest text-accent">
							Your storefront
						</p>
						<div className="flex items-center gap-3">
							{retailer.logoUrl ? (
								<img
									src={retailer.logoUrl}
									alt={`${retailer.storeName} logo`}
									className="h-14 w-14 shrink-0 rounded-2xl border border-border bg-background object-contain"
								/>
							) : null}
							<h2 className="text-2xl font-bold leading-tight">
								{retailer.storeName}
							</h2>
						</div>
						<p className="break-all font-mono text-sm text-muted-foreground">
							{storefrontUrl}
						</p>
						<div className="mt-2 flex gap-2">
							<Button
								onClick={copy}
								variant="secondary"
								className="h-11 flex-1"
							>
								{copied ? "Copied!" : "Copy link"}
							</Button>
							<Button asChild className="h-11 flex-1">
								<a href={`/${retailer.slug}`} target="_blank" rel="noreferrer">
									Open store
								</a>
							</Button>
							<Button
								variant="outline"
								className="h-11 w-11 shrink-0 p-0"
								onClick={() => setQrOpen(true)}
								aria-label="Show QR code"
							>
								<QrCode className="size-5" />
							</Button>
						</div>
					</div>
				</section>
			)}

			<StorefrontQrDialog
				open={qrOpen}
				onClose={() => setQrOpen(false)}
				storeName={retailer.storeName}
				storefrontUrl={storefrontUrl}
			/>

			{/* How it works — only for brand-new users */}
			{isNew ? (
				<section className="flex flex-col gap-3">
					<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
						How Kedaipal works
					</h3>
					<div className="grid grid-cols-3 gap-2">
						{[
							{ icon: Share2, label: "You share your store link" },
							{ icon: MessageCircle, label: "Shoppers order via WhatsApp" },
							{ icon: CheckCircle2, label: "You confirm & update status" },
						].map((step, i) => (
							<div
								key={step.label}
								className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-3 text-center"
							>
								<div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
									<step.icon className="size-4" />
								</div>
								<p className="text-[11px] font-medium leading-tight text-foreground">
									{i + 1}. {step.label}
								</p>
							</div>
						))}
					</div>
				</section>
			) : null}

			{/* Setup checklist */}
			{!allDone ? (
				<section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
					<div className="flex items-center justify-between">
						<h3 className="font-semibold">
							{isNew ? "Complete your setup" : "Finish setting up"}
						</h3>
						<span className="text-xs text-muted-foreground">
							{completedCount}/{checklist.length} done
						</span>
					</div>
					<div
						className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
						aria-hidden="true"
					>
						<div
							className="h-full bg-accent transition-all duration-500"
							style={{ width: `${(completedCount / checklist.length) * 100}%` }}
						/>
					</div>
					<ul className="flex flex-col gap-3">
						{checklist.map((item, i) => {
							const isNext =
								!item.done && checklist.slice(0, i).every((c) => c.done);
							return (
								<ChecklistRow key={item.key} item={item} expanded={isNext} />
							);
						})}
					</ul>
				</section>
			) : null}

			{/* Stats grid — hidden for brand-new users */}
			{!isNew ? (
				<section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<StatTile
						to="/app/orders"
						icon={Clock}
						label="Pending"
						value={pendingCount}
						accent={pendingCount > 0}
						sub="Awaiting confirm"
					/>
					<StatTile
						to="/app/orders"
						icon={CheckCircle2}
						label="Confirmed"
						value={confirmedCount}
						sub="In progress"
					/>
					<StatTile
						to="/app/products"
						icon={Package}
						label="Products"
						value={activeProductCount}
						sub={
							productCount > activeProductCount
								? `${productCount - activeProductCount} archived`
								: "Active"
						}
					/>
					<StatTile
						to="/app/settings"
						icon={Globe}
						label="Language"
						value={retailer.locale === "ms" ? "MS" : "EN"}
						sub={retailer.locale === "ms" ? "Bahasa Malaysia" : "English"}
					/>
				</section>
			) : null}

			{/* Recent orders + sales channels — desktop side-by-side, mobile stacked */}
			{!isNew ? (
				<div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-6">
					<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold">Recent orders</h3>
							<Link
								to="/app/orders"
								className="text-xs font-medium text-accent hover:underline"
							>
								View all →
							</Link>
						</div>
						{recentOrders.length === 0 ? (
							<EmptyOrders hasProduct={hasProduct} />
						) : (
							<ul className="flex flex-col gap-2">
								{recentOrders.map((order) => (
									<li key={order._id}>
										<Link
											to="/app/orders/$shortId"
											params={{ shortId: order.shortId }}
											className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/5"
										>
											<div className="flex min-w-0 flex-col gap-0.5">
												<p className="truncate font-mono text-sm font-medium">
													{order.shortId}
												</p>
												<p className="truncate text-xs text-muted-foreground">
													{order.customer?.name ?? "Anonymous"} ·{" "}
													{order.items.length} item
													{order.items.length === 1 ? "" : "s"}
												</p>
											</div>
											<div className="flex shrink-0 flex-col items-end gap-1">
												<p className="text-sm font-semibold">
													{formatPrice(order.total, order.currency)}
												</p>
												<StatusBadge status={order.status} />
											</div>
										</Link>
									</li>
								))}
							</ul>
						)}
					</section>

					{/* Sales channels teaser */}
					<section className="flex flex-col gap-3 lg:col-span-1">
						<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
							Sales channels
						</h3>
						<Link
							to="/app/settings"
							search={{ tab: "integrations" }}
							className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-accent/5"
						>
							<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#EE4D2D]/10 text-[#EE4D2D]">
								<ShopeeIcon className="size-6" />
							</div>
							<div className="flex flex-1 flex-col gap-0.5">
								<div className="flex items-center gap-2">
									<p className="text-sm font-semibold">Shopee</p>
									<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
										Coming soon
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									Sync products & orders from Shopee
								</p>
							</div>
							<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
						</Link>
					</section>
				</div>
			) : null}
		</div>
	);
}

type SettingsTab = "store" | "whatsapp" | "payments" | "integrations";

type ChecklistItem = {
	key: string;
	step: number;
	done: boolean;
	icon: LucideIcon;
	title: string;
	why: string;
	time: string;
	cta: string;
	to: string;
	tab?: SettingsTab;
};

function ChecklistRow({
	item,
	expanded,
}: {
	item: ChecklistItem;
	expanded: boolean;
}) {
	const Icon = item.icon;

	if (item.done) {
		return (
			<li className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
				<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
					<CheckIcon />
				</div>
				<p className="flex-1 text-sm font-medium text-muted-foreground line-through">
					{item.title}
				</p>
				<span className="text-xs text-muted-foreground">Done</span>
			</li>
		);
	}

	if (expanded) {
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
				<Link to={item.to} search={item.tab ? { tab: item.tab } : undefined}>
					<Button size="sm" className="h-10 w-full gap-2">
						{item.cta}
						<ArrowRight className="size-3.5" />
					</Button>
				</Link>
			</li>
		);
	}

	return (
		<li>
			<Link
				to={item.to}
				search={item.tab ? { tab: item.tab } : undefined}
				className="block"
			>
				<div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/5">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-[10px] font-bold text-muted-foreground">
						{item.step}
					</div>
					<div className="flex-1">
						<p className="text-sm font-medium">{item.title}</p>
						<p className="text-xs text-muted-foreground">{item.time}</p>
					</div>
					<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
				</div>
			</Link>
		</li>
	);
}

function StatTile({
	to,
	icon: Icon,
	label,
	value,
	sub,
	accent,
}: {
	to: string;
	icon: LucideIcon;
	label: string;
	value: string | number;
	sub: string;
	accent?: boolean;
}) {
	return (
		<Link
			to={to}
			className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors ${
				accent
					? "border-accent/40 bg-accent/10 hover:bg-accent/15"
					: "border-border bg-card hover:bg-accent/5"
			}`}
		>
			<div
				className={`flex h-8 w-8 items-center justify-center rounded-lg ${
					accent ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"
				}`}
			>
				<Icon className="size-4" />
			</div>
			<div>
				<p
					className={`text-2xl font-bold leading-none tabular-nums ${
						accent ? "text-accent" : "text-foreground"
					}`}
				>
					{value}
				</p>
				<p className="mt-1 text-xs font-medium text-foreground">{label}</p>
				<p className="truncate text-[11px] text-muted-foreground">{sub}</p>
			</div>
		</Link>
	);
}

function StatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
		confirmed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
		packed: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
		shipped: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
		delivered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
		cancelled: "bg-muted text-muted-foreground",
	};
	const cls = styles[status] ?? "bg-muted text-muted-foreground";
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
		>
			{status}
		</span>
	);
}

function EmptyOrders({ hasProduct }: { hasProduct: boolean }) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
			<p className="text-sm font-medium">No orders yet</p>
			<p className="max-w-xs text-xs text-muted-foreground">
				{hasProduct
					? "Share your storefront link to start receiving orders via WhatsApp."
					: "Add a product first, then share your storefront link."}
			</p>
		</div>
	);
}

function CheckIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			className="h-3 w-3"
			aria-hidden="true"
		>
			<path
				fillRule="evenodd"
				d="M16.704 5.29a1 1 0 010 1.42l-8 8a1 1 0 01-1.42 0l-4-4a1 1 0 011.42-1.42L8 12.59l7.29-7.3a1 1 0 011.414 0z"
				clipRule="evenodd"
			/>
		</svg>
	);
}
