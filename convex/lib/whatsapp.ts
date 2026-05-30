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

async function postMessage(payload: Record<string, unknown>): Promise<void> {
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
): Promise<void> {
	await postMessage({
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

/**
 * Send a WhatsApp location pin. On the recipient's end this renders as a
 * tappable map preview that opens in their default maps app (Waze, Google
 * Maps, Apple Maps — whatever they have set). This is the canonical pattern
 * for sharing addresses on WhatsApp; we use it after order confirm to give
 * the buyer one-tap navigation to the pickup / delivery point.
 *
 * Meta requires latitude/longitude as strings in the wire payload.
 */
export async function sendLocation(
	toPhone: string,
	latitude: number,
	longitude: number,
	name: string,
	address: string,
): Promise<void> {
	await postMessage({
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to: toPhone,
		type: "location",
		location: {
			latitude: String(latitude),
			longitude: String(longitude),
			name,
			address,
		},
	});
}
