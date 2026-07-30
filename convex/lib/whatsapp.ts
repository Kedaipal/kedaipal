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
 * POST one message payload to the Cloud API. Returns Meta's message id
 * (`wamid…`) when the response carries one — the ONLY key the `statuses`
 * webhook later identifies the message by, so delivery-failure handling
 * (typo'd number → failed confirmation push) depends on capturing it here.
 */
async function postMessage(
	payload: Record<string, unknown>,
): Promise<string | undefined> {
	const { accessToken, phoneNumberId } = readCredentials();
	const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`WhatsApp send failed (${res.status}): ${body}`);
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

