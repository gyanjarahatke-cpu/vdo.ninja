const { test, expect } = require("@playwright/test");
const { installInvite, inviteUrl } = require("./mcast-playwright-invite");

const mediaLaunchOptions = {
	args: [
		"--use-fake-ui-for-media-stream",
		"--use-fake-device-for-media-stream",
		"--autoplay-policy=no-user-gesture-required"
	]
};

test.use({ launchOptions: mediaLaunchOptions });

test.describe("desktop MCast UI ownership", () => {
	test.use({
		viewport: { width: 1440, height: 920 },
		permissions: ["camera", "microphone"]
	});

	test("warnings, prompts, settings, and raw engine UI stay MCast-owned", async ({ page }) => {
		const url = await installInvite(page, { code: "OWND0001" });
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await expect(page.locator("#mcastDesktopGuest")).toHaveAttribute("data-step", "setup", { timeout: 7000 });

		for (const selector of ["#info", "#mainmenu", "#popupSelector"]) {
			await expect(page.locator(selector)).toBeHidden();
		}
		await expect(page.locator(".alertModal:visible, .promptModal:visible, .customModelPopup:visible")).toHaveCount(0);

		await page.evaluate(() => {
			window.warnUser("NotReadableError: camera device raw-internal-driver-detail");
		});
		const dialog = page.locator("#mcastGuestUiRoot [data-mcast-dialog-backdrop]");
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("The camera could not start");
		await expect(dialog).not.toContainText("raw-internal-driver-detail");
		await expect(page.locator(".alertModal:visible")).toHaveCount(0);
		await dialog.locator("[data-mcast-dialog-actions]").getByRole("button", { name: "Close", exact: true }).click();

		await page.evaluate(() => window.toggleSettings());
		await expect(page.locator("#mcastDesktopSettingsPanel")).toBeVisible();
		await expect(page.locator("#popupSelector")).toBeHidden();
		await page.locator("#mcastDesktopSettingsClose").click();

		await page.evaluate(() => {
			window.__mcastPromptResult = window.promptAlt("Enter room password: RAW_ENGINE_PROMPT");
		});
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("Room access required");
		await expect(dialog).not.toContainText("RAW_ENGINE_PROMPT");
		await expect(page.locator(".promptModal:visible")).toHaveCount(0);
		await dialog.locator("[data-mcast-dialog-input]").fill("secure-value");
		await dialog.getByRole("button", { name: "Continue" }).click();
		await expect.poll(() => page.evaluate(async () => await window.__mcastPromptResult)).toBe("secure-value");

		await page.evaluate(() => {
			const leaked = document.createElement("div");
			leaked.className = "alertModal";
			leaked.textContent = "Upstream branding and opaque internal socket detail";
			document.body.appendChild(leaked);
		});
		const quarantined = page.locator('.alertModal[data-mcast-upstream-ui="quarantined"]');
		await expect(quarantined).toBeHidden();
		await expect(dialog).toBeVisible();
		await expect(dialog).not.toContainText("opaque internal socket detail");
	});

	const remoteCases = [
		{
			name: "remote camera",
			code: "CAMR0001",
			kind: "remote_camera",
			query: "room=remote-room&push=remote-camera&mcastmode=stream_guest&mcastremote=remote_camera&autostart&mcastautojoin",
			title: "Remote camera setup",
			action: "Connect camera",
			cameraVisible: true,
			microphoneVisible: true,
			screenVisible: false
		},
		{
			name: "remote audio",
			code: "AUDI0001",
			kind: "remote_audio",
			query: "room=remote-room&push=remote-audio&mcastmode=stream_guest&mcastremote=remote_audio&autostart&mcastautojoin",
			title: "Remote audio setup",
			action: "Connect microphone",
			cameraVisible: false,
			microphoneVisible: true,
			screenVisible: false
		},
		{
			name: "remote screen",
			code: "SCRN0001",
			kind: "remote_screen",
			query: "room=remote-room&push=remote-screen&screenshareid=remote-screen&mcastmode=stream_guest&mcastremote=remote_screen&autostart&mcastautojoin",
			title: "Share your screen",
			action: "Start sharing",
			cameraVisible: false,
			microphoneVisible: false,
			screenVisible: true
		}
	];

	remoteCases.forEach((remote) => {
		test(`${remote.name} has a dedicated, user-initiated desktop setup`, async ({ page }) => {
			await page.addInitScript(() => {
				window.__mcastDisplayCaptureCalls = 0;
				if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
					const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
					navigator.mediaDevices.getDisplayMedia = function () {
						window.__mcastDisplayCaptureCalls += 1;
						return original.apply(this, arguments);
					};
				}
			});
			const url = await installInvite(page, remote);
			await page.goto(url, { waitUntil: "domcontentloaded" });
			const root = page.locator("#mcastDesktopGuest");
			await expect(root).toHaveAttribute("data-step", "setup", { timeout: 7000 });
			await expect(root).toHaveAttribute("data-experience", remote.kind);
			await expect(page.locator("#mcastDesktopSetupTitle")).toHaveText(remote.title);
			await expect(page.locator("#mcastDesktopJoinButton")).toContainText(remote.action);
			await expect(page.locator("#mcastDesktopGuestNameField")).toBeHidden();
			await page.locator("#mcastDesktopSettingsButton").click();
			await expect(page.locator("#mcastDesktopSettingsPanel")).toBeVisible();
			await expect(page.locator("#mcastDesktopCameraField"))[remote.cameraVisible ? "toBeVisible" : "toBeHidden"]();
			await expect(page.locator("#mcastDesktopMicField"))[remote.microphoneVisible ? "toBeVisible" : "toBeHidden"]();
			await expect(page.locator("#mcastDesktopScreenOptions"))[remote.screenVisible ? "toBeVisible" : "toBeHidden"]();
			await expect(page.locator("#mcastDesktopSpeakerField")).toBeHidden();
			await page.locator("#mcastDesktopSettingsClose").click();
			await page.waitForTimeout(1300);
			await expect.poll(() => page.evaluate(() => window.__mcastDisplayCaptureCalls || 0)).toBe(0);
			await expect.poll(() => page.locator("#mcastDesktopPreviewSurface video").evaluateAll(
				(videos) => videos.some((video) => !!video.srcObject)
			)).toBe(false);
		});
	});
});

