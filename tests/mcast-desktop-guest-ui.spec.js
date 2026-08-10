const { test, expect } = require("@playwright/test");
const { installInvite, inviteUrl } = require("./mcast-playwright-invite");

const baseUrl = process.env.MCAST_TEST_URL || inviteUrl("DSK00001");

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

async function expectVideoToCoverSurface(page, surfaceSelector) {
	let geometry;
	await expect.poll(async () => {
		geometry = await page.locator(surfaceSelector).evaluate((surface) => {
			const video = surface.querySelector("video");
			const surfaceRect = surface.getBoundingClientRect();
			const videoRect = video && video.getBoundingClientRect();
			const surfaceStyle = getComputedStyle(surface);
			const videoStyle = video && getComputedStyle(video);
			const borderLeft = parseFloat(surfaceStyle.borderLeftWidth) || 0;
			const borderTop = parseFloat(surfaceStyle.borderTopWidth) || 0;
			const borderRight = parseFloat(surfaceStyle.borderRightWidth) || 0;
			const borderBottom = parseFloat(surfaceStyle.borderBottomWidth) || 0;
			let translateY = 0;
			if (videoStyle && videoStyle.transform && videoStyle.transform !== "none") {
				translateY = new DOMMatrixReadOnly(videoStyle.transform).m42;
			}
			return {
				hasVideo: !!video,
				position: videoStyle && videoStyle.position,
				objectFit: videoStyle && videoStyle.objectFit,
				leftDelta: videoRect ? Math.abs(videoRect.left - (surfaceRect.left + borderLeft)) : Infinity,
				topDelta: videoRect ? Math.abs(videoRect.top - (surfaceRect.top + borderTop)) : Infinity,
				rightDelta: videoRect ? Math.abs(videoRect.right - (surfaceRect.right - borderRight)) : Infinity,
				bottomDelta: videoRect ? Math.abs(videoRect.bottom - (surfaceRect.bottom - borderBottom)) : Infinity,
				translateY
			};
		});
		return geometry.hasVideo && geometry.position === "absolute" && geometry.objectFit === "cover" &&
			geometry.leftDelta <= 1 && geometry.topDelta <= 1 && geometry.rightDelta <= 1 &&
			geometry.bottomDelta <= 1 && Math.abs(geometry.translateY) < 0.01;
	}, { timeout: 8000 }).toBe(true);
	expect(geometry).toMatchObject({ hasVideo: true, position: "absolute", objectFit: "cover" });
	expect(geometry.leftDelta).toBeLessThanOrEqual(1);
	expect(geometry.topDelta).toBeLessThanOrEqual(1);
	expect(geometry.rightDelta).toBeLessThanOrEqual(1);
	expect(geometry.bottomDelta).toBeLessThanOrEqual(1);
	expect(Math.abs(geometry.translateY)).toBeLessThan(0.01);
}

test("desktop setup is light, simple, and icon-first", async ({ page }) => {
	await installInvite(page, { code: "DSK00001" });
	await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastDesktopGuest")).toBeVisible();
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });
	await expect(page.locator("#mcastDesktopSetupTitle")).toHaveText("Let’s set up your studio");
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
	const settingsBox = await page.locator("#mcastDesktopSettingsButton").evaluate((button) => {
		const buttonRect = button.getBoundingClientRect();
		const iconRect = button.querySelector("svg").getBoundingClientRect();
		const style = getComputedStyle(button);
		return {
			display: style.display,
			alignItems: style.alignItems,
			justifyContent: style.justifyContent,
			width: Math.round(buttonRect.width),
			height: Math.round(buttonRect.height),
			centerOffsetX: Math.abs((iconRect.left + iconRect.width / 2) - (buttonRect.left + buttonRect.width / 2)),
			centerOffsetY: Math.abs((iconRect.top + iconRect.height / 2) - (buttonRect.top + buttonRect.height / 2))
		};
	});
	expect(settingsBox).toMatchObject({
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: 42,
		height: 42
	});
	expect(settingsBox.centerOffsetX).toBeLessThan(1);
	expect(settingsBox.centerOffsetY).toBeLessThan(1);

	const colors = await page.locator("#mcastDesktopGuest").evaluate(() => ({
		rootBg: getComputedStyle(document.querySelector(".mcast-desktop")).backgroundColor,
		setupBg: getComputedStyle(document.querySelector(".mcast-desktop__setup")).backgroundColor,
		cardBg: getComputedStyle(document.querySelector(".mcast-desktop__setup-card")).backgroundColor
	}));
	expect(colors.cardBg).toBe("rgb(255, 255, 255)");
});

