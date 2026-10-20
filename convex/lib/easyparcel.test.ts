import { describe, expect, it } from "vitest";
import {
	buildPayOrderForm,
	buildRateCheckForm,
	buildSubmitOrderForm,
	classifyEasyparcelFailure,
	easyparcelActionUrl,
	easyparcelAmountToMinor,
	EasyparcelResponseError,
	encodeEasyparcelForm,
	normalizeEasyparcelShipStatus,
	parseCheckBalanceResponse,
	parseParcelStatusResponse,
	parsePayOrderResponse,
	parseRateCheckResponse,
	parseSubmitOrderResponse,
} from "./easyparcel";

const form = (encoded: string) => new URLSearchParams(encoded);

describe("hosts", () => {
	it("country picks the platform, isDemo picks the environment", () => {
		expect(easyparcelActionUrl("SG", false, "EPRateCheckingBulk")).toBe(
			"https://connect.easyparcel.sg/?ac=EPRateCheckingBulk",
		);
		expect(easyparcelActionUrl("SG", true, "EPPayOrderBulk")).toBe(
			"https://demo.connect.easyparcel.sg/?ac=EPPayOrderBulk",
		);
		expect(easyparcelActionUrl("MY", false, "EPSubmitOrderBulk")).toBe(
			"https://connect.easyparcel.my/?ac=EPSubmitOrderBulk",
		);
	});
});

describe("encodeEasyparcelForm — PHP bracket notation", () => {
	it("flattens nested bulk arrays the way http_build_query does", () => {
		const encoded = encodeEasyparcelForm({
			api: "key123",
			bulk: [{ pick_code: "43700", weight: "1.000" }],
		});
		const params = form(encoded);
		expect(params.get("api")).toBe("key123");
		expect(params.get("bulk[0][pick_code]")).toBe("43700");
		expect(params.get("bulk[0][weight]")).toBe("1.000");
	});

	it("drops undefined/null instead of sending the string 'undefined'", () => {
		const encoded = encodeEasyparcelForm({
			api: "k",
			bulk: [{ pick_state: undefined, send_code: "550123" }],
		});
		expect(encoded).not.toContain("pick_state");
		expect(form(encoded).get("bulk[0][send_code]")).toBe("550123");
	});
});

describe("easyparcelAmountToMinor", () => {
	it("parses their string majors without float dust", () => {
		expect(easyparcelAmountToMinor("8.00")).toBe(800);
		expect(easyparcelAmountToMinor("13.9")).toBe(1390);
		expect(easyparcelAmountToMinor("99999755.99")).toBe(9999975599);
		expect(easyparcelAmountToMinor(15)).toBe(1500);
	});

	it("throws on anything that isn't money — never freezes a bad fee", () => {
		expect(() => easyparcelAmountToMinor("RM8.00")).toThrow();
		expect(() => easyparcelAmountToMinor("")).toThrow();
		expect(() => easyparcelAmountToMinor("-5")).toThrow();
	});
});

describe("buildRateCheckForm — the SG/MY state split", () => {
	it("SG sends no state fields at all (the SG doc has none)", () => {
		const params = form(
			buildRateCheckForm({
				apiKey: "k",
				pickup: { postcode: "550123", country: "SG" },
				send: { postcode: "069533", country: "SG" },
				weightKg: 1.2,
			}),
		);
		expect(params.get("bulk[0][pick_code]")).toBe("550123");
		expect(params.get("bulk[0][pick_country]")).toBe("SG");
		expect([...params.keys()].some((k) => k.includes("state"))).toBe(false);
	});

	it("MY maps canonical state names to Appendix III codes", () => {
		const params = form(
			buildRateCheckForm({
				apiKey: "k",
				pickup: { postcode: "43700", state: "Selangor", country: "MY" },
				send: { postcode: "11950", state: "Pulau Pinang", country: "MY" },
				weightKg: 1,
			}),
		);
		expect(params.get("bulk[0][pick_state]")).toBe("sgr");
		expect(params.get("bulk[0][send_state]")).toBe("png");
	});

	it("floors the weight at 0.25kg — a zero weight quotes nothing silently", () => {
		const params = form(
			buildRateCheckForm({
				apiKey: "k",
				pickup: { postcode: "550123", country: "SG" },
				send: { postcode: "069533", country: "SG" },
				weightKg: 0,
			}),
		);
		expect(params.get("bulk[0][weight]")).toBe("0.250");
	});
});

