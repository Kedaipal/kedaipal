// WhatsApp Cloud API client. fetch-based — works inside default Convex runtime.
// Reads credentials from process.env at call time so tests can stub via globalThis.fetch.

const GRAPH_VERSION = "v21.0";

type WaCredentials = {
	accessToken: string;
	phoneNumberId: string;
};

function readCredentials(): WaCredentials {
	const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
	const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
	if (!accessToken || !phoneNumberId) {
		throw new Error(
			"WhatsApp credentials missing: set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID",
		);
	}
	return { accessToken, phoneNumberId };
}

/**
 * The Meta-approved utility template for the storefront order-confirmation
 * push (86eyf1rck) — `order_confirmation_utility` in production. Unset ⇒ the
 * push path is INACTIVE and storefront checkout degrades to the legacy
 * buyer-sends-first wa.me handoff, so the code ships decoupled from template
 * approval. Read at call time (same posture as readCredentials) so tests can
 * stub via process.env.
 */
export function orderConfirmTemplateName(): string | undefined {
	const name = process.env.WHATSAPP_ORDER_CONFIRM_TEMPLATE;
	return name && name.trim().length > 0 ? name.trim() : undefined;
}

/**
 * Collapse a value into a safe WhatsApp TEMPLATE parameter.
 *
 * Meta rejects parameters containing newlines, tabs, or 4+ consecutive spaces,
 * and `classifyPushFailure` treats that rejection (132007) as TERMINAL — so one
 * pasted tab in a buyer's name kills the send outright, with no retry. The risk
 * is real for any buyer-controlled string: `sanitizeCustomerName` trims the ends
 * but never the interior, and a WhatsApp pushname is whatever the buyer typed
 * into their own profile. A whitespace-only value degenerates to the caller's
 * fallback rather than an empty param (also a Meta rejection).
 *
 * Every buyer- or seller-authored string entering `bodyParams` goes through
 * this — it is the one choke point, so a new template can't reintroduce the bug.
 */
export function templateParam(
	raw: string | undefined | null,
	fallback: string,
): string {
	return (raw ?? "").replace(/\s+/g, " ").trim() || fallback;
}

/**
 * Claim links (86eyq0epn) — the Meta-approved utility template that hands the
 * buyer their price-locked checkout link. Same env-gating posture as the
 * confirm template: unset ⇒ WhatsApp sends are unavailable and the seller
 * falls back to the copyable wa.me link the claims UI always offers, so the
 * code ships decoupled from Meta template review. The registered button URL
 * base must be `https://kedaipal.com/claim/{{1}}`, added via Meta's
 * **Add variable** control (never hand-typed braces — the 86eyheqzv lesson;
 * the pre-router placeholder rescue covers a mis-registration either way).
 */
export function claimLinkTemplateName(): string | undefined {
	const name = process.env.WHATSAPP_CLAIM_LINK_TEMPLATE;
	return name && name.trim().length > 0 ? name.trim() : undefined;
}

/**
 * Seller WhatsApp order alerts (86eyhw9zy) — the Meta-approved utility
 * templates that notify the SELLER's own number (sellers have no open service
 * window with the shared WABA, so free-form text can't reach them). Same
 * env-gating posture as the buyer confirm template above: unset ⇒ that alert
 * is silently unavailable (settings card hidden, sends skipped), so the code
 * ships decoupled from Meta template review.
 */
export function sellerNewOrderTemplateName(): string | undefined {
	const name = process.env.WHATSAPP_SELLER_NEW_ORDER_TEMPLATE;
	return name && name.trim().length > 0 ? name.trim() : undefined;
}

/** See sellerNewOrderTemplateName — the buyer-says-they've-paid sibling. */
export function sellerPaymentClaimTemplateName(): string | undefined {
	const name = process.env.WHATSAPP_SELLER_PAYMENT_CLAIM_TEMPLATE;
	return name && name.trim().length > 0 ? name.trim() : undefined;
}

/**
 * See sellerNewOrderTemplateName — the money-actually-landed sibling, fired by
 * the HitPay gateway receive (86eyd63r8). Deliberately a THIRD template rather
 * than a reuse of the claim one: a claim asks the seller to go check their bank
 * and confirm, while a settled gateway payment has already auto-confirmed the
 * order and needs nothing from them. Sending "please verify" on a payment we
 * verified ourselves manufactures work that doesn't exist.
 *
 * Body params are the claim template's exact three — {{1}} customer, {{2}}
 * shortId, {{3}} money — so the two stay interchangeable at the call site.
 */
