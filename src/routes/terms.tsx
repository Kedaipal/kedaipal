import { createFileRoute, Link } from "@tanstack/react-router";
import {
	PURCHASED_CREDIT_LIFETIME_MONTHS,
	SELLER_CANCEL_REFUNDS_PER_PERIOD,
} from "../../convex/lib/plans";
import { LegalLayout } from "../components/legal/legal-layout";
import {
	LEGAL_CONTACT_EMAIL,
	PRIVACY_ANCHOR,
	TERMS_ANCHOR,
	TERMS_VERSION,
} from "../lib/legal";

const SEO_TITLE = "Terms & Conditions — Kedaipal";
const SEO_DESC =
	"The terms that govern use of Kedaipal's WhatsApp order hub for retailers and shoppers.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/terms`;
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const Route = createFileRoute("/terms")({
	head: () => ({
		meta: [
			{ title: SEO_TITLE },
			{ name: "description", content: SEO_DESC },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: PAGE_URL },
			{ property: "og:title", content: SEO_TITLE },
			{ property: "og:description", content: SEO_DESC },
			{ property: "og:image", content: OG_IMAGE },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: SEO_TITLE },
			{ name: "twitter:description", content: SEO_DESC },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		links: [{ rel: "canonical", href: PAGE_URL }],
	}),
	component: TermsPage,
});