describe("parseRateCheckResponse", () => {
	const sgResponse = JSON.stringify({
		api_status: "Success",
		error_code: 0,
		error_remark: "",
		result: [
			{
				status: "Success",
				remarks: "",
				rates: [
					{
						service_id: "EP-CS0IC",
						service_name: "Teleport Pink",
						service_type: "parcel",
						courier_id: "EP-CR0G",
						courier_name: "Teleport",
						courier_logo: "https://cdn/logo.png",
						delivery: "1 working day(s)",
						pickup_date: "2026-10-21",
						price: "8.00",
					},
					{
						service_id: "EP-CS5QE",
						service_name: "J&T Express",
						courier_name: "J&T Express",
						delivery: "1-2 working day(s)",
						price: "4.50",
					},
				],
			},
		],
	});

	it("normalizes rows and sorts cheapest first", () => {
		const rates = parseRateCheckResponse(sgResponse);
		expect(rates.map((r) => r.serviceId)).toEqual(["EP-CS5QE", "EP-CS0IC"]);
		expect(rates[1]).toMatchObject({
			serviceName: "Teleport Pink",
			courierName: "Teleport",
			priceMinor: 800,
			deliveryEta: "1 working day(s)",
		});
	});

	it("an empty rate list is an answer, not an error", () => {
		expect(
			parseRateCheckResponse(
				JSON.stringify({
					api_status: "Success",
					error_code: 0,
					result: [{ status: "Success", rates: [] }],
				}),
			),
		).toEqual([]);
	});

	it("a malformed row is skipped, never sinks the quote", () => {
		const rates = parseRateCheckResponse(
			JSON.stringify({
				api_status: "Success",
				error_code: 0,
				result: [
					{
						rates: [
							{ service_id: "OK-1", courier_name: "A", price: "5.00" },
							{ service_id: "BAD", courier_name: "B", price: "RM 9" },
							{ courier_name: "C", price: "2.00" },
						],
					},
				],
			}),
		);
		expect(rates.map((r) => r.serviceId)).toEqual(["OK-1"]);
	});

	it("a non-zero error_code throws with the machine code preserved", () => {
		expect(() =>
			parseRateCheckResponse(
				JSON.stringify({
					api_status: "Fail",
					error_code: "4",
					error_remark: "Invalid api key",
				}),
			),
		).toThrow(EasyparcelResponseError);
	});
});

describe("buildSubmitOrderForm — party fields per country", () => {
	const sgPickup = {
		name: "Kedai SG",
		phone: "6591234567",
		unit: "#05-11",
		address1: "10 Anson Road",
		postcode: "079903",
		country: "SG" as const,
	};
	const sgBuyer = {
		name: "Buyer Tan",
		phone: "6598765432",
		address1: "Blk 123 Bedok North",
		postcode: "460123",
		country: "SG" as const,
	};

	it('SG sends pick_unit/send_unit and the literal state "Singapore"', () => {
		const params = form(
			buildSubmitOrderForm({
				apiKey: "k",
				pickup: sgPickup,
				send: sgBuyer,
				weightKg: 1.5,
				content: "3x Keropok Lekor",
				value: "45.00",
				serviceId: "EP-CS0IC",
				reference: "ORD-AB12",
			}),
		);
		expect(params.get("bulk[0][pick_unit]")).toBe("#05-11");
		expect(params.get("bulk[0][pick_state]")).toBe("Singapore");
		expect(params.get("bulk[0][send_state]")).toBe("Singapore");
		expect(params.get("bulk[0][service_id]")).toBe("EP-CS0IC");
		expect(params.get("bulk[0][reference]")).toBe("ORD-AB12");
		expect(params.get("bulk[0][sms]")).toBe("0");
		expect(params.get("bulk[0][eori_acknowledged]")).toBe("0");
	});

	it("MY maps the state name to its code on both parties", () => {
		const params = form(
			buildSubmitOrderForm({
				apiKey: "k",
				pickup: {
					name: "Kedai MY",
					phone: "60123456789",
					address1: "55 Jln Eco Majestic",
					city: "Beranang",
					state: "Selangor",
					postcode: "43700",
					country: "MY",
				},
				send: {
					name: "Buyer",
					phone: "60198765432",
					address1: "1 Lebuh Armenian",
					city: "George Town",
					state: "Pulau Pinang",
					postcode: "10200",
					country: "MY",
				},
				weightKg: 2,
				content: "Parcel",
				value: "80.00",
				serviceId: "EP-CS5QE",
			}),
		);
		expect(params.get("bulk[0][pick_state]")).toBe("sgr");
		expect(params.get("bulk[0][send_state]")).toBe("png");
	});

	it("truncates content — their validator rejects essays", () => {
		const params = form(
			buildSubmitOrderForm({
				apiKey: "k",
				pickup: sgPickup,
				send: sgBuyer,
				weightKg: 1,
				content: "x".repeat(300),
				value: "1.00",
				serviceId: "S",
			}),
		);
		expect(params.get("bulk[0][content]")?.length).toBe(100);
	});
});

