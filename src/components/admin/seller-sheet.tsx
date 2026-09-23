// One seller, every fact (z8r3fdh37c): the read-only detail panel behind a
// row's name. A right-hand drawer beside the table on desktop, a bottom
// sheet on a phone — the same `Sheet` primitive either way. Each fact has its
// own copy control; "Copy summary" writes the plain-text block an admin
// pastes into a WhatsApp message. The actions live in the footer's Manage
// menu — the same one door the row has, so nothing here can drift from it.
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { AdminSellerRow } from "../../../convex/admin";
import { COMP_KIND_LABEL } from "../../../convex/lib/comp";
import { COUNTRY_LABELS } from "../../../convex/lib/country";
import {
	describeDays,
	sellerBucket,
	sellerExpiry,
	sellerPlanLabel,
	sellerRail,
	sellerReason,
	sellerSummaryText,
} from "../../lib/admin-seller-view";
import { formatPrice, formatShortDate } from "../../lib/format";
import { storefrontOrigin, storefrontUrl } from "../../lib/storefront-url";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";
import {
	ContactLine,
	ExpiryText,
	FoundingPill,
	StatusPill,
} from "./seller-cells";
import { SellerManageMenu, useOpenStore } from "./seller-manage-menu";

export function SellerSheet({
	seller,
	open,
	onOpenChange,
	purgeEnabled,
	now,
}: {
	seller: AdminSellerRow | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	purgeEnabled: boolean;
	now: number;
}) {
	return (
		<Sheet open={open && seller !== null} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="gap-0 p-0 sm:max-w-lg">
				{seller ? (
					<SellerSheetBody
						seller={seller}
						purgeEnabled={purgeEnabled}
						now={now}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function SellerSheetBody({
	seller,
	purgeEnabled,
	now,
}: {
	seller: AdminSellerRow;
	purgeEnabled: boolean;
	now: number;
}) {
	const openStore = useOpenStore(seller);
	const bucket = sellerBucket(seller);
	const reason = sellerReason(seller);
	const expiry = sellerExpiry(seller, now);
	const rail = sellerRail(seller);
	const link = storefrontUrl(seller.slug);
	const summary = sellerSummaryText(seller, storefrontOrigin(), now);
	const alertsSameAsStore =
		seller.notifyWaPhone !== undefined &&
		seller.notifyWaPhone === seller.waPhone;
	const neverBilled = seller.ownerIsAdmin || seller.comped;

	return (
		<>
			<SheetHeader className="gap-3 border-b border-border p-5 pr-14">
				<div className="flex flex-col gap-1">
					<div className="flex min-w-0 items-center gap-2">
						<SheetTitle className="truncate font-heading text-xl font-bold">
							{seller.storeName}
						</SheetTitle>
						{seller.foundingMemberRank !== undefined ? (
							<FoundingPill rank={seller.foundingMemberRank} />
						) : null}
					</div>
					<SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<StatusPill bucket={bucket} />
						<span className="truncate">
							{[sellerPlanLabel(seller), rail]
								.filter((p) => p && p !== "—")
								.join(" · ")}
						</span>
					</SheetDescription>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={openStore}
						disabled={seller.purging}
						className="tap-target rounded-xl px-4"
					>
						Open store
					</Button>
					<CopyButton
						value={summary}
						label="Copy summary"
						ariaLabel={`Copy a summary of ${seller.storeName}`}
						successMessage="Summary copied — paste it into WhatsApp"
						className="h-11 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted"
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					Copy summary pastes the name, link, email, WhatsApp, plan and renewal
					date as plain text.
				</p>
			</SheetHeader>

			<div className="flex flex-col gap-5 p-5">
				<Section title="Contact">
					<Row label="Login email">
						<ContactLine kind="email" value={seller.ownerEmail} />
					</Row>
					<Row label="Store WhatsApp">
						<ContactLine kind="whatsapp" value={seller.waPhone} />
					</Row>
					<Row label="Order alerts to">
						{alertsSameAsStore ? (
							<Plain muted>Same as store WhatsApp</Plain>
						) : (
							<ContactLine kind="whatsapp" value={seller.notifyWaPhone} />
						)}
					</Row>
				</Section>

				<Section title="Storefront">
					<Row label="Link">
						<div className="flex min-w-0 items-center gap-1.5">
							<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
								{link.replace(/^https?:\/\//, "")}
							</span>
							<a
								href={link}
								target="_blank"
								rel="noreferrer"
								aria-label="Open storefront"
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								<ExternalLink className="size-3.5" aria-hidden="true" />
							</a>
							<CopyButton
								value={link}
								ariaLabel="Copy storefront link"
								successMessage="Link copied"
								className="h-11 w-11 justify-center rounded-lg px-0"
								labelClassName="sr-only"
							/>
						</div>
					</Row>
					<Row label="Country · currency">
						<Plain>
							{/* currency-literal-ok: the store's currency SETTING (admin console) */}
							{COUNTRY_LABELS[seller.country]} · {seller.currency}
						</Plain>
					</Row>
				</Section>

				<Section title="Billing">
					<Row label="Status">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<StatusPill bucket={bucket} />
							{reason ? <Plain muted>{reason}</Plain> : null}
						</div>
					</Row>
					<Row label="Plan">
						<Plain>
							{[sellerPlanLabel(seller), rail]
								.filter((p) => p && p !== "—")
								.join(" · ") || "—"}
						</Plain>
					</Row>
					<Row label="Expiry">
						<div className="flex min-w-0 items-center gap-1.5">
							<ExpiryText
								expiry={expiry}
								className="flex-1 flex-row items-baseline gap-2"
							/>
							{expiry.at !== undefined ? (
								<CopyButton
									value={formatShortDate(expiry.at)}
									ariaLabel="Copy date"
									successMessage="Date copied"
									className="h-11 w-11 justify-center rounded-lg px-0"
									labelClassName="sr-only"
								/>
							) : null}
						</div>
					</Row>
					{seller.freePeriodEndedAt !== undefined ? (
						<Row label="Free period ended">
							<Plain>
								{formatShortDate(seller.freePeriodEndedAt)}
								<Muted>
									{" "}
									·{" "}
									{seller.freePeriodEndReason === "backstop"
										? "reached the deadline"
										: "first order"}
								</Muted>
							</Plain>
						</Row>
					) : seller.subscriptionStatus === "trialing" ? (
						<Row label="Free period">
							<Plain muted>Still free — ends at the first order</Plain>
						</Row>
					) : null}
					{seller.pendingInvoice ? (
						<Row label="Open invoice">
							<div className="flex min-w-0 items-center gap-1.5">
								<Plain className="flex-1">
									<span className="font-mono">
										{seller.pendingInvoice.invoiceNumber}
									</span>
									<Muted>
										{" "}
										·{" "}
										{formatPrice(
											seller.pendingInvoice.total,
											seller.pendingInvoice.currency,
										)}{" "}
										· due {formatShortDate(seller.pendingInvoice.dueDate)}
										{seller.pendingInvoice.hasPayNowLink
											? " · Pay-now link sent"
											: ""}
									</Muted>
								</Plain>
								<CopyButton
									value={seller.pendingInvoice.invoiceNumber}
									ariaLabel="Copy invoice number"
									successMessage="Invoice number copied"
									className="h-11 w-11 justify-center rounded-lg px-0"
									labelClassName="sr-only"
								/>
							</div>
						</Row>
					) : null}
					{neverBilled ? null : (
						<Row label="Last paid">
							{seller.lastPaidInvoice ? (
								<Plain>
									<span className="font-mono">
										{seller.lastPaidInvoice.invoiceNumber}
									</span>
									<Muted>
										{" "}
										·{" "}
										{formatPrice(
											seller.lastPaidInvoice.total,
											seller.lastPaidInvoice.currency,
										)}{" "}
										· {formatShortDate(seller.lastPaidInvoice.paidAt)}
									</Muted>
								</Plain>
							) : (
								<Plain muted>Never paid</Plain>
							)}
						</Row>
					)}
					{seller.autoRenew ? (
						<Row label="Auto-renew">
							<Plain>
								{seller.autoRenew.methodLabel ?? seller.autoRenew.method}
								<Muted>
									{" "}
									· since {formatShortDate(seller.autoRenew.attachedAt)}
								</Muted>
							</Plain>
						</Row>
					) : null}
					{seller.ownerIsAdmin ? null : (
						<Row label="Comp upgrade">
							{seller.comped ? (
								<Plain>
									On
									{seller.comp ? (
										<Muted>
											{" "}
											· {COMP_KIND_LABEL[seller.comp.kind]}
											{seller.comp.label ? ` · ${seller.comp.label}` : ""} ·
											since {formatShortDate(seller.comp.grantedAt)}
										</Muted>
									) : null}
								</Plain>
							) : (
								<Plain muted>Off</Plain>
							)}
						</Row>
					)}
					{seller.comp?.note ? (
						<Row label="Comp note">
							<Plain muted>{seller.comp.note}</Plain>
						</Row>
					) : null}
				</Section>

				<Section title="How they arrived">
					<Row label="Joined">
						<Plain>
							{formatShortDate(seller.createdAt)}
							<Muted> · {describeDays(seller.createdAt, now)}</Muted>
						</Plain>
					</Row>
					<Row label="Signup source">
						{seller.signupSource ? (
							<Plain>
								{seller.signupSource}
								{seller.signupReferrer ? (
									<Muted>
										{" "}
										· via /{seller.signupReferrer.slug} (
										{seller.signupReferrer.storeName})
									</Muted>
								) : null}
							</Plain>
						) : (
							<Plain muted>Direct — no tag, no referrer</Plain>
						)}
					</Row>
					{seller.foundingMemberRank !== undefined ? (
						<Row label="Founding">
							<Plain>Member #{seller.foundingMemberRank}</Plain>
						</Row>
					) : null}
				</Section>

				<Section title="Kedaipal activity">
					<Row label="Last opened by an admin">
						{seller.lastActAsAt !== undefined ? (
							<Plain>
								{formatShortDate(seller.lastActAsAt)}
								<Muted> · {describeDays(seller.lastActAsAt, now)}</Muted>
							</Plain>
						) : (
							<Plain muted>Never</Plain>
						)}
					</Row>
				</Section>
			</div>

			<div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-border bg-popover p-4">
				<span className="text-xs text-muted-foreground">
					Comp upgrade and the dev reset live under Manage.
				</span>
				<SellerManageMenu seller={seller} purgeEnabled={purgeEnabled} />
			</div>
		</>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col">
			<h3 className="pb-1.5 text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
				{title}
			</h3>
			<div className="flex flex-col divide-y divide-border/60">{children}</div>
		</section>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		// Label above the value on a phone (a 120px label column left
		// "+60 12-3…" of a number); beside it once the drawer has the width.
		<div className="grid min-h-11 grid-cols-1 items-center gap-y-0.5 py-1.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3 sm:py-1">
			<span className="text-xs text-muted-foreground">{label}</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function Plain({
	children,
	muted = false,
	className,
}: {
	children: ReactNode;
	muted?: boolean;
	className?: string;
}) {
	return (
		<span
			className={`block min-w-0 truncate text-[13px] ${muted ? "text-muted-foreground" : "font-medium"} ${className ?? ""}`}
		>
			{children}
		</span>
	);
}

function Muted({ children }: { children: ReactNode }) {
	return <span className="font-normal text-muted-foreground">{children}</span>;
}
