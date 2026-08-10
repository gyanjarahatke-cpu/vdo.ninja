const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { installInvite, inviteUrl } = require("./mcast-playwright-invite");

const baseUrl = process.env.MCAST_TEST_URL || inviteUrl("MOB00001");

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

async function measureSetupLayout(page) {
	return page.locator(".mcast-mobile__setup-scroll").evaluate((scroller) => {
		const copy = document.querySelector(".mcast-mobile__setup-copy");
		const card = document.querySelector(".mcast-mobile__setup-card");
		const preview = document.getElementById("mcastMobileSetupPreview");
		const video = document.querySelector("#mcastMobileSetupPreview video");
		const tools = document.querySelector(".mcast-mobile__setup-controls");
		const info = document.getElementById("mcastMobileInfo");
		const name = document.getElementById("mcastMobileGuestName");
		const enter = document.getElementById("mcastMobileEnterButton");
		const terms = document.getElementById("mcastMobileTerms");
		const scrollerRect = scroller.getBoundingClientRect();
		const copyRect = copy.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		const videoRect = video.getBoundingClientRect();
		const toolsRect = tools.getBoundingClientRect();
		const infoRect = info.getBoundingClientRect();
		const nameRect = name.getBoundingClientRect();
		const enterRect = enter.getBoundingClientRect();
		const termsRect = terms.getBoundingClientRect();
		return {
			overflowY: getComputedStyle(scroller).overflowY,
			paddingLeft: parseFloat(getComputedStyle(scroller).paddingLeft),
			paddingRight: parseFloat(getComputedStyle(scroller).paddingRight),
			scrollTop: scroller.scrollTop,
			scrollHeight: scroller.scrollHeight,
			clientHeight: scroller.clientHeight,
			scrollerTop: scrollerRect.top,
			scrollerBottom: scrollerRect.bottom,
			copyDisplay: getComputedStyle(copy).display,
			copyTop: copyRect.top,
			copyBottom: copyRect.bottom,
			cardTop: cardRect.top,
			cardBottom: cardRect.bottom,
			cardHeight: cardRect.height,
			previewOverflow: getComputedStyle(preview).overflow,
			videoWidth: videoRect.width,
			videoHeight: videoRect.height,
			videoPosition: getComputedStyle(video).position,
			toolsTop: toolsRect.top,
			toolsBottom: toolsRect.bottom,
			infoDisplay: getComputedStyle(info).display,
			infoTop: infoRect.top,
			infoBottom: infoRect.bottom,
			nameTop: nameRect.top,
			nameBottom: nameRect.bottom,
			nameHeight: nameRect.height,
			enterTop: enterRect.top,
			enterBottom: enterRect.bottom,
			enterHeight: enterRect.height,
			termsTop: termsRect.top,
			termsBottom: termsRect.bottom,
			viewportHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight
		};
	});
}

function expectInsideScroller(layout, topKey, bottomKey, context) {
	expect(layout[topKey], context).toBeGreaterThanOrEqual(layout.scrollerTop - 1);
	expect(layout[bottomKey], context).toBeLessThanOrEqual(layout.scrollerBottom + 1);
}

test("mobile guest flow owns the route and reaches backstage", async ({ page }) => {
	await installInvite(page, { code: "MOB00001" });
	await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastMobileGuest")).toBeVisible({ timeout: 10000 });
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
	await expect(page.locator(".mcast-mobile__backstage-card")).toHaveCount(0);
	const noticeRail = page.locator('[data-mobile-step="backstage"] [data-mcast-notice-rail]');
	const backstageNotice = noticeRail.locator(".mcast-guest-ui__toast");
	await expect(backstageNotice).toBeVisible();
	await expect(backstageNotice).toContainText("You’re backstage");
	const noticePlacement = await noticeRail.evaluate((rail) => {
		const topbar = rail.closest(".mcast-mobile__dark-top").getBoundingClientRect();
		const notice = rail.getBoundingClientRect();
		const stage = document.querySelector(".mcast-mobile__backstage-layout").getBoundingClientRect();
		return {
			noticeTop: notice.top,
			noticeBottom: notice.bottom,
			topbarTop: topbar.top,
			topbarBottom: topbar.bottom,
			stageTop: stage.top,
			overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
		};
	});
	expect(noticePlacement.noticeTop).toBeGreaterThanOrEqual(noticePlacement.topbarTop);
	expect(noticePlacement.noticeBottom).toBeLessThanOrEqual(noticePlacement.topbarBottom);
	expect(noticePlacement.stageTop).toBeGreaterThanOrEqual(noticePlacement.topbarBottom);
	expect(noticePlacement.overflow).toBe(false);
});

