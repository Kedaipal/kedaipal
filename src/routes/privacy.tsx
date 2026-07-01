import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "../components/legal/legal-layout";
import { LEGAL_CONTACT_EMAIL, PRIVACY_VERSION } from "../lib/legal";

const SEO_TITLE = "Privacy Policy — Kedaipal";
const SEO_DESC =
	"How Kedaipal collects, uses, and protects information from retailers and shoppers using our WhatsApp order hub.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/privacy`;
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const Route = createFileRoute("/privacy")({
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
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<LegalLayout
			title="Privacy Policy"
			lastUpdated={PRIVACY_VERSION}
			summary={[
				"We collect retailer account details, catalog and order data, shopper contact details (mainly WhatsApp number), and basic technical data.",
				"We use it to run the Service, deliver order updates over WhatsApp, and keep accounts secure — we never sell personal data.",
				"We share data only with the service providers listed below that help us operate (e.g. Convex, Clerk, Meta, Stripe, HitPay).",
				"You have rights under Malaysia's Personal Data Protection Act 2010 (PDPA), including access, correction, and withdrawal of consent.",
				`Questions or data requests? Email ${LEGAL_CONTACT_EMAIL}.`,
			]}
		>
			<section className="space-y-3">
				<p>
					This Privacy Policy explains how Kedaipal ("Kedaipal", "we", "our", or
					"us") collects, uses, and shares information when you use our
					services, including the retailer dashboard, hosted storefronts, and
					WhatsApp ordering flow (collectively, the "Service").
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					1. Information We Collect
				</h2>
				<p>
					<strong>Retailer account information.</strong> When a retailer signs
					up, we collect name, email address, authentication identifiers (via
					Clerk), store name, store slug, WhatsApp number, and profile
					preferences. We also record when you accept our Terms, Privacy Policy,
					and Acceptable Use Policy, including the version accepted and the time
					of acceptance.
				</p>
				<p>
					<strong>Catalog and order data.</strong> We store product information,
					inventory, and orders that retailers create or that are placed through
					our storefronts.
				</p>
				<p>
					<strong>Shopper information.</strong> When a shopper places an order,
					we collect the items ordered, the shopper's WhatsApp number (required
					for order confirmation), a name and delivery address where provided,
					and any notes they include. We do not require shoppers to create an
					account.
				</p>
				<p>
					<strong>Messaging data.</strong> When messages are exchanged with the
					Kedaipal WhatsApp number, we process the message contents and
					associated metadata to deliver the ordering flow.
				</p>
				<p>
					<strong>Technical data.</strong> We collect basic technical
					information such as IP address, browser type, device type, and log
					data for security and debugging.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					2. How We Use Information
				</h2>
				<ul className="list-disc space-y-2 pl-6">
					<li>To operate and maintain the Service.</li>
					<li>To authenticate retailers and protect accounts.</li>
					<li>
						To process orders and send order confirmations and status updates
						via WhatsApp.
					</li>
					<li>
						To debug issues, monitor performance, and improve the Service.
					</li>
					<li>
						To communicate with retailers about the Service and changes to it.
					</li>
					<li>To comply with legal obligations.</li>
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					3. How We Share Information (Data Processors)
				</h2>
				<p>
					We do not sell personal information. We share information only with
					service providers that process data on our behalf to help us run the
					Service:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>Meta Platforms (WhatsApp Cloud API)</strong> — to send and
						receive WhatsApp messages.
					</li>
					<li>
						<strong>Convex</strong> — database, backend functions, and scheduled
						jobs.
					</li>
					<li>
						<strong>Clerk</strong> — retailer authentication and account
						management.
					</li>
					<li>
						<strong>Cloudflare</strong> — hosting, CDN, and DDoS protection.
					</li>
					<li>
						<strong>Stripe</strong> and <strong>HitPay</strong> — subscription
						billing and payment processing for retailer plans.
					</li>
					<li>
						<strong>Resend</strong> — transactional email (e.g. order and
						account notifications).
					</li>
					<li>
						<strong>PostHog</strong> — product analytics to understand and
						improve usage.
					</li>
					<li>
						<strong>Calendly</strong> — scheduling onboarding and support calls.
					</li>
				</ul>
				<p>
					We may also disclose information if required by law, or to protect the
					rights, safety, or property of Kedaipal, our users, or others.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					4. Cookies and Similar Technologies
				</h2>
				<p>
					We use cookies and similar technologies that are strictly necessary to
					operate the Service, including authenticating retailer sessions and
					remembering cart contents on the storefront. We do not use advertising
					or cross-site tracking cookies.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					5. Data Retention
				</h2>
				<p>
					We retain retailer account data for as long as the account is active.
					Order and messaging data is retained as long as reasonably necessary
					to provide the Service and meet legal obligations. You may request
					deletion of your account at any time.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					6. Your Rights Under the PDPA (Malaysia)
				</h2>
				<p>
					Kedaipal handles personal data in accordance with Malaysia's Personal
					Data Protection Act 2010 (PDPA). Subject to applicable law, you have
					the right to:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>Access</strong> the personal data we hold about you.
					</li>
					<li>
						<strong>Correct</strong> inaccurate or incomplete personal data.
					</li>
					<li>
						<strong>Withdraw consent</strong> to our processing of your personal
						data, and limit how it is processed.
					</li>
					<li>
						<strong>Request deletion</strong> of your data where we are not
						required to retain it.
					</li>
				</ul>
				<p>
					<strong>Retailers</strong> act as the data user for their own
					shoppers' personal data and are responsible for responding to their
					customers' PDPA requests. Kedaipal processes that data on the
					retailer's behalf. To exercise any of these rights with Kedaipal,
					contact us at{" "}
					<a
						href={`mailto:${LEGAL_CONTACT_EMAIL}`}
						className="underline hover:text-foreground"
					>
						{LEGAL_CONTACT_EMAIL}
					</a>
					.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">7. Security</h2>
				<p>
					We use reasonable administrative, technical, and physical safeguards
					to protect information. No method of transmission or storage is 100%
					secure, and we cannot guarantee absolute security.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					8. Children's Privacy
				</h2>
				<p>
					The Service is not directed to or intended for use by anyone under 18,
					and we do not knowingly collect personal information from children.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					9. International Transfers
				</h2>
				<p>
					Kedaipal operates from Malaysia and our service providers may process
					data in other countries. By using the Service, you consent to such
					transfers where permitted by law.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					10. Changes to This Policy
				</h2>
				<p>
					We may update this Privacy Policy from time to time. We will update
					the "Last updated" date at the top of this page when we do. Continued
					use of the Service after changes take effect means you accept the
					updated policy.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">11. Contact</h2>
				<p>
					If you have questions about this Privacy Policy or wish to exercise
					your data rights, contact us at{" "}
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