test("desktop joins backstage with compact icon controls", async ({ page }) => {
	await installInvite(page, { code: "DSK00001" });
	await page.goto(baseUrl + "?case=join", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });
	await page.locator("#mcastDesktopPreviewButton").click();
	await expect.poll(() => page.locator("#mcastDesktopPreviewSurface video").evaluate((video) => !!video.srcObject), {
		timeout: 10000
	}).toBe(true);
	await expectVideoToCoverSurface(page, "#mcastDesktopPreviewSurface");
	await page.locator("#mcastDesktopGuestName").fill("Desktop Guest");
	await page.locator("#mcastDesktopJoinButton").click();
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "backstage", { timeout: 15000 });
	await expect(page.locator("#mcastDesktopLocalTile video")).toBeVisible();
	await expectVideoToCoverSurface(page, "#mcastDesktopLocalTile");
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
	await expect(page.locator("#mcastDesktopBackstageMessage")).toHaveCount(0);
	const noticeRail = page.locator("#mcastDesktopNoticeRail");
	const backstageNotice = noticeRail.locator(".mcast-guest-ui__toast");
	await expect(backstageNotice).toBeVisible();
	await expect(backstageNotice).toContainText("You’re backstage");
	const noticePlacement = await noticeRail.evaluate((rail) => {
		const topbar = rail.closest(".mcast-desktop__topbar").getBoundingClientRect();
		const notice = rail.getBoundingClientRect();
		const stage = document.querySelector(".mcast-desktop__room").getBoundingClientRect();
		return {
			noticeTop: notice.top,
			noticeBottom: notice.bottom,
			topbarTop: topbar.top,
			topbarBottom: topbar.bottom,
			stageTop: stage.top
		};
	});
	expect(noticePlacement.noticeTop).toBeGreaterThanOrEqual(noticePlacement.topbarTop);
	expect(noticePlacement.noticeBottom).toBeLessThanOrEqual(noticePlacement.topbarBottom);
	expect(noticePlacement.stageTop).toBeGreaterThanOrEqual(noticePlacement.topbarBottom);
	await page.waitForTimeout(10300);
	await expect(backstageNotice).toHaveCount(0);
	await page.evaluate(() => {
		const localVideo = document.querySelector("#mcastDesktopLocalTile video");
		const duplicate = document.createElement("video");
		duplicate.id = "unexpected-local-source";
		duplicate.srcObject = localVideo && localVideo.srcObject;
		document.body.appendChild(duplicate);
	});
	await page.waitForTimeout(1100);
	await expect(page.locator("#mcastDesktopLocalTile .mcast-desktop__tile-label")).toHaveText("Desktop Guest");
	await expect(page.locator("#mcastDesktopRemoteTiles .mcast-desktop__tile-label", { hasText: /Remote guest 1/i })).toHaveCount(0);

	await page.evaluate(() => {
		const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		window.__mcastGumCallsAfterMute = 0;
		navigator.mediaDevices.getUserMedia = function () {
			window.__mcastGumCallsAfterMute += 1;
			return original.apply(this, arguments);
		};
	});
	const muteResult = await page.locator("#mcastDesktopRoomMicButton").evaluate((button) => {
		const video = document.querySelector("#mcastDesktopLocalTile video");
		const track = video && video.srcObject && video.srcObject.getAudioTracks()[0];
		const beforeEnabled = track && track.enabled;
		const start = performance.now();
		button.click();
		const elapsed = performance.now() - start;
		return {
			beforeEnabled,
			afterEnabled: track && track.enabled,
			elapsed,
			label: button.textContent,
			isOff: button.classList.contains("is-off")
		};
	});
	expect(muteResult.beforeEnabled).toBe(true);
	expect(muteResult.afterEnabled).toBe(false);
	expect(muteResult.elapsed).toBeLessThan(100);
	expect(muteResult.isOff).toBe(true);
	expect(muteResult.label).toContain("Unmute");
	const unmuteResult = await page.locator("#mcastDesktopRoomMicButton").evaluate((button) => {
		const video = document.querySelector("#mcastDesktopLocalTile video");
		const track = video && video.srcObject && video.srcObject.getAudioTracks()[0];
		const start = performance.now();
		button.click();
		const elapsed = performance.now() - start;
		return {
			afterEnabled: track && track.enabled,
			elapsed,
			label: button.textContent,
			isOff: button.classList.contains("is-off")
		};
	});
	expect(unmuteResult.afterEnabled).toBe(true);
	expect(unmuteResult.elapsed).toBeLessThan(100);
	expect(unmuteResult.isOff).toBe(false);
	expect(unmuteResult.label).toContain("Mute");
	await expect.poll(() => page.evaluate(() => window.__mcastGumCallsAfterMute || 0), { timeout: 1000 }).toBe(0);
	const logoTransform = await page.locator(".mcast-desktop__logo").evaluate((element) => getComputedStyle(element).transform);
	expect(logoTransform).toBe("none");
});