test("mobile setup keeps portrait preview and required actions inside the viewport", async ({ page }) => {
	await installInvite(page, { code: "MOBFIT01" });
	await page.goto(inviteUrl("MOBFIT01"), { waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => document.getElementById("mcastMobileGuest")?.hasAttribute("data-step"), null, { timeout: 10000 });
	expect(await page.locator("#mcastMobileGuest").getAttribute("data-step")).toBe("permission");
	await page.locator("#mcastMobileAllowButton").click();
	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "setup", { timeout: 12000 });
	const previewVideo = page.locator("#mcastMobileSetupPreview video");
	await expect.poll(() => previewVideo.evaluate((video) => !!video.srcObject), { timeout: 8000 }).toBe(true);
	await previewVideo.evaluate((video) => {
		video.setAttribute("width", "360");
		video.setAttribute("height", "640");
		video.style.aspectRatio = "9 / 16";
	});

	for (const viewport of [
		{ width: 320, height: 500 },
		{ width: 320, height: 568 },
		{ width: 375, height: 635 },
		{ width: 375, height: 667 },
		{ width: 390, height: 640 },
		{ width: 390, height: 844 },
		{ width: 430, height: 932 }
	]) {
		await page.setViewportSize(viewport);
		const layout = await measureSetupLayout(page);
		expect(layout.overflowY, JSON.stringify(viewport)).toBe("hidden");
		expect(layout.scrollTop, JSON.stringify(viewport)).toBe(0);
		expect(layout.scrollHeight, JSON.stringify(viewport)).toBeLessThanOrEqual(layout.clientHeight + 1);
		expect(layout.cardHeight, JSON.stringify(viewport)).toBeLessThanOrEqual(175);
		expect(layout.previewOverflow, JSON.stringify(viewport)).toBe("hidden");
		expect(layout.videoPosition, JSON.stringify(viewport)).toBe("absolute");
		expect(layout.videoWidth, JSON.stringify(viewport)).toBeGreaterThan(0);
		expect(layout.videoHeight, JSON.stringify(viewport)).toBeGreaterThan(0);
		expect(layout.nameHeight, JSON.stringify(viewport)).toBeGreaterThanOrEqual(44);
		expect(layout.enterHeight, JSON.stringify(viewport)).toBeGreaterThanOrEqual(44);
		expect(layout.nameTop, JSON.stringify(viewport)).toBeGreaterThanOrEqual(layout.scrollerTop);
		expect(layout.nameBottom, JSON.stringify(viewport)).toBeLessThanOrEqual(layout.scrollerBottom + 1);
		expect(layout.enterTop, JSON.stringify(viewport)).toBeGreaterThanOrEqual(layout.scrollerTop);
		expect(layout.enterBottom, JSON.stringify(viewport)).toBeLessThanOrEqual(layout.scrollerBottom + 1);
		expect(layout.termsBottom, JSON.stringify(viewport)).toBeLessThanOrEqual(layout.viewportHeight + 1);
	}
});

