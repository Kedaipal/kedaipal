// One seller, every fact (z8r3fdh37c): the read-only detail panel behind a
// row's name. A right-hand drawer beside the table on desktop, a bottom
// sheet on a phone — the same `Sheet` primitive either way. Each fact has its
// own copy control; "Copy summary" writes the plain-text block an admin
// pastes into a WhatsApp message. The actions live in the footer's Manage
// menu — the same one door the row has, so nothing here can drift from it.
import { useMutation } from "convex/react";
import { Building2, Coins, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { COMP_KIND_LABEL } from "../../../convex/lib/comp";
import { COUNTRY_LABELS } from "../../../convex/lib/country";
import {
	enterpriseBlockPrice,
	isMoveOffContractBill,
} from "../../../convex/lib/enterprise";
import { enterprisePrice, planPrice } from "../../../convex/lib/plans";
import {
	describeDays,
	highlightedThroughLabel,
	sellerBucket,
	sellerCredits,
	sellerExpiry,
	sellerHighlight,
	sellerPlanLabel,
	sellerRail,
	sellerReason,
	sellerSeatsLabel,
	sellerSummaryText,
} from "../../lib/admin-seller-view";
import {
	convexErrorMessage,
	formatPrice,
	formatShortDate,
} from "../../lib/format";
import { storefrontOrigin, storefrontUrl } from "../../lib/storefront-url";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";
import { CreditLedgerBody, periodLabel } from "./credit-ledger-sheet";
import {
	EnterpriseContractPage,
	type EnterpriseContractTemplate,
} from "./enterprise-contract-page";
import {
	ContactLine,
	CreditsText,
	ExpiryText,
	FoundingPill,
	MarketplacePill,
	OwnerEmailLine,
	StatusPill,
} from "./seller-cells";
import { SellerManageMenu, useOpenStore } from "./seller-manage-menu";

export function SellerSheet({
	seller,
	contractTemplates,
	open,
	onOpenChange,
	purgeEnabled,
	now,
}: {
	seller: AdminSellerRow | null;
	/** Other stores' Enterprise contracts, to start a new deal from. */
	contractTemplates: EnterpriseContractTemplate[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	purgeEnabled: boolean;
	now: number;
}) {
	return (
		<Sheet open={open && seller !== null} onOpenChange={onOpenChange}>
			{/* `sm:pb-0` too: the right sheet adds `sm:pb-5`, which a bare `p-0`
			    can't override, and padding on the scroll container parks the
			    sticky footer ABOVE it — rows then scroll visibly underneath. The
			    footer carries the safe-area inset itself instead. */}
			<SheetContent side="right" className="gap-0 p-0 sm:max-w-lg sm:pb-0">
				{seller ? (
					<SellerSheetBody
						seller={seller}
						contractTemplates={contractTemplates}
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
	contractTemplates,
	purgeEnabled,
	now,
}: {
	seller: AdminSellerRow;
	contractTemplates: EnterpriseContractTemplate[];
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
	const highlight = sellerHighlight(seller, now);
	const hidden = seller.marketplace.hidden;
	// A highlight keeps its setting while the store is hidden, but it isn't
	// showing — the line must not read as if it were.
	const hiddenSuffix = hidden !== undefined ? " — paused while hidden" : "";
	const alertsSameAsStore =
		seller.notifyWaPhone !== undefined &&
		seller.notifyWaPhone === seller.waPhone;
	const neverBilled = seller.ownerIsAdmin || seller.comped;
	const credits = sellerCredits(seller);
	// The credit ledger and the Enterprise contract are pages of THIS drawer,
	// not drawers stacked on top: one surface, a back link, and focus returns
	// to the button that opened the page.
	const [page, setPage] = useState<"details" | "ledger" | "enterprise">(
		"details",
	);
	const ledgerButtonRef = useRef<HTMLButtonElement>(null);
	const enterpriseButtonRef = useRef<HTMLButtonElement>(null);
	const returnFocusTo = useRef<"ledger" | "enterprise" | null>(null);
	useEffect(() => {
		if (page !== "details" || returnFocusTo.current === null) return;
		const target = returnFocusTo.current;
		returnFocusTo.current = null;
		(target === "ledger"
			? ledgerButtonRef
			: enterpriseButtonRef
		).current?.focus();
	}, [page]);
	const back = (from: "ledger" | "enterprise") => () => {
		returnFocusTo.current = from;
		setPage("details");
	};
	const [confirmMove, setConfirmMove] = useState(false);
	const scheduleMoveToPro = useMutation(api.enterprise.scheduleMoveToPro);
	const dismissInterest = useMutation(api.enterprise.dismissInterest);
	const dismissLead = async () => {
		try {
			await dismissInterest({ retailerId: seller._id });
			toast.success("Enterprise ask dismissed", {
				description:
					"Off the Wants Enterprise list — it comes back if they ask again.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	};
	const cancelMoveToPro = useMutation(api.enterprise.cancelMoveToPro);

	if (page === "ledger")
		return <CreditLedgerBody seller={seller} onBack={back("ledger")} />;
	if (page === "enterprise")
		return (
			<EnterpriseContractPage
				seller={seller}
				templates={contractTemplates}
				onBack={back("enterprise")}
			/>
		);

	const contract = seller.enterprise;
	// The move to Pro is a flag until the renewal bills it; from then on the
	// move IS that open Pro bill (T6) — both read as "moving".
	const moveBill =
		seller.plan && seller.pendingInvoice
			? isMoveOffContractBill(seller.pendingInvoice, { plan: seller.plan })
				? seller.pendingInvoice
				: null
			: null;
	const movingToPro =
		seller.plan === "enterprise" &&
		(seller.pendingPlanChange?.plan === "pro" || moveBill !== null);
	// Scheduling the move while a bill is open would land it a term late —
	// the server refuses; the reason sits beside the button.
	const moveRefusal =
		seller.pendingInvoice && !movingToPro
			? `Settle or void ${seller.pendingInvoice.invoiceNumber} first — it bills the contract's next term.`
			: null;
	// Why a store can't be put on a contract, said beside the button.
	const contractRefusal = seller.comped
		? "Comped — end the comp before putting it on a contract."
		: seller.isFoundingMember || seller.foundingIntent
			? "Founding Members stay on Founding Pro."
			: null;
	// The move bills Pro on the contract's own term, in its currency.
	const moveCycle = seller.billingCycle ?? "monthly";
	const moveProPrice = contract
		? formatPrice(
				planPrice("pro", moveCycle, false, contract.currency),
				contract.currency,
			)
		: null;

	async function moveToPro() {
		try {
			const res = await scheduleMoveToPro({ retailerId: seller._id });
			toast.success("Moving to Pro at renewal", {
				// A trialing store has no renewal date yet — effectiveAt falls back
				// to "now", and printing today's date as the contract's end reads
				// like an immediate cancellation.
				description:
					seller.subscriptionStatus === "trialing"
						? "When the free period ends, the first bill is Pro's — the contract ends when it's paid."
						: `The contract ends on ${formatShortDate(res.effectiveAt)} — that renewal bills Pro.`,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setConfirmMove(false);
		}
	}

	async function stayOnContract() {
		try {
			const res = await cancelMoveToPro({ retailerId: seller._id });
			toast.success("Staying on Enterprise", {
				description: res.voidedInvoiceNumber
					? `${res.voidedInvoiceNumber} is voided — the next renewal bills the contract.`
					: "The move to Pro is called off; the contract carries on.",
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

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
						<MarketplacePill seller={seller} now={now} />
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
					{/* An unclaimed store has no login to name — the address here is
					    the one it is WAITING for, so the label has to say which
					    question the value answers (docs/prebuilt-stores.md). */}
					<Row label={seller.unclaimed ? "Handover email" : "Login email"}>
						<OwnerEmailLine seller={seller} />
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
					{/* Marketplace presence (z8r3fdkmyp): the admin's hide, the
					    seller's own opt-out and the admin-sold sponsorship, all
					    read before selling one. */}
					<Row label="Marketplace">
						{/* Short lines, not one long one: the row truncates, and
						    the hide / highlight state is what an admin opens this for. */}
						<div className="flex min-w-0 flex-col">
							<Plain
								muted={
									seller.marketplace.internal ||
									hidden !== undefined ||
									seller.marketplace.unlistedAt !== undefined
								}
							>
								{seller.marketplace.internal
									? "Not listed — internal store"
									: hidden !== undefined
										? `Hidden by an admin since ${formatShortDate(hidden.at)}`
										: seller.marketplace.unlistedAt !== undefined
											? `Opted out since ${formatShortDate(seller.marketplace.unlistedAt)}`
											: "Listed (the default)"}
							</Plain>
							{hidden?.note ? <Plain muted>Note: {hidden.note}</Plain> : null}
							{/* Showing it again won't list it while the seller is
							    opted out — say so before the admin finds out. */}
							{hidden !== undefined &&
							seller.marketplace.unlistedAt !== undefined ? (
								<Plain muted>
									Seller opted out too, since{" "}
									{formatShortDate(seller.marketplace.unlistedAt)}
								</Plain>
							) : null}
							{highlight.source === "paid" &&
							seller.marketplace.sponsoredUntil !== undefined ? (
								<Plain muted>
									Highlighted through{" "}
									{highlightedThroughLabel(seller.marketplace.sponsoredUntil)}
									{hiddenSuffix}
								</Plain>
							) : highlight.source === "comp" ? (
								<Plain muted>Highlighted while comped{hiddenSuffix}</Plain>
							) : highlight.compEligible ? (
								<Plain muted>Comped — kept off highlights</Plain>
							) : null}
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
					<Row label="Seats">
						<Plain>{sellerSeatsLabel(seller)}</Plain>
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

				{/* Credits T5 — beside Billing, because it's the other half of
				    what a store pays for. The drawer holds the ledger and the
				    two admin levers; the directory row only reads the cache. */}
				<Section title="Credits">
					<Row label="Balance">
						<CreditsText
							credits={credits}
							className="flex-row items-baseline gap-2"
						/>
					</Row>
					{seller.credits ? (
						<Row label="This month">
							<Plain>
								{periodLabel(seller.credits.periodKey)}
								<Muted> · {seller.credits.periodGrant} granted</Muted>
							</Plain>
						</Row>
					) : null}
					<Row label="Out of credits">
						{credits.outSince !== undefined ? (
							<Plain>
								Since {formatShortDate(credits.outSince)}
								<Muted> · {describeDays(credits.outSince, now)}</Muted>
							</Plain>
						) : (
							<Plain muted>{credits.out ? "Yes" : "No"}</Plain>
						)}
					</Row>
					<Row label="Custom grant">
						{credits.customGrant !== undefined ? (
							<Plain>{credits.customGrant} a month</Plain>
						) : (
							<Plain muted>None — the plan's grant</Plain>
						)}
					</Row>
					<div className="pt-2">
						<Button
							ref={ledgerButtonRef}
							variant="outline"
							onClick={() => setPage("ledger")}
							className="tap-target w-full rounded-xl sm:w-fit"
						>
							<Coins data-icon="inline-start" aria-hidden="true" />
							Open credit ledger
						</Button>
					</div>
				</Section>

				{/* Credits T6 — Enterprise has no list price: a store is on it only
				    while it carries a contract, set here. Beside Credits because
				    the contract's included credits ARE the store's grant. */}
				<Section title="Enterprise">
					{contract ? (
						<>
							<Row label="Fee">
								<Plain>
									{formatPrice(
										enterprisePrice(contract, seller.billingCycle ?? "monthly"),
										contract.currency,
									)}
									<Muted>
										{" "}
										a {seller.billingCycle === "annual" ? "year" : "month"}
									</Muted>
								</Plain>
							</Row>
							<Row label="Included">
								<Plain>
									{contract.includedCredits.toLocaleString("en")} credits a
									month
								</Plain>
							</Row>
							{/* The per-deal allowances, readable without opening the edit
							    form — a negotiated term the summary hides is a term the
							    next admin discovers by hitting it. Broadcasts only when
							    the deal names a number (unbuilt feature, tier default
							    otherwise). */}
							<Row label="Team">
								<Plain>
									{contract.teammates === undefined
										? "Unlimited teammates"
										: `${contract.teammates} ${contract.teammates === 1 ? "teammate" : "teammates"} + the owner`}
									{contract.broadcastQuota !== undefined ? (
										<Muted>
											{" "}
											· {contract.broadcastQuota.toLocaleString("en")}{" "}
											broadcasts/mo
										</Muted>
									) : null}
								</Plain>
							</Row>
							<Row label="Overage">
								<Plain>
									{formatPrice(contract.overageRateMinor, contract.currency)}
									<Muted>
										{" "}
										a credit · blocks of{" "}
										{contract.blockSize.toLocaleString("en")} ={" "}
										{formatPrice(
											enterpriseBlockPrice(contract),
											contract.currency,
										)}
									</Muted>
								</Plain>
							</Row>
							<Row label="Contact">
								<Plain>{contract.contactName}</Plain>
							</Row>
							{contract.notes ? (
								<Row label="Notes">
									<Plain muted className="whitespace-normal">
										{contract.notes}
									</Plain>
								</Row>
							) : null}
							<Row label="Since">
								<Plain>{formatShortDate(contract.setAt)}</Plain>
							</Row>
							{movingToPro ? (
								<Row label="Ending">
									<Plain>
										{moveBill ? (
											<>
												Moving to Pro — billed as {moveBill.invoiceNumber}
												<Muted> · the contract ends when it's paid</Muted>
											</>
										) : (
											<>
												Moves to Pro{" "}
												{seller.currentPeriodEnd
													? `on ${formatShortDate(seller.currentPeriodEnd)}`
													: "at renewal"}
											</>
										)}
									</Plain>
								</Row>
							) : null}
						</>
					) : (
						<>
							<Row label="Contract">
								<Plain muted>None — on list pricing</Plain>
							</Row>
							{/* An open lead (the owner tapped "Talk to Arif") sits right
							    where the answer lives: attach a contract, or dismiss the
							    ask. Cleared automatically the moment a contract lands. */}
							{seller.enterpriseInterestAt !== undefined ? (
								<Row label="Asked for it">
									<Plain>
										<span className="font-medium text-accent-emphasis">
											Wants Enterprise
										</span>
										<Muted>
											{" "}
											· {describeDays(seller.enterpriseInterestAt, now)}
										</Muted>
										<button
											type="button"
											onClick={() => void dismissLead()}
											className="ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
										>
											Dismiss
										</button>
									</Plain>
								</Row>
							) : null}
						</>
					)}
					<div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap">
						<Button
							ref={enterpriseButtonRef}
							variant="outline"
							onClick={() => setPage("enterprise")}
							disabled={!contract && contractRefusal !== null}
							className="tap-target w-full rounded-xl sm:w-fit"
						>
							<Building2 data-icon="inline-start" aria-hidden="true" />
							{contract ? "Edit contract" : "Put on an Enterprise contract"}
						</Button>
						{contract ? (
							movingToPro ? (
								<Button
									variant="outline"
									onClick={stayOnContract}
									className="tap-target w-full rounded-xl sm:w-fit"
								>
									Call off the move to Pro
								</Button>
							) : (
								<Button
									variant="outline"
									onClick={() => setConfirmMove(true)}
									disabled={moveRefusal !== null}
									className="tap-target w-full rounded-xl sm:w-fit"
								>
									Move to Pro at renewal
								</Button>
							)
						) : null}
					</div>
					{!contract && contractRefusal ? (
						<p className="pt-1.5 text-xs text-muted-foreground">
							{contractRefusal}
						</p>
					) : null}
					{contract && moveRefusal ? (
						<p className="pt-1.5 text-xs text-muted-foreground">
							{moveRefusal}
						</p>
					) : null}
				</Section>
				<ConfirmDialog
					open={confirmMove}
					onOpenChange={setConfirmMove}
					title={`Move ${seller.storeName} to Pro?`}
					description={`The contract carries on until ${seller.currentPeriodEnd ? formatShortDate(seller.currentPeriodEnd) : "the end of the paid period"}. That renewal bills Pro instead — a ${moveCycle === "annual" ? "year" : "month"} of it${moveProPrice ? ` (${moveProPrice})` : ""}, on the contract's own term — the contract ends when it's paid, and from the next month the store has Pro's credits and seats (teammates past Pro's limit are removed, each emailed).`}
					confirmLabel="Move to Pro at renewal"
					onConfirm={moveToPro}
				/>

				<Section title="How they arrived">
					{/* "Joined" is a seller's own act. A pre-built store was BUILT —
					    by us, before anyone joined — and saying "joined" of a store
					    nobody owns yet is the kind of quietly wrong line that makes
					    an admin trust the rest of the sheet less. */}
					<Row label={seller.unclaimed ? "Built" : "Joined"}>
						<Plain>
							{formatShortDate(seller.createdAt)}
							<Muted> · {describeDays(seller.createdAt, now)}</Muted>
						</Plain>
					</Row>
					{/* Shown for a pre-built store either way round: while it waits,
					    this is the row an admin came to read; once claimed, it is the
					    only remaining trace that the store did not start life owned
					    (the placeholder owner id is overwritten at claim). */}
					{seller.unclaimed || seller.claimedAt !== undefined ? (
						<Row label="Handover">
							{seller.claimedAt !== undefined ? (
								<Plain>
									Claimed {formatShortDate(seller.claimedAt)}
									<Muted> · {describeDays(seller.claimedAt, now)}</Muted>
								</Plain>
							) : seller.pendingOwnerEmail ? (
								<Plain>
									Waiting for {seller.pendingOwnerEmail}
									<Muted> · they claim it by signing up with it</Muted>
								</Plain>
							) : (
								<Plain muted>
									No handover email yet — nobody can claim this store until one
									is set
								</Plain>
							)}
						</Row>
					) : null}
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

			<div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-border bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
				<span className="text-xs text-muted-foreground">
					{/* Names what's actually in the menu here — the dev reset
					    exists only where the purge is enabled. */}
					{purgeEnabled
						? "Comp, highlights, hiding from /stores and the dev reset live under Manage."
						: "Comp, highlights and hiding from /stores live under Manage."}
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