describe("parseSubmitOrderResponse", () => {
	it("returns the order_number + price on a Success row", () => {
		expect(
			parseSubmitOrderResponse(
				JSON.stringify({
					api_status: "Success",
					error_code: 0,
					result: [
						{
							status: "Success",
							remarks: "Order Successfully Placed.",
							order_number: "EI-5UFAI",
							price: "8.00",
						},
					],
				}),
			),
		).toEqual({ orderNumber: "EI-5UFAI", priceMinor: 800 });
	});

	it("a per-row Fail inside a Success envelope throws the row's remarks", () => {
		expect(() =>
			parseSubmitOrderResponse(
				JSON.stringify({
					api_status: "Success",
					error_code: 0,
					result: [{ status: "Fail", remarks: "Invalid postcode" }],
				}),
			),
		).toThrow(/Invalid postcode/);
	});
});

describe("parsePayOrderResponse", () => {
	it("Fully Paid yields AWB + label PDF + tracking (MY shape)", () => {
		expect(
			parsePayOrderResponse(
				JSON.stringify({
					api_status: "Success",
					error_code: 0,
					result: [
						{
							orderno: "EI-5UFAI",
							messagenow: "Fully Paid",
							parcel: [
								{
									parcelno: "EP-PQKTE",
									awb: "238770015234",
									awb_id_link: "https://connect.easyparcel.my/?ac=AWBLabel&id=xyz",
									tracking_url: "https://easyparcel.my/track?awb=238770015234",
								},
							],
						},
					],
				}),
			),
		).toEqual({
			paid: true,
			awb: "238770015234",
			labelUrl: "https://connect.easyparcel.my/?ac=AWBLabel&id=xyz",
			trackingUrl: "https://easyparcel.my/track?awb=238770015234",
		});
	});

	it('SG "Fully paid" (lowercase) with no tracking_url still reads paid', () => {
		const parsed = parsePayOrderResponse(
			JSON.stringify({
				api_status: "Success",
				error_code: 0,
				result: [
					{
						orderno: "EI-9",
						messagenow: "Fully paid",
						parcel: [{ parcelno: "EP-1", awb: "SGAWB1", awb_id_link: "https://x/l" }],
					},
				],
			}),
		);
		expect(parsed).toEqual({
			paid: true,
			awb: "SGAWB1",
			labelUrl: "https://x/l",
			trackingUrl: undefined,
		});
	});

	it("Insufficient Credit arrives INSIDE a Success envelope and reads unpaid", () => {
		expect(
			parsePayOrderResponse(
				JSON.stringify({
					api_status: "Success",
					error_code: 0,
					result: [{ orderno: "EI-5", messagenow: "Insufficient Credit", parcel: [{}] }],
				}),
			),
		).toEqual({ paid: false, message: "Insufficient Credit" });
	});
});

