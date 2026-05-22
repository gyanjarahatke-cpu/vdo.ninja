const { test, expect } = require("@playwright/test");

const baseUrl = process.env.MCAST_TEST_URL || "http://127.0.0.1:8089/g/?push=mcast-desktop-regression&room=mcast-desktop-regression";

test.use({
	viewport: { width: 1440, height: 920 },
	permissions: ["camera", "microphone"],
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			"--use-fake-device-for-media-stream",
			"--autoplay-policy=no-user-gesture-required"
		]
	}
});

test("desktop setup is light, simple, and icon-first", async ({ page }) => {
	await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastDesktopGuest")).toBeVisible();
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });
	await expect(page.locator("#mcastDesktopGuest").getByText("Let’s set up your studio")).toBeVisible();
	await expect(page.locator("#mcastDesktopGuest").getByText("Backstage check")).toHaveCount(0);
	await expect(page.locator(".mcast-desktop__setup-card")).toBeVisible();
	await expect(page.locator("#mcastDesktopMicToggle svg")).toBeVisible();
	await expect(page.locator("#mcastDesktopCameraToggle svg")).toBeVisible();
	await expect(page.locator("#mcastDesktopPreviewButton svg")).toBeVisible();
	await expect(page.locator("#mcastDesktopSetupSettingsButton")).toHaveCount(0);
	await expect(page.locator("#mcastDesktopSettingsButton svg")).toBeVisible();
	await expect(page.locator(".mcast-desktop__logo")).toBeVisible();
	await expect.poll(() => page.locator(".mcast-desktop__logo").evaluate((image) => image.complete && image.naturalWidth > 0), {
		timeout: 8000
	}).toBe(true);

	const topOrder = await page.locator(".mcast-desktop__top-actions").evaluate((element) => (
		Array.from(element.children).map((child) => child.id || child.textContent.trim())
	));
	expect(topOrder).toEqual(["mcastDesktopSettingsButton", "mcastDesktopQuality", "mcastDesktopLiveBadge"]);

	const colors = await page.locator("#mcastDesktopGuest").evaluate(() => ({
		rootBg: getComputedStyle(document.querySelector(".mcast-desktop")).backgroundColor,
		setupBg: getComputedStyle(document.querySelector(".mcast-desktop__setup")).backgroundColor,
		cardBg: getComputedStyle(document.querySelector(".mcast-desktop__setup-card")).backgroundColor
	}));
	expect(colors.cardBg).toBe("rgb(255, 255, 255)");
});

test("desktop joins backstage with compact icon controls", async ({ page }) => {
	await page.goto(baseUrl + "&case=join", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });
	await page.locator("#mcastDesktopPreviewButton").click();
	await expect.poll(() => page.locator("#mcastDesktopPreviewSurface video").evaluate((video) => !!video.srcObject), {
		timeout: 10000
	}).toBe(true);
	await page.locator("#mcastDesktopGuestName").fill("Desktop Guest");
	await page.locator("#mcastDesktopJoinButton").click();
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "backstage", { timeout: 15000 });
	await expect(page.locator("#mcastDesktopLocalTile video")).toBeVisible();
	await expect(page.locator("#mcastDesktopRoomMicButton svg")).toBeVisible();
	await expect(page.locator("#mcastDesktopRoomCameraButton svg")).toBeVisible();
	await expect(page.locator("#mcastDesktopRoomChatButton")).toHaveCount(0);
	await expect(page.locator("#chatbutton")).toBeHidden();
	await expect(page.locator("#chatModule")).toBeHidden();
	await expect(page.locator(".mcast-desktop__side-panel")).toHaveCount(0);
	await expect(page.locator("#mcastDesktopSettingsButton svg")).toBeVisible();
	await expect(page.locator(".mcast-desktop__logo")).toBeVisible();
	await expect(page.locator("#mcastDesktopLeaveButton svg")).toBeVisible();
	await expect(page.locator("#mcastDesktopLocalTile .mcast-desktop__tile-label")).toHaveText("Desktop Guest");
	await expect(page.locator("#mcastDesktopBackstageMessage")).toBeVisible();
	const logoTransform = await page.locator(".mcast-desktop__logo").evaluate((element) => getComputedStyle(element).transform);
	expect(logoTransform).toBe("none");
});

test("desktop camera errors use the branded MCast recovery modal", async ({ page }) => {
	await page.goto(baseUrl + "&case=camera-error", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });
	await page.evaluate(() => {
		window.previewWebcam = function () {
			const error = new Error("Raw internal device busy detail");
			error.name = "NotReadableError";
			return Promise.reject(error);
		};
	});
	await page.locator("#mcastDesktopPreviewButton").click();
	await expect(page.locator("#mcastDesktopCameraErrorModal")).toBeVisible({ timeout: 6000 });
	await expect(page.locator("#mcastDesktopCameraErrorTitle")).toHaveText("Camera could not start");
	await expect(page.locator("#mcastDesktopCameraErrorModal")).toContainText("Your camera may already be used by another app");
	await expect(page.locator("#mcastDesktopCameraErrorModal")).toContainText("Try again");
	await expect(page.locator("#mcastDesktopCameraErrorModal")).toContainText("Choose another camera");
	await expect(page.locator("#mcastDesktopCameraErrorModal")).toContainText("Join without camera");
	await expect(page.locator("#mcastDesktopCameraErrorModal")).not.toContainText("Raw internal device busy detail");

	await page.locator("#mcastDesktopChooseCameraButton").click();
	await expect(page.locator("#mcastDesktopSettingsPanel")).toBeVisible();
});