test("desktop camera errors use the branded MCast footer recovery tray", async ({ page }) => {
	await installInvite(page, { code: "DSK00001" });
	await page.goto(baseUrl + "?case=camera-error", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });
	await page.evaluate(() => {
		window.previewWebcam = function () {
			const error = new Error("Raw internal device busy detail");
			error.name = "NotReadableError";
			return Promise.reject(error);
		};
	});
	await page.locator("#mcastDesktopPreviewButton").click();
	const recovery = page.locator("#mcastDesktopFooterRail > [data-mcast-dialog-backdrop]");
	await expect(recovery).toBeVisible({ timeout: 6000 });
	await expect(recovery.locator("[data-mcast-dialog-title]")).toHaveText("The camera and microphone could not start");
	await expect(recovery).toContainText("Another app or browser tab may be using the device");
	await expect(recovery).toContainText("Try again");
	await expect(recovery).toContainText("Open settings");
	await expect(recovery).toContainText("Join without camera");
	await expect(recovery).not.toContainText("Raw internal device busy detail");
	await expect(page.locator(".alertModal:visible, .promptModal:visible, #popupSelector:visible")).toHaveCount(0);
	const recoveryPlacement = await recovery.evaluate((backdrop) => {
		const panel = backdrop.querySelector("[data-mcast-dialog]");
		const backdropStyle = getComputedStyle(backdrop);
		const panelStyle = getComputedStyle(panel);
		const panelRect = panel.getBoundingClientRect();
		const footerRect = backdrop.parentElement.getBoundingClientRect();
		const contentRect = document.querySelector(".mcast-desktop__setup").getBoundingClientRect();
		return {
			backdropBackground: backdropStyle.backgroundColor,
			backdropPointerEvents: backdropStyle.pointerEvents,
			panelPointerEvents: panelStyle.pointerEvents,
			contentBottom: Math.round(contentRect.bottom),
			footerTop: Math.round(footerRect.top),
			panelTop: Math.round(panelRect.top),
			panelBottom: Math.round(panelRect.bottom),
			viewportBottom: window.innerHeight,
			ariaModal: panel.getAttribute("aria-modal")
		};
	});
	expect(recoveryPlacement).toMatchObject({
		backdropBackground: "rgba(0, 0, 0, 0)",
		backdropPointerEvents: "none",
		panelPointerEvents: "auto",
		ariaModal: "false"
	});
	expect(recoveryPlacement.contentBottom).toBeLessThanOrEqual(recoveryPlacement.footerTop);
	expect(recoveryPlacement.footerTop).toBe(recoveryPlacement.panelTop);
	expect(Math.abs(recoveryPlacement.viewportBottom - recoveryPlacement.panelBottom)).toBeLessThanOrEqual(1);

	await recovery.getByRole("button", { name: "Open settings" }).click();
	await expect(page.locator("#mcastDesktopSettingsPanel")).toBeVisible();
});
