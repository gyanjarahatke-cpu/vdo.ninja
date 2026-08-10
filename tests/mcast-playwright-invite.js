"use strict";

const path = require("path");

const root = path.join(__dirname, "..");
const loaderPath = path.join(root, "mcast-guest.html");
const defaultOrigin = process.env.MCAST_TEST_ORIGIN || "http://127.0.0.1:8089";

function inviteUrl(code = "TEST0001", suffix = "") {
	return `${defaultOrigin}/s/${code}${suffix}`;
}

async function installInvite(page, options = {}) {
	const code = options.code || "TEST0001";
	const query = options.query || [
		"room=mcast-ui-regression",
		"push=mcast-ui-regression",
		"webcam",
		"mcastmode=meeting",
		"mcastrole=participant",
		"mcaststate=backstage",
		"mcastrouting=low_bitrate",
		"label=Regression%20Guest"
	].join("&");

	await page.route(new RegExp(`/s/${code}(?:[/?#]|$)`, "i"), async (route) => {
		if (route.request().resourceType() !== "document") {
			await route.continue();
			return;
		}
		await route.fulfill({
			path: loaderPath,
			contentType: "text/html; charset=utf-8",
			headers: { "Cache-Control": "no-store" }
		});
	});

	await page.route("**/api/vdoShortInviteResolve?code=*", async (route) => {
		const requestUrl = new URL(route.request().url());
		if (requestUrl.searchParams.get("code") !== code) {
			await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not-found"}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "Cache-Control": "no-store" },
			body: JSON.stringify({ query, route: "guest" })
		});
	});

	return inviteUrl(code, options.suffix || "");
}

module.exports = { installInvite, inviteUrl };