describe("parseParcelStatusResponse + buildPayOrderForm", () => {
	it("pay form carries the order_no", () => {
		expect(
			form(buildPayOrderForm({ apiKey: "k", orderNumber: "EI-5UFAI" })).get(
				"bulk[0][order_no]",
			),
		).toBe("EI-5UFAI");
	});

	it("status rows come back keyed by order_no with ship_status", () => {
		const rows = parseParcelStatusResponse(
			JSON.stringify({
				api_status: "Success",
				error_code: 0,
				result: [
					{
						status: "Success",
						order_no: "EI-5UFAI",
						parcel: [
							{
								parcel_number: "EP-PQKTE",
								ship_status: "Delivering(in transit)",
								awb: "238770015234",
								awb_id_link: "https://x/label",
							},
						],
					},
				],
			}),
		);
		expect(rows).toEqual([
			{
				orderNumber: "EI-5UFAI",
				shipStatus: "Delivering(in transit)",
				awb: "238770015234",
				labelUrl: "https://x/label",
			},
		]);
	});
});

describe("parseCheckBalanceResponse", () => {
	it("reads the balance string plus the undocumented-but-live currency", () => {
		expect(
			parseCheckBalanceResponse(
				JSON.stringify({
					api_status: "Success",
					error_code: 0,
					error_remark: "",
					result: "250.50",
					currency: "SGD",
				}),
			),
		).toEqual({ balanceMinor: 25050, currency: "SGD" });
	});

	it("auth failures carry their Appendix I code", () => {
		try {
			parseCheckBalanceResponse(
				JSON.stringify({ api_status: "Fail", error_code: "4", error_remark: "Invalid api key" }),
			);
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(EasyparcelResponseError);
			expect(classifyEasyparcelFailure(err as EasyparcelResponseError)).toBe("auth");
		}
	});
});

describe("normalizeEasyparcelShipStatus", () => {
	it("maps the documented vocabulary onto our job statuses", () => {
		expect(normalizeEasyparcelShipStatus("Pending For Collection")).toBe("assigning");
		expect(normalizeEasyparcelShipStatus("Pending for Drop Off")).toBe("assigning");
		expect(normalizeEasyparcelShipStatus("Collected")).toBe("picked_up");
		expect(normalizeEasyparcelShipStatus("Parcel Drop Off at Point")).toBe("picked_up");
		expect(normalizeEasyparcelShipStatus("Drop Off")).toBe("picked_up"); // SG spelling
		expect(normalizeEasyparcelShipStatus("Delivering(in transit)")).toBe("picked_up");
		expect(normalizeEasyparcelShipStatus("Successfully Delivered")).toBe("completed");
		expect(normalizeEasyparcelShipStatus("Cancel By Admin")).toBe("canceled");
		expect(normalizeEasyparcelShipStatus("Expired (Unpaid)")).toBe("expired");
		expect(normalizeEasyparcelShipStatus("Returned")).toBe("rejected");
	});

	it("informational / unknown statuses move nothing", () => {
		expect(normalizeEasyparcelShipStatus("On Hold")).toBeUndefined();
		expect(normalizeEasyparcelShipStatus("Other Status")).toBeUndefined();
		expect(normalizeEasyparcelShipStatus(undefined)).toBeUndefined();
	});
});

describe("classifyEasyparcelFailure", () => {
	it("codes first, the one message-shaped verdict second", () => {
		expect(classifyEasyparcelFailure(new EasyparcelResponseError("5", "Unauthorized user"))).toBe("auth");
		expect(classifyEasyparcelFailure(new EasyparcelResponseError("1004", "Invalid postcode"))).toBe("invalid_address");
		expect(classifyEasyparcelFailure(new EasyparcelResponseError("1005", "Invalid state"))).toBe("invalid_address");
		expect(classifyEasyparcelFailure(new EasyparcelResponseError("pay_unpaid", "Insufficient Credit"))).toBe("credit");
		expect(classifyEasyparcelFailure(new EasyparcelResponseError("1000", "Missing param"))).toBe("unknown");
	});
});
