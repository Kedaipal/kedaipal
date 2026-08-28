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
				"We collect retailer account details, catalog and order data, shopper contact details (mainly WhatsApp number), basic technical data, and masked recordings of how our pages are used.",
				"We use it to run the Service, deliver order updates over WhatsApp, and keep accounts secure — we never sell personal data.",
				"We share data only with the service providers listed below that help us operate (e.g. Convex, Clerk, Meta, HitPay, Lalamove, Google).",
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
				<p>
					<strong>Usage analytics and session recordings.</strong> We use
					third-party analytics that record how our pages are used — page views,
					clicks and taps, scrolling, and a replay of on-screen activity —
					alongside the page address, browser, and device. Recordings mask what
					you type into forms, and we additionally mask the areas of the retailer
					dashboard that display customer names, phone numbers, addresses, and
					notes. We do not record the buyer order-tracking pages at all, and
					our analytics tools never receive those pages' addresses.
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
						<strong>HitPay</strong> — online payments, processed through the
						retailer's own HitPay account (Kedaipal never holds order money).
						When a shopper pays online, HitPay receives the order amount and
						reference together with the shopper's name and phone number, and
						collects the shopper's email address on its own checkout page under
						its own privacy policy.
					</li>
					<li>
						<strong>Lalamove</strong> — rider delivery, booked through the
						retailer's own Lalamove account. For orders dispatched with a
						rider, Lalamove receives the delivery contact's name, phone number,
						and address.
					</li>
					<li>
						<strong>Google</strong> — address search at checkout (Google
						Places, which processes the address text a shopper types in order
						to suggest and pin it) and Google Analytics (aggregate usage
						measurement).
					</li>
					<li>
						<strong>Resend</strong> — transactional email (e.g. order and
						account notifications).
					</li>
					<li>
						<strong>Microsoft Clarity</strong> — session replays and heatmaps to
						diagnose usability issues and improve the interface.
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
					Some of the cookies and similar technologies we use are strictly
					necessary to operate the Service, including authenticating retailer
					sessions and remembering cart contents on the storefront.
				</p>
				<p>
					We also use analytics cookies set by Google Analytics and Microsoft
					Clarity. These recognise a returning browser so we can measure usage
					and replay sessions to diagnose usability problems; Microsoft Clarity's
					identifiers persist for up to one year. They are not strictly
					necessary, and we do not use advertising or cross-site tracking
					cookies.
				</p>
				<p>
					Your browser also stores some data locally on your device, which is
					not sent to us: storefront cart contents, and — if you place a
					delivery order — the delivery address you entered, kept on your device
					so your next checkout can prefill it. Clearing your browser's site
					data removes these.
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
					shoppers' personal data — order history, contact details, and notes —
					and are responsible for responding to their customers' PDPA requests;
					Kedaipal processes that data on the retailer's behalf. For some
					processing Kedaipal decides the purpose itself and acts as the data
					user: our own usage analytics, and the platform-wide WhatsApp opt-out
					list (replying STOP applies across every store on our shared number).
				</p>
				<p>
					Kedaipal's operating company is incorporated in Singapore, so
					alongside the Malaysian PDPA we also honour Singapore's Personal Data
					Protection Act 2012. To exercise any of these rights with Kedaipal,
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
					Kedaipal serves sellers and shoppers in Malaysia, and our service
					providers process data in other countries, including the United
					States. By using the Service, you consent to such transfers where
					permitted by law.
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
					Our designated Data Protection Officer is Arif Rahman. If you have
					questions about this Privacy Policy or wish to exercise your data
					rights, contact us at{" "}
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