function TermsPage() {
	return (
		<LegalLayout
			title="Terms & Conditions"
			lastUpdated={TERMS_VERSION}
			summary={[
				"Kedaipal is a tool that helps retailers take WhatsApp orders — it's provided “as is”.",
				"You're responsible for what you sell, your prices, and treating your customers fairly and lawfully.",
				"Orders and payments are between you and your shoppers; Kedaipal is not a party to the sale.",
				"Your plan includes Kedaipal Credits — 1 credit covers 1 order. Credits aren't money and can't be cashed out, and your storefront never pauses when they run out.",
				"You control your shoppers' data; we process it for you, keep it secure, and tell you promptly if it's ever breached.",
				<>
					Your use is also governed by our{" "}
					<Link to="/privacy" className="underline hover:text-foreground">
						Privacy Policy
					</Link>{" "}
					and{" "}
					<Link
						to="/acceptable-use"
						className="underline hover:text-foreground"
					>
						Acceptable Use Policy
					</Link>
					.
				</>,
				"We can suspend accounts that break these terms; these terms are governed by Malaysian law.",
			]}
		>
			<section className="space-y-3">
				<p>
					These Terms &amp; Conditions ("Terms") govern your access to and use
					of Kedaipal ("Kedaipal", "we", "our", or "us"), including our retailer
					dashboard, hosted storefronts, and WhatsApp ordering flow
					(collectively, the "Service"). By using the Service, you agree to
					these Terms. If you do not agree, do not use the Service.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					1. Service Availability
				</h2>
				<p>
					The Service is offered "as is" and may change, become unavailable, or
					be discontinued at any time without notice. Features, pricing, and
					functionality are subject to change. No service level agreement
					applies.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">2. Accounts</h2>
				<p>
					Retailers must create an account to use the dashboard. You are
					responsible for keeping your credentials secure and for all activity
					that occurs under your account. You must provide accurate information
					and promptly update it when it changes.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					3. Retailer Responsibilities
				</h2>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Provide accurate product descriptions, pricing, inventory, and
						fulfillment information.
					</li>
					<li>
						Only sell goods and services that are lawful in the retailer's
						jurisdiction and the jurisdictions of its customers.
					</li>
					<li>Respond to shopper orders and inquiries in a timely manner.</li>
					<li>
						Comply with all applicable laws, including consumer protection, tax,
						and WhatsApp Business policies.
					</li>
					<li>
						Handle shopper personal data in accordance with applicable privacy
						laws.
					</li>
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					4. Shoppers and Orders
				</h2>
				<p>
					Kedaipal provides tools that help retailers list products and receive
					orders via WhatsApp. Kedaipal is not a party to the transaction
					between retailers and shoppers. Orders, payments, fulfillment,
					returns, and any related disputes are solely between the retailer and
					the shopper.
				</p>
			</section>

			{/* Drafted from Arif's bullets (Terms ticket z8r3fdf90k) + Zaki's
			    30 Sep 2026 refund rule, for Arif's or a lawyer's sign-off
			    (Credits T5, z8r3fdfu31). Every mechanic stated here is one the
			    ledger enforces (docs/credits.md) — change one, change both. */}
			<section id={TERMS_ANCHOR.credits} className="scroll-mt-24 space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					5. Kedaipal Credits
				</h2>
				<p>
					Your plan includes Kedaipal Credits each month, and you can buy more.
					This section explains what credits are and how they work.
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>What a credit is.</strong> A credit is a prepaid unit of the
						Service. One credit covers one order taken through your store, on
						any channel. If we introduce other services priced in credits, we
						will publish their price in credits before you can use them.
					</li>
					<li>
						<strong>Credits are not money.</strong> Credits are not money,
						e-money or stored value. They cannot be exchanged or redeemed for
						cash, and they are not refunded, except where Kedaipal decides, at
						its discretion, to adjust your account in credits.
					</li>
					<li>
						<strong>They stay with your account.</strong> Credits belong to the
						store account they were granted to or bought for. They cannot be
						transferred, sold or moved to another account.
					</li>
					<li>
						<strong>Only for Kedaipal's own services.</strong> Credits can only
						be used for services Kedaipal itself provides and bills — never to
						pay for a third party's service, such as courier or rider fees,
						payment gateway fees, or messaging charges billed by another
						provider.
					</li>
					<li>
						<strong>Plan credits.</strong> Your plan's credits are granted each
						month and reset at the start of each calendar month (Malaysia time);
						unused plan credits do not roll over. On an annual plan, credits are
						still granted monthly, never all at once, at the number in force
						when you paid, for the year you paid for.
					</li>
					<li>
						<strong>Purchased credits.</strong> Credits you buy expire{" "}
						{PURCHASED_CREDIT_LIFETIME_MONTHS} months after purchase, and the
						expiry date is shown when you buy them. Your plan credits are used
						first; purchased credits after them, those closest to expiry first.
					</li>
					<li>
						<strong>When a credit is used, and when it comes back.</strong> A
						credit is used when an order is created. It comes back only when the
						order never got going: a booking request that expires unanswered, an
						unpaid claim-link order that passes its payment deadline, an order
						the buyer withdraws, or a new order you cancel before accepting it
						(up to {SELLER_CANCEL_REFUNDS_PER_PERIOD} such cancellations a
						month). An order you have accepted keeps its credit, even if it is
						later cancelled or refunded.
					</li>
					<li>
						<strong>Your balance can go below zero.</strong> We never refuse an
						order because of your balance, so it may fall below zero. A negative
						balance is settled from the next credits your account receives —
						your next monthly credits or your next purchased credits, whichever
						comes first.
					</li>
					<li>
						<strong>Your storefront never pauses.</strong> Kedaipal never
						rejects or blocks a buyer's order because of your credit balance.
					</li>
					<li>
						<strong>What pauses at zero.</strong> While your balance is at or
						below zero, we may restrict your account: you may be unable to add
						or edit products, or to handle orders — accepting them, changing
						their status, marking them paid, booking deliveries, and sending
						invoices and receipts. Viewing orders, cancelling and refunding
						them, topping up and upgrading your plan are never restricted. The
						restriction lifts as soon as your balance is above zero.
					</li>
					<li>
						<strong>Automatic top-up.</strong> Automatic top-up is off unless
						you turn it on. If you do, you authorise Kedaipal to charge your
						saved payment method, as a merchant-initiated payment, whenever your
						balance reaches the trigger you chose. The trigger, the amount of
						each top-up and a monthly limit are shown when you give your
						consent, and you can turn it off at any time. You get a receipt for
						every charge, and if a charge fails we retry it once.
					</li>
					<li>
						<strong>Price changes.</strong> We may change credit prices — what a
						pack costs, or how many credits a service uses — with 30 days'
						notice. Credits you have already bought keep their value in credits.
					</li>
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					6. WhatsApp and Third-Party Services
				</h2>
				<p>
					The Service uses the WhatsApp Business Platform provided by Meta and
					other third-party providers (including Convex, Clerk, and Cloudflare).
					Your use of the Service is also subject to the terms and policies of
					those providers. Kedaipal is not responsible for the availability or
					performance of third-party services.
				</p>
			</section>

			{/* Drafted from Arif's bullets (z8r3fdf90k) for his or a lawyer's
			    sign-off (Credits T5). Sub-processors are named by CATEGORY and
			    link to the Privacy Policy's list — the one place each is named,
			    so the two documents can't drift. */}
			<section
				id={TERMS_ANCHOR.dataProcessing}
				className="scroll-mt-24 space-y-3"
			>
				<h2 className="text-2xl font-semibold tracking-tight">
					7. Data Processing
				</h2>
				<p>
					This section covers the personal data about your shoppers — names,
					phone numbers, addresses, order details and messages — that Kedaipal
					processes to run your store ("Shopper Data").
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>Who controls it.</strong> You are the controller of Shopper
						Data — the "data user" under Malaysia's Personal Data Protection Act
						2010, and the organisation responsible for it under Singapore's
						Personal Data Protection Act 2012. Kedaipal processes it on your
						behalf and on your instructions, which are these Terms and the way
						you set up and use the Service, as your data processor (a "data
						intermediary" under Singapore law). The few things Kedaipal decides
						for itself, such as the platform-wide WhatsApp opt-out list, are
						described in our{" "}
						<Link to="/privacy" className="underline hover:text-foreground">
							Privacy Policy
						</Link>
						.
					</li>
					<li>
						<strong>Security.</strong> We protect Shopper Data with reasonable
						security measures against loss, misuse, unauthorised access,
						disclosure, alteration and destruction — as Malaysia's PDPA Security
						Principle requires of data processors, which it has applied to
						directly since 1 June 2025, and as Singapore's PDPA requires of data
						intermediaries. We keep Shopper Data only as long as we need it to
						provide the Service to you, or as the law requires.
					</li>
					<li>
						<strong>If there is a breach.</strong> If we become aware of a data
						breach affecting Shopper Data, we will notify you without undue
						delay, with the information we have, so that you can meet your own
						obligations as its controller — including assessing the breach and
						notifying the authorities and affected shoppers where the law
						requires.
					</li>
					<li>
						<strong>Who helps us run it.</strong> We use sub-processors for
						cloud hosting and databases, messaging (including the WhatsApp
						Business Platform and email), payments and delivery. The current
						list, and what each one receives, is in our{" "}
						<Link
							to="/privacy"
							hash={PRIVACY_ANCHOR.processors}
							className="underline hover:text-foreground"
						>
							Privacy Policy
						</Link>
						.
					</li>
					<li>
						<strong>Where it is kept.</strong> Kedaipal is operated by Kedaipal
						Pte Ltd (UEN 202630712C), a company incorporated in Singapore.
						Shopper Data is hosted and processed by our cloud providers outside
						Malaysia, including in the United States. We transfer it only to
						providers that protect it to a standard comparable to Malaysia's and
						Singapore's personal data protection laws.
					</li>
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					8. Acceptable Use
				</h2>
				<p>
					Kedaipal sends messages through a shared WhatsApp Business Account
					that we own and manage, so misuse by one retailer can affect every
					retailer on the platform. Your use of the Service must comply with our{" "}
					<Link
						to="/acceptable-use"
						className="underline hover:text-foreground"
					>
						Acceptable Use Policy
					</Link>
					, which is incorporated into these Terms. In particular, you must not:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Use the Service for any unlawful, fraudulent, or harmful purpose.
					</li>
					<li>
						Sell illegal, counterfeit, or restricted goods through the Service.
					</li>
					<li>
						Send spam, bulk unsolicited messages, or content that violates
						WhatsApp Business policies.
					</li>
					<li>
						Attempt to gain unauthorized access to the Service, interfere with
						its operation, or reverse engineer it.
					</li>
					<li>
						Upload content that infringes intellectual property or privacy
						rights of others.
					</li>
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					9. Intellectual Property
				</h2>
				<p>
					Kedaipal and its licensors retain all rights to the Service, including
					software, design, and branding. Retailers retain ownership of the
					product content they upload and grant Kedaipal a limited license to
					host and display that content as necessary to operate the Service.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					10. Disclaimers
				</h2>
				<p>
					THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES
					OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
					MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
					NON-INFRINGEMENT. KEDAIPAL DOES NOT WARRANT THAT THE SERVICE WILL BE
					UNINTERRUPTED, ERROR-FREE, OR SECURE.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					11. Limitation of Liability
				</h2>
				<p>
					TO THE MAXIMUM EXTENT PERMITTED BY LAW, KEDAIPAL WILL NOT BE LIABLE
					FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
					DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL,
					ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					12. Termination
				</h2>
				<p>
					You may stop using the Service at any time. We may suspend or
					terminate access to the Service at our discretion, including for
					violation of these Terms or the Acceptable Use Policy. Sections that
					by their nature should survive termination will continue to apply.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					13. Governing Law
				</h2>
				<p>
					These Terms are governed by the laws of Malaysia, without regard to
					conflict of law principles. Any disputes will be subject to the
					exclusive jurisdiction of the courts of Malaysia.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					14. Changes to These Terms
				</h2>
				<p>
					We may update these Terms from time to time. The "Last updated" date
					at the top of this page will reflect the most recent version.
					Continued use of the Service after changes take effect means you
					accept the updated Terms.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">15. Contact</h2>
				<p>
					If you have questions about these Terms, contact us at{" "}
					<a
						href={`mailto:${LEGAL_CONTACT_EMAIL}`}
						className="underline hover:text-foreground"
					>
						{LEGAL_CONTACT_EMAIL}
					</a>
					.
				</p>
			</section>
		</LegalLayout>
	);
}
