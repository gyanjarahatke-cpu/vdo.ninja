const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.MCAST_TEST_URL || "http://127.0.0.1:8089/g/?push=mcast-mobile-regression&room=mcast-mobile-regression";

test.use({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
	permissions: ["camera", "microphone"],
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			"--use-fake-device-for-media-stream",
			"--autoplay-policy=no-user-gesture-required"
		]
	}
});

test("mobile guest flow owns the route and reaches backstage", async ({ page }) => {
	await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastMobileGuest")).toBeVisible();
	await expect(page.locator("#mcastGuestEntry")).toHaveCount(0);
	await expect(page.locator("#mcastDesktopGuest")).toBeHidden();

	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "permission", { timeout: 6000 });
	await page.locator("#mcastMobileAllowButton").click();
	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "setup", { timeout: 12000 });
	await expect.poll(() => page.locator("#mcastMobileSetupPreview video").evaluate((video) => !!video.srcObject), {
		timeout: 8000
	}).toBe(true);

	await page.locator("#mcastMobileGuestName").fill("Mobile Regression Guest");
	await page.locator("#mcastMobileEnterButton").click();
	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "backstage", { timeout: 15000 });
	await expect.poll(() => page.locator("#mcastMobileSelfPreview video").evaluate((video) => !!video.srcObject), {
		timeout: 8000
	}).toBe(true);
	await expect(page.locator("#mcastMobileRoomMicButton svg")).toBeVisible();
	await expect(page.locator("#mcastMobileRoomCameraButton svg")).toBeVisible();
	await expect(page.locator("#mcastMobileChatButton")).toHaveCount(0);
	await expect(page.locator("#mcastMobileLeaveButton svg")).toBeVisible();
	await expect(page.locator("text=Waiting for the room")).toBeHidden();
});

test("guest route uses separated desktop and mobile shell assets", async ({ page }) => {
	const html = fs.readFileSync(path.join(__dirname, "..", "g", "index.html"), "utf8");
	expect(html).toContain("./g/desktop/DesktopRoomShell.css");
	expect(html).toContain("./g/desktop/DesktopRoomShell.js");
	expect(html).toContain("./g/mobile/MobileRoomShell.css");
	expect(html).toContain("./g/mobile/MobileRoomShell.js");
	expect(html).not.toContain("mcast-guest-entry");
	expect(html).not.toContain("id=\"mcastGuestEntry\"");

	await page.goto(baseUrl + "&case=architecture", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".DesktopRoomShell")).toHaveCount(1);
	await expect(page.locator(".DesktopTopBar")).toHaveCount(1);
	await expect(page.locator(".DesktopStageLayout")).toHaveCount(1);
	await expect(page.locator(".DesktopBottomControls")).toHaveCount(1);
	await expect(page.locator(".MobileRoomShell")).toHaveCount(1);
	await expect(page.locator(".MobileTopBar")).toHaveCount(1);
	await expect(page.locator(".MobileStageLayout")).toHaveCount(1);
	await expect(page.locator(".MobileBottomControls")).toHaveCount(1);
	await expect(page.locator(".mcast-entry, #mcastGuestEntry")).toHaveCount(0);
});

test("force-landscape params do not rotate mobile setup UI in portrait viewport", async ({ page }) => {
	await page.goto(baseUrl + "&fl=1&forcelandscape=1", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "permission", { timeout: 6000 });
	await page.evaluate(() => {
		if (typeof window.updateForceRotatedCSS === "function") {
			window.updateForceRotatedCSS(90);
		}
	});
	await expect.poll(() => page.evaluate(() => ({
		bodyTransform: getComputedStyle(document.body).transform,
		rootTransform: getComputedStyle(document.getElementById("mcastMobileGuest")).transform,
		setupTransform: getComputedStyle(document.querySelector(".mcast-mobile__setup")).transform,
		setupCardTransform: getComputedStyle(document.querySelector(".mcast-mobile__setup-card")).transform,
		bodyRotated: document.body.dataset.rotated || ""
	})), { timeout: 5000 }).toEqual({
		bodyTransform: "none",
		rootTransform: "none",
		setupTransform: "none",
		setupCardTransform: "none",
		bodyRotated: ""
	});

	await page.locator("#mcastMobileAllowButton").click();
	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "setup", { timeout: 12000 });
	await expect.poll(() => page.evaluate(() => ({
		bodyTransform: getComputedStyle(document.body).transform,
		rootTransform: getComputedStyle(document.getElementById("mcastMobileGuest")).transform,
		setupTransform: getComputedStyle(document.querySelector(".mcast-mobile__setup")).transform,
		micPanelTransform: getComputedStyle(document.querySelector(".mcast-mobile__mic-panel")).transform,
		bodyRotated: document.body.dataset.rotated || ""
	})), { timeout: 5000 }).toEqual({
		bodyTransform: "none",
		rootTransform: "none",
		setupTransform: "none",
		micPanelTransform: "none",
		bodyRotated: ""
	});
});

test.describe("mobile landscape backstage", () => {
	test.use({ viewport: { width: 844, height: 390 } });

	test("uses the dedicated landscape layout after joining", async ({ page }) => {
		await page.goto(baseUrl + "&landscape=1", { waitUntil: "domcontentloaded" });
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "permission", { timeout: 6000 });
		await page.locator("#mcastMobileAllowButton").click();
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "setup", { timeout: 12000 });
		await page.locator("#mcastMobileGuestName").fill("Landscape Guest");
		await page.locator("#mcastMobileEnterButton").click();
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "backstage", { timeout: 15000 });

		const layout = await page.locator(".mcast-mobile__backstage-layout").evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				columns: style.gridTemplateColumns,
				rows: style.gridTemplateRows
			};
		});
		expect(layout.columns.split(" ").length).toBeGreaterThanOrEqual(2);
		await expect(page.locator("#mcastMobileRoomMicButton svg")).toBeVisible();
		await expect(page.locator("#mcastMobileLeaveButton svg")).toBeVisible();
	});
});