test("guest route uses separated desktop and mobile shell assets", async ({ page }) => {
	const html = fs.readFileSync(path.join(__dirname, "..", "g", "index.html"), "utf8");
	expect(html).toContain("./g/desktop/DesktopRoomShell.css");
	expect(html).toContain("./g/desktop/DesktopRoomShell.js");
	expect(html).toContain("./g/mobile/MobileRoomShell.css");
	expect(html).toContain("./g/mobile/MobileRoomShell.js");
	expect(html.match(/data-mcast-notice-rail/g)).toHaveLength(4);
	expect(html.match(/data-mcast-footer-rail/g)).toHaveLength(4);
	expect(html).not.toContain("mcastDesktopBackstageMessage");
	expect(html).not.toContain("mcast-mobile__backstage-card");
	expect(html).not.toContain("mcast-guest-entry");
	expect(html).not.toContain("id=\"mcastGuestEntry\"");
	expect(html).not.toContain("data-mobile-step=\"entering\"");
	expect(html).not.toContain("mcastMobileEnteringTitle");

	await installInvite(page, { code: "MOB00001" });
	await page.goto(baseUrl + "?case=architecture", { waitUntil: "domcontentloaded" });
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

test("mobile action-required errors dock below content", async ({ page }) => {
	await installInvite(page, { code: "MOB00001" });
	await page.goto(baseUrl + "?case=footer-error", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "permission", { timeout: 6000 });
	await page.evaluate(() => {
		window.previewWebcam = function () {
			const error = new Error("Raw internal mobile device detail");
			error.name = "NotReadableError";
			return Promise.reject(error);
		};
	});
	await page.locator("#mcastMobileAllowButton").click();
	const footer = page.locator('[data-mobile-step="permission"] [data-mcast-footer-rail]');
	const recovery = footer.locator(":scope > [data-mcast-dialog-backdrop]");
	await expect(recovery).toBeVisible({ timeout: 6000 });
	await expect(recovery).not.toContainText("Raw internal mobile device detail");
	const placement = await recovery.evaluate((backdrop) => {
		const panel = backdrop.querySelector("[data-mcast-dialog]");
		const panelRect = panel.getBoundingClientRect();
		const footerRect = backdrop.parentElement.getBoundingClientRect();
		const contentRect = document.querySelector(".mcast-mobile__permission-center").getBoundingClientRect();
		return {
			contentBottom: Math.round(contentRect.bottom),
			footerTop: Math.round(footerRect.top),
			panelTop: Math.round(panelRect.top),
			panelBottom: Math.round(panelRect.bottom),
			viewportBottom: window.innerHeight,
			backdropPointerEvents: getComputedStyle(backdrop).pointerEvents,
			panelPointerEvents: getComputedStyle(panel).pointerEvents,
			ariaModal: panel.getAttribute("aria-modal"),
			overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
		};
	});
	expect(placement).toMatchObject({
		backdropPointerEvents: "none",
		panelPointerEvents: "auto",
		ariaModal: "false",
		overflow: false
	});
	expect(placement.contentBottom).toBeLessThanOrEqual(placement.footerTop);
	expect(placement.footerTop).toBe(placement.panelTop);
	expect(Math.abs(placement.viewportBottom - placement.panelBottom)).toBeLessThanOrEqual(1);
});

test("force-landscape params do not rotate mobile setup UI in portrait viewport", async ({ page }) => {
	await installInvite(page, { code: "MOB00001" });
	await page.goto(baseUrl + "?fl=1&forcelandscape=1", { waitUntil: "domcontentloaded" });
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

	test("keeps short setup layouts and keyboard focus accessible", async ({ page }) => {
		await installInvite(page, { code: "MOBLAND1" });
		await page.goto(inviteUrl("MOBLAND1"), { waitUntil: "domcontentloaded" });
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "permission", { timeout: 6000 });
		await page.locator("#mcastMobileAllowButton").click();
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "setup", { timeout: 12000 });
		await expect(page.locator('[data-mobile-step="setup"] .mcast-mobile__notice-rail.has-notice')).toBeVisible();

		for (const viewport of [
			{ width: 667, height: 375 },
			{ width: 568, height: 320 }
		]) {
			await page.setViewportSize(viewport);
			const layout = await measureSetupLayout(page);
			const context = JSON.stringify(viewport);
			expect(layout.overflowY, context).toBe("hidden");
			expect(layout.scrollTop, context).toBe(0);
			expect(layout.scrollHeight, context).toBeLessThanOrEqual(layout.clientHeight + 1);
			expect(layout.paddingLeft, context).toBeGreaterThanOrEqual(12);
			expect(layout.paddingRight, context).toBeGreaterThanOrEqual(12);
			expect(layout.cardHeight, context).toBeLessThanOrEqual(175);
			expect(layout.nameHeight, context).toBeGreaterThanOrEqual(44);
			expect(layout.enterHeight, context).toBeGreaterThanOrEqual(44);
			expectInsideScroller(layout, "cardTop", "cardBottom", context + " card");
			expectInsideScroller(layout, "toolsTop", "toolsBottom", context + " tools");
			expectInsideScroller(layout, "nameTop", "nameBottom", context + " name");
			expectInsideScroller(layout, "enterTop", "enterBottom", context + " enter");
			expectInsideScroller(layout, "termsTop", "termsBottom", context + " terms");
			if (layout.copyDisplay !== "none") {
				expectInsideScroller(layout, "copyTop", "copyBottom", context + " copy");
			}
			if (layout.infoDisplay !== "none") {
				expectInsideScroller(layout, "infoTop", "infoBottom", context + " info");
			}
		}

		await page.locator("#mcastMobileGuestName").focus();
		await page.setViewportSize({ width: 568, height: 240 });
		await expect.poll(() => page.locator(".mcast-mobile__setup-scroll").evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
		await page.locator("#mcastMobileGuestName").evaluate((element) => element.scrollIntoView({ block: "center" }));
		const keyboardLayout = await measureSetupLayout(page);
		expectInsideScroller(keyboardLayout, "nameTop", "nameBottom", "landscape keyboard focus");

		await page.setViewportSize({ width: 568, height: 320 });
		await page.locator("#mcastMobileSetupSettingsButton").click();
		const closeBox = await page.locator("#mcastMobileSettingsClose").boundingBox();
		expect(closeBox.width).toBeGreaterThanOrEqual(44);
		expect(closeBox.height).toBeGreaterThanOrEqual(44);
	});

	test("uses the dedicated landscape layout after joining", async ({ page }) => {
		await installInvite(page, { code: "MOB00001" });
		await page.goto(baseUrl + "?landscape=1", { waitUntil: "domcontentloaded" });
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "permission", { timeout: 6000 });
		await page.locator("#mcastMobileAllowButton").click();
		await expect(page.locator("#mcastMobileGuest")).toHaveAttribute("data-step", "setup", { timeout: 12000 });
		const setupLayout = await measureSetupLayout(page);
		expect(setupLayout.overflowY).toBe("hidden");
		expect(setupLayout.scrollHeight).toBeLessThanOrEqual(setupLayout.clientHeight + 1);
		expect(setupLayout.enterBottom).toBeLessThanOrEqual(setupLayout.viewportHeight + 1);
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