test.describe("mobile remote-source UI", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		permissions: ["camera", "microphone"]
	});

	test("remote screen uses a touch-safe MCast permission flow without automatic capture", async ({ page }) => {
		await page.addInitScript(() => {
			window.__mcastDisplayCaptureCalls = 0;
			if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
				const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
				navigator.mediaDevices.getDisplayMedia = function () {
					window.__mcastDisplayCaptureCalls += 1;
					return original.apply(this, arguments);
				};
			}
		});
		const url = await installInvite(page, {
			code: "MSCR0001",
			query: "room=remote-room&push=remote-screen&screenshareid=remote-screen&mcastmode=stream_guest&mcastremote=remote_screen&autostart&mcastautojoin"
		});
		await page.goto(url, { waitUntil: "domcontentloaded" });
		const root = page.locator("#mcastMobileGuest");
		await expect(root).toHaveAttribute("data-step", "permission", { timeout: 7000 });
		await expect(root).toHaveAttribute("data-experience", "remote_screen");
		await expect(page.locator("#mcastMobilePermissionTitle")).toHaveText("Share a screen with MCast Studio");
		await expect(page.locator("#mcastMobileAllowButton")).toContainText("Choose what to share");
		for (const selector of ["#mcastMobileGuestNameField", "#mcastMobileCameraField", "#mcastMobileMicField"]) {
			await expect(page.locator(selector)).toBeHidden();
		}
		await page.waitForTimeout(1300);
		await expect.poll(() => page.evaluate(() => window.__mcastDisplayCaptureCalls || 0)).toBe(0);
		await expect(page.locator(".alertModal:visible, .promptModal:visible, #popupSelector:visible")).toHaveCount(0);
	});

	test("remote audio exposes microphone-only controls and settings", async ({ page }) => {
		const url = await installInvite(page, {
			code: "MAUD0001",
			query: "room=remote-room&push=remote-audio&mcastmode=stream_guest&mcastremote=remote_audio&autostart&mcastautojoin"
		});
		await page.goto(url, { waitUntil: "domcontentloaded" });
		const root = page.locator("#mcastMobileGuest");
		await expect(root).toHaveAttribute("data-step", "permission", { timeout: 7000 });
		await expect(root).toHaveAttribute("data-experience", "remote_audio");
		await expect(page.locator("#mcastMobilePermissionTitle")).toHaveText("Connect this microphone");
		await expect(page.locator("#mcastMobileAllowButton")).toContainText("Allow microphone");
		await expect(page.locator("#mcastMobileCameraField")).toBeHidden();
		await expect(page.locator("#mcastMobileSetupCameraButton")).toBeHidden();
		await page.locator("#mcastMobileAllowButton").click();
		await expect(root).toHaveAttribute("data-step", "setup", { timeout: 7000 });
		await page.locator("#mcastMobileSetupSettingsButton").click();
		await expect(page.locator("#mcastMobileSettingsPanel")).toBeVisible();
		await expect(page.locator("#mcastMobileMicField")).toBeVisible();
		await expect(page.locator("#mcastMobileCameraField")).toBeHidden();
	});
});
