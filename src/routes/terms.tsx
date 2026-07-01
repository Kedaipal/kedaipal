import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "../components/legal/legal-layout";
import { LEGAL_CONTACT_EMAIL, TERMS_VERSION } from "../lib/legal";

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

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					5. WhatsApp and Third-Party Services
				</h2>
				<p>
					The Service uses the WhatsApp Business Platform provided by Meta and
					other third-party providers (including Convex, Clerk, and Cloudflare).
					Your use of the Service is also subject to the terms and policies of
					those providers. Kedaipal is not responsible for the availability or
					performance of third-party services.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					6. Acceptable Use
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
					7. Intellectual Property
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
					8. Disclaimers
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
					9. Limitation of Liability
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
					10. Termination
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
					11. Governing Law
				</h2>
				<p>
					These Terms are governed by the laws of Malaysia, without regard to
					conflict of law principles. Any disputes will be subject to the
					exclusive jurisdiction of the courts of Malaysia.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					12. Changes to These Terms
				</h2>
				<p>
					We may update these Terms from time to time. The "Last updated" date
					at the top of this page will reflect the most recent version.
					Continued use of the Service after changes take effect means you
					accept the updated Terms.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">13. Contact</h2>
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