export function sellerPaymentReceivedTemplateName(): string | undefined {
	const name = process.env.WHATSAPP_SELLER_PAYMENT_RECEIVED_TEMPLATE;
	return name && name.trim().length > 0 ? name.trim() : undefined;
}

/**
 * A failed Cloud API send, carrying the machine-readable bits a caller needs to
 * decide whether retrying could ever help: the HTTP status and Meta's own error
 * code. Without these a caller can only regex the message text, and the two
 * cases are opposite — a 503 deserves a retry, a `131026` (recipient not on
 * WhatsApp) never will. `responded: false` means the request never produced a
 * response at all (DNS/TLS/abort), so no message can have been sent — the only
 * case where retrying is guaranteed free of double-send risk.
 */
export class WhatsAppSendError extends Error {
	readonly httpStatus?: number;
	readonly metaCode?: number;
	readonly responded: boolean;
	constructor(
		message: string,
		opts: { httpStatus?: number; metaCode?: number; responded: boolean },
	) {
		super(message);
		this.name = "WhatsAppSendError";
		this.httpStatus = opts.httpStatus;
		this.metaCode = opts.metaCode;
		this.responded = opts.responded;
	}
}

/**
 * POST one message payload to the Cloud API. Returns Meta's message id
 * (`wamid…`) when the response carries one — the ONLY key the `statuses`
 * webhook later identifies the message by, so delivery-failure handling
 * (typo'd number → failed confirmation push) depends on capturing it here.
 *
 * Throws `WhatsAppSendError` on failure so callers can classify retryability.
 */
async function postMessage(
	payload: Record<string, unknown>,
): Promise<string | undefined> {
	const { accessToken, phoneNumberId } = readCredentials();
	const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
	} catch (err) {
		// Never reached Meta (network/DNS/TLS/abort) — nothing was sent.
		throw new WhatsAppSendError(
			`WhatsApp send failed before response: ${
				err instanceof Error ? err.message : String(err)
			}`,
			{ responded: false },
		);
	}
	if (!res.ok) {
		const body = await res.text();
		let metaCode: number | undefined;
		try {
			const parsed = JSON.parse(body) as { error?: { code?: unknown } };
			const code = parsed?.error?.code;
			if (typeof code === "number") metaCode = code;
		} catch {
			// Non-JSON error body (proxy/gateway HTML) — status alone classifies it.
		}
		throw new WhatsAppSendError(
			`WhatsApp send failed (${res.status}): ${body}`,
			{ httpStatus: res.status, metaCode, responded: true },
		);
	}
	try {
		const body = (await res.json()) as {
			messages?: Array<{ id?: unknown }>;
		};
		const id = body?.messages?.[0]?.id;
		return typeof id === "string" ? id : undefined;
	} catch {
		// A 2xx with an unparseable body — the send succeeded, we just can't
		// correlate its statuses webhook later. Never fail the send over it.
		return undefined;
	}
}

export async function sendText(toPhone: string, body: string): Promise<void> {
	await postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "text",
		text: { preview_url: false, body },
	});
}

export async function sendImage(
	toPhone: string,
	imageLink: string,
	caption?: string,
): Promise<void> {
	await postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "image",
		image: {
			link: imageLink,
			...(caption ? { caption } : {}),
		},
	});
}

export async function sendDocument(
	toPhone: string,
	documentLink: string,
	filename?: string,
	caption?: string,
): Promise<void> {
	await postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "document",
		document: {
			link: documentLink,
			...(filename ? { filename } : {}),
			...(caption ? { caption } : {}),
		},
	});
}

export async function sendCtaUrlButton(
	toPhone: string,
	body: string,
	buttonText: string,
	url: string,
): Promise<void> {
	await postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "interactive",
		interactive: {
			type: "cta_url",
			body: { text: body },
			action: {
				name: "cta_url",
				parameters: { display_text: buttonText, url },
			},
		},
	});
}

export async function sendCtaUrlWithImage(
	toPhone: string,
	imageLink: string,
	body: string,
	buttonText: string,
	url: string,
): Promise<void> {
	await postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "interactive",
		interactive: {
			type: "cta_url",
			header: { type: "image", image: { link: imageLink } },
			body: { text: body },
			action: {
				name: "cta_url",
				parameters: { display_text: buttonText, url },
			},
		},
	});
}

export async function sendTemplate(
	toPhone: string,
	templateName: string,
	languageCode: string,
	components?: ReadonlyArray<Record<string, unknown>>,
): Promise<string | undefined> {
	return postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "template",
		template: {
			name: templateName,
			language: { code: languageCode },
			...(components ? { components } : {}),
		},
	});
}

