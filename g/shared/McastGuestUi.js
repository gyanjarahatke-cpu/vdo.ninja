(function () {
	"use strict";

	var ownedPathPattern = /^\/s(?:\/|$)/i;
	var state = {
		root: null,
		toastStack: null,
		dialog: null,
		dialogHost: null,
		dialogResolve: null,
		dialogFocus: null,
		configuredRoute: null,
		observer: null,
		routeTitleObserver: null,
		toastSequence: 0,
		activeToast: null,
		toastTimer: 0,
		engineMessageSignatures: Object.create(null),
		legacyBrowserDialogsInstalled: false
	};

	var experiences = {
		guest: {
			kind: "guest",
			capabilities: { camera: true, microphone: true, screen: false, displayName: true },
			loadingTitle: "Preparing your guest studio",
			loadingMessage: "Checking this secure invite and getting your devices ready.",
			permissionTitle: "Set up your camera and microphone",
			permissionMessage: "Allow access so you can check your video and audio before entering.",
			permissionAction: "Allow camera and microphone",
			setupTitle: "Let’s set up your studio",
			setupMessage: "Entering the studio will not automatically start the broadcast.",
			previewLabel: "Camera preview",
			previewHint: "Start preview or enter the studio to allow camera and microphone access.",
			primaryAction: "Enter studio",
			connectedTitle: "You’re backstage",
			connectedMessage: "The host can bring you on screen when ready.",
			badge: "Backstage"
		},
		remote_camera: {
			kind: "remote_camera",
			capabilities: { camera: true, microphone: true, screen: false, displayName: false },
			loadingTitle: "Preparing remote camera",
			loadingMessage: "Checking the secure camera link and available devices.",
			permissionTitle: "Connect this camera",
			permissionMessage: "Allow camera and microphone access, then confirm the preview before connecting.",
			permissionAction: "Allow camera and microphone",
			setupTitle: "Remote camera setup",
			setupMessage: "Choose the camera and microphone this device should send to MCast Studio.",
			previewLabel: "Remote camera preview",
			previewHint: "Start preview to check the camera before connecting it.",
			primaryAction: "Connect camera",
			connectedTitle: "Remote camera connected",
			connectedMessage: "Keep this page open while MCast Studio is using this camera.",
			badge: "Connected"
		},
		remote_audio: {
			kind: "remote_audio",
			capabilities: { camera: false, microphone: true, screen: false, displayName: false },
			loadingTitle: "Preparing remote audio",
			loadingMessage: "Checking the secure audio link and available microphone.",
			permissionTitle: "Connect this microphone",
			permissionMessage: "Allow microphone access so you can check the level before connecting.",
			permissionAction: "Allow microphone",
			setupTitle: "Remote audio setup",
			setupMessage: "Choose the microphone this device should send to MCast Studio.",
			previewLabel: "Audio connection",
			previewHint: "Speak normally and confirm that the microphone meter responds.",
			primaryAction: "Connect microphone",
			connectedTitle: "Remote audio connected",
			connectedMessage: "Keep this page open while MCast Studio is using this microphone.",
			badge: "Connected"
		},
		remote_screen: {
			kind: "remote_screen",
			capabilities: { camera: false, microphone: false, screen: true, displayName: false },
			loadingTitle: "Preparing screen share",
			loadingMessage: "Checking the secure screen-share link.",
			permissionTitle: "Share a screen with MCast Studio",
			permissionMessage: "Choose a screen, window, or browser tab. Nothing is shared until you confirm.",
			permissionAction: "Choose what to share",
			setupTitle: "Share your screen",
			setupMessage: "Choose a screen, window, or browser tab. Sharing starts after you confirm in the browser.",
			previewLabel: "Screen share",
			previewHint: "Your selected screen will appear here while it is connected.",
			primaryAction: "Start sharing",
			connectedTitle: "Screen share connected",
			connectedMessage: "Keep this page open. You can stop sharing at any time.",
			badge: "Sharing"
		}
	};

	var api = {
		isOwnedRoute: isOwnedRoute,
		configureRoute: configureRoute,
		getExperience: getExperience,
		showToast: showToast,
		clearNotices: clearNotices,
		showInfo: showInfo,
		showMediaError: showMediaError,
		showConnectionError: showConnectionError,
		showRouteError: showRouteError,
		showDialog: showDialog,
		closeDialog: closeDialog,
		captureEngineMessage: captureEngineMessage,
		confirmEngineAction: confirmEngineAction,
		promptEngineAction: promptEngineAction,
		openSettings: openSettings,
		safeErrorMessage: safeErrorMessage
	};

	window.MCastGuestUi = api;
	installLegacyBrowserDialogGuard();
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initialize, { once: true });
	} else {
		initialize();
	}

	function initialize() {
		if (!isOwnedRoute()) {
			return;
		}
		ensureRoot();
		installLegacyUiQuarantine();
	}

	function isOwnedRoute() {
		var path = "";
		try {
			path = window.location && window.location.pathname || "";
		} catch (error) {}
		return ownedPathPattern.test(path) || path.toLowerCase() === "/g/index.html" ||
			document.documentElement.classList.contains("mcast-native-guest") ||
			document.documentElement.classList.contains("mcast-route-guest");
	}

	function configureRoute(route) {
		state.configuredRoute = route || {};
		var experience = getExperience();
		var root = document.documentElement;
		root.dataset.mcastExperience = experience.kind;
		root.classList.add("mcast-experience-" + experience.kind);
		initialize();
		window.dispatchEvent(new CustomEvent("mcast:route-ready", {
			detail: { route: state.configuredRoute, experience: experience }
		}));
		return experience;
	}

	function getExperience() {
		var route = state.configuredRoute || window.MCastRoute || {};
		var kind = normalizeExperienceKind(route.remoteSourceKind || route.mode || "guest");
		return experiences[kind] || experiences.guest;
	}

	function normalizeExperienceKind(value) {
		var normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
		if (normalized === "remote_camera" || normalized === "remote_audio" || normalized === "remote_screen") {
			return normalized;
		}
		return "guest";
	}

	function ensureRoot() {
		if (state.root && state.root.isConnected) {
			return state.root;
		}
		if (!document.body) {
			return null;
		}

		var root = document.getElementById("mcastGuestUiRoot");
		if (!root) {
			root = document.createElement("div");
			root.id = "mcastGuestUiRoot";
			root.className = "mcast-guest-ui";
			root.setAttribute("data-mcast-owned-ui", "true");
			root.innerHTML = [
				'<div class="mcast-guest-ui__toasts" data-mcast-toasts role="status" aria-live="polite" aria-atomic="false"></div>',
				'<div class="mcast-guest-ui__backdrop" data-mcast-dialog-backdrop hidden>',
					'<section class="mcast-guest-ui__dialog" data-mcast-dialog role="dialog" aria-modal="false" aria-labelledby="mcastGuestDialogTitle" aria-describedby="mcastGuestDialogMessage">',
						'<button class="mcast-guest-ui__close" data-mcast-dialog-close type="button" aria-label="Close">×</button>',
						'<div class="mcast-guest-ui__brand"><span class="mcast-guest-ui__brand-mark" aria-hidden="true"></span><span>MCast Studio</span></div>',
						'<div class="mcast-guest-ui__signal" data-mcast-dialog-signal aria-hidden="true">!</div>',
						'<p class="mcast-guest-ui__eyebrow" data-mcast-dialog-eyebrow>MCast Studio</p>',
						'<h2 id="mcastGuestDialogTitle" data-mcast-dialog-title></h2>',
						'<p id="mcastGuestDialogMessage" class="mcast-guest-ui__message" data-mcast-dialog-message></p>',
						'<p class="mcast-guest-ui__hint" data-mcast-dialog-hint hidden></p>',
						'<label class="mcast-guest-ui__input-wrap" data-mcast-dialog-input-wrap hidden><span data-mcast-dialog-input-label></span><input data-mcast-dialog-input autocomplete="off" maxlength="120"></label>',
						'<div class="mcast-guest-ui__actions" data-mcast-dialog-actions></div>',
					'</section>',
				'</div>'
			].join("");
			document.body.appendChild(root);
		}

		state.root = root;
		state.toastStack = root.querySelector("[data-mcast-toasts]");
		state.dialog = root.querySelector("[data-mcast-dialog-backdrop]");
		var closeButton = root.querySelector("[data-mcast-dialog-close]");
		if (closeButton && !closeButton.dataset.mcastWired) {
			closeButton.dataset.mcastWired = "true";
			closeButton.addEventListener("click", function () { closeDialog(false); });
		}
		if (state.dialog && !state.dialog.dataset.mcastWired) {
			state.dialog.dataset.mcastWired = "true";
			state.dialog.addEventListener("click", function (event) {
				if (event.target === state.dialog && state.dialog.dataset.dismissible === "true") {
					closeDialog(false);
				}
			});
		}
		return root;
	}

	function showToast(message, options) {
		options = options || {};
		var root = ensureRoot();
		if (!root) {
			return 0;
		}
		var plainMessage = safePlainText(message, "");
		if (!plainMessage) {
			clearNotices();
			return 0;
		}
		clearNotices();
		var noticeRail = resolveNoticeRail();
		var host = noticeRail || state.toastStack;
		if (!host) {
			return 0;
		}
		var toast = document.createElement("div");
		var id = ++state.toastSequence;
		toast.className = "mcast-guest-ui__toast mcast-guest-ui__toast--" + normalizeKind(options.kind || "info");
		toast.dataset.toastId = String(id);
		toast.innerHTML = '<span class="mcast-guest-ui__toast-dot" aria-hidden="true"></span><span></span>';
		toast.lastElementChild.textContent = plainMessage;
		toast.lastElementChild.title = plainMessage;
		host.appendChild(toast);
		host.classList.add("has-notice");
		state.activeToast = toast;
		window.requestAnimationFrame(function () {
			if (toast.isConnected) { toast.classList.add("is-visible"); }
		});
		var duration = clampNumber(options.duration, 1800, 30000, 10000);
		state.toastTimer = window.setTimeout(function () {
			dismissNotice(toast, host);
		}, duration);
		return id;
	}

	function clearNotices() {
		window.clearTimeout(state.toastTimer);
		state.toastTimer = 0;
		if (state.activeToast) {
			var host = state.activeToast.parentNode;
			state.activeToast.remove();
			if (host) { host.classList.remove("has-notice"); }
		}
		state.activeToast = null;
	}

	function dismissNotice(toast, host) {
		if (!toast) {
			return;
		}
		toast.classList.remove("is-visible");
		window.setTimeout(function () {
			if (toast.parentNode) { toast.remove(); }
			if (host && !host.querySelector(".mcast-guest-ui__toast")) { host.classList.remove("has-notice"); }
			if (state.activeToast === toast) {
				state.activeToast = null;
				state.toastTimer = 0;
			}
		}, 220);
	}

	function resolveNoticeRail() {
		var desktop = document.getElementById("mcastDesktopGuest");
		if (isRenderedShell(desktop) && desktop.dataset.step !== "loading") {
			return desktop.querySelector("[data-mcast-notice-rail]");
		}
		var mobile = document.getElementById("mcastMobileGuest");
		if (isRenderedShell(mobile)) {
			var step = String(mobile.dataset.step || "").replace(/[^a-z-]/g, "");
			var activePanel = step ? mobile.querySelector('[data-mobile-step="' + step + '"]') : null;
			return activePanel && activePanel.querySelector("[data-mcast-notice-rail]");
		}
		return null;
	}

	function resolveFooterRail() {
		var desktop = document.getElementById("mcastDesktopGuest");
		if (isRenderedShell(desktop)) {
			return desktop.querySelector("[data-mcast-footer-rail]");
		}
		var mobile = document.getElementById("mcastMobileGuest");
		if (isRenderedShell(mobile)) {
			var step = String(mobile.dataset.step || "").replace(/[^a-z-]/g, "");
			var activePanel = step ? mobile.querySelector('[data-mobile-step="' + step + '"]') : null;
			return activePanel && activePanel.querySelector("[data-mcast-footer-rail]");
		}
		return null;
	}

	function mountDialogHost(root) {
		var routeError = document.documentElement.classList.contains("mcast-route-error");
		var host = routeError ? root : resolveFooterRail();
		if (!host) {
			host = root;
		}
		if (state.dialogHost && state.dialogHost !== host && state.dialogHost.hasAttribute("data-mcast-footer-rail")) {
			state.dialogHost.hidden = true;
		}
		if (state.dialog.parentNode !== host) {
			host.appendChild(state.dialog);
		}
		if (host.hasAttribute("data-mcast-footer-rail")) {
			host.hidden = false;
		}
		state.dialogHost = host;
		return routeError;
	}

	function isRenderedShell(shell) {
		if (!shell || typeof window.getComputedStyle !== "function") {
			return false;
		}
		var style = window.getComputedStyle(shell);
		return style.display !== "none" && style.visibility !== "hidden";
	}

	function showInfo(title, message, options) {
		options = options || {};
		return showDialog({
			kind: options.kind || "info",
			eyebrow: options.eyebrow || "MCast Studio",
			title: title,
			message: message,
			hint: options.hint || "",
			dismissible: options.dismissible !== false,
			actions: options.actions || [{ label: "Got it", value: true, variant: "primary" }]
		});
	}

	function showMediaError(error, capability, options) {
		options = options || {};
		var copy = mediaErrorCopy(error, capability);
		return showDialog({
			kind: "error",
			eyebrow: copy.eyebrow,
			title: copy.title,
			message: copy.message,
			hint: copy.hint,
			dismissible: options.dismissible !== false,
			actions: options.actions || [{ label: "Close", value: false, variant: "primary" }]
		});
	}

	function showConnectionError(options) {
		options = options || {};
		return showDialog({
			kind: "error",
			eyebrow: "Connection interrupted",
			title: "MCast Studio lost the connection",
			message: "Check this device’s internet connection, then try connecting again.",
			hint: "Your camera, microphone, or screen is not being sent while this message is shown.",
			dismissible: true,
			actions: options.actions || [{ label: "Close", value: false, variant: "primary" }]
		});
	}

	function showRouteError(reason) {
		var copy = routeErrorCopy(reason);
		lockRouteErrorTitle();
		document.documentElement.classList.add("mcast-route-error");
		["mcastDesktopGuest", "mcastMobileGuest"].forEach(function (id) {
			var shell = document.getElementById(id);
			if (shell) {
				shell.setAttribute("aria-hidden", "true");
				shell.inert = true;
			}
		});
		return showDialog({
			kind: "error",
			eyebrow: "Secure invite",
			title: copy.title,
			message: copy.message,
			hint: copy.hint,
			dismissible: false,
			actions: [{
				label: "Try again",
				value: true,
				variant: "primary",
				onSelect: function () { window.location.reload(); }
			}]
		});
	}

	function lockRouteErrorTitle() {
		var expectedTitle = "Invite unavailable | MCast Studio";
		var applyTitle = function () {
			if (document.title !== expectedTitle) {
				document.title = expectedTitle;
			}
		};
		applyTitle();
		if (state.routeTitleObserver || typeof MutationObserver !== "function" || !document.head) {
			return;
		}
		state.routeTitleObserver = new MutationObserver(applyTitle);
		state.routeTitleObserver.observe(document.head, {
			childList: true,
			characterData: true,
			subtree: true
		});
	}

	function showDialog(options) {
		options = options || {};
		var root = ensureRoot();
		if (!root || !state.dialog) {
			return Promise.resolve(false);
		}
		if (state.dialogResolve) {
			state.dialogResolve(false);
			state.dialogResolve = null;
		}
		var routeError = mountDialogHost(root);

		var panel = state.dialog.querySelector("[data-mcast-dialog]");
		var kind = normalizeKind(options.kind || "info");
		panel.dataset.kind = kind;
		panel.setAttribute("aria-modal", routeError ? "true" : "false");
		setText(panel, "[data-mcast-dialog-eyebrow]", options.eyebrow || "MCast Studio");
		setText(panel, "[data-mcast-dialog-title]", options.title || "MCast Studio");
		setText(panel, "[data-mcast-dialog-message]", options.message || "Please check your setup and try again.");
		var hint = panel.querySelector("[data-mcast-dialog-hint]");
		hint.textContent = safePlainText(options.hint || "", "");
		hint.hidden = !hint.textContent;
		var signal = panel.querySelector("[data-mcast-dialog-signal]");
		signal.textContent = kind === "success" ? "✓" : kind === "warning" ? "!" : kind === "error" ? "!" : "i";

		var inputWrap = panel.querySelector("[data-mcast-dialog-input-wrap]");
		var input = panel.querySelector("[data-mcast-dialog-input]");
		var inputLabel = panel.querySelector("[data-mcast-dialog-input-label]");
		if (options.input) {
			inputWrap.hidden = false;
			inputLabel.textContent = safePlainText(options.input.label || "Value", "Value");
			input.type = options.input.type === "password" ? "password" : "text";
			input.value = safePlainText(options.input.value || "", "").slice(0, 120);
			input.placeholder = safePlainText(options.input.placeholder || "", "");
		} else {
			inputWrap.hidden = true;
			input.value = "";
		}

		var actions = panel.querySelector("[data-mcast-dialog-actions]");
		actions.innerHTML = "";
		var normalizedActions = Array.isArray(options.actions) && options.actions.length
			? options.actions
			: [{ label: "Close", value: false, variant: "primary" }];
		normalizedActions.forEach(function (action) {
			var button = document.createElement("button");
			button.type = "button";
			button.className = "mcast-guest-ui__button mcast-guest-ui__button--" + normalizeVariant(action.variant || "secondary");
			button.textContent = safePlainText(action.label || "Continue", "Continue");
			button.addEventListener("click", function () {
				var value = options.input && action.value !== false ? input.value : action.value;
				closeDialog(value);
				if (typeof action.onSelect === "function") {
					window.setTimeout(function () { action.onSelect(value); }, 0);
				}
			});
			actions.appendChild(button);
		});

		var dismissible = options.dismissible !== false;
		state.dialog.dataset.dismissible = dismissible ? "true" : "false";
		var closeButton = panel.querySelector("[data-mcast-dialog-close]");
		closeButton.hidden = !dismissible;
		state.dialog.hidden = false;
		document.documentElement.classList.add("mcast-guest-dialog-open");
		state.dialogFocus = document.activeElement;

		window.setTimeout(function () {
			var focusTarget = options.input ? input : actions.querySelector("button");
			if (focusTarget) { focusTarget.focus(); }
		}, 0);

		return new Promise(function (resolve) { state.dialogResolve = resolve; });
	}

	function closeDialog(value) {
		if (!state.dialog || state.dialog.hidden) {
			return;
		}
		state.dialog.hidden = true;
		if (state.dialogHost && state.dialogHost.hasAttribute("data-mcast-footer-rail")) {
			state.dialogHost.hidden = true;
		}
		document.documentElement.classList.remove("mcast-guest-dialog-open");
		var resolve = state.dialogResolve;
		state.dialogResolve = null;
		if (resolve) { resolve(value); }
		if (state.dialogFocus && typeof state.dialogFocus.focus === "function") {
			try { state.dialogFocus.focus(); } catch (error) {}
		}
		state.dialogFocus = null;
	}

	function captureEngineMessage(message, options) {
		if (!isOwnedRoute()) {
			return false;
		}
		options = options || {};
		var normalized = safePlainText(stripHtml(message), "").toLowerCase();
		if (!normalized) {
			return true;
		}
		var signature = normalized.slice(0, 180);
		var now = Date.now();
		if (state.engineMessageSignatures[signature] && now - state.engineMessageSignatures[signature] < 2500) {
			return true;
		}
		state.engineMessageSignatures[signature] = now;

		if (/waiting|not yet activated|backstage|host.*add/.test(normalized)) {
			showToast("You’re backstage. The host will bring you on screen when ready.", { kind: "info", duration: options.timeout || 10000 });
			return true;
		}
		if (/permission|notallowed|denied|camera|microphone|device|timed out|not found|notreadable|trackstart/.test(normalized)) {
			showMediaError({ name: inferMediaErrorName(normalized) }, inferCapability(normalized));
			return true;
		}
		if (/disconnect|network|offline|connection|socket|reconnect/.test(normalized)) {
			showConnectionError();
			return true;
		}
		showInfo(
			"MCast Studio needs your attention",
			"Check your device setup and connection, then try the action again.",
			{ hint: "No technical details have been shared on this screen." }
		);
		return true;
	}

	function confirmEngineAction(message) {
		var normalized = safePlainText(stripHtml(message), "").toLowerCase();
		var copy = /leave|hang up|disconnect|end/.test(normalized)
			? { title: "Leave this MCast session?", message: "Your camera, microphone, or screen will stop sending immediately." }
			: { title: "Continue in MCast Studio?", message: "Confirm this action to continue." };
		return showDialog({
			kind: "warning",
			eyebrow: "Confirmation",
			title: copy.title,
			message: copy.message,
			dismissible: true,
			actions: [
				{ label: "Cancel", value: false, variant: "secondary" },
				{ label: "Continue", value: true, variant: "primary" }
			]
		});
	}

	function promptEngineAction(message, options) {
		options = options || {};
		var normalized = safePlainText(stripHtml(message), "").toLowerCase();
		var isPassword = options.password || /password|passcode/.test(normalized);
		var isName = /name|label/.test(normalized);
		return showDialog({
			kind: "info",
			eyebrow: "Secure room",
			title: isPassword ? "Room access required" : isName ? "Enter your display name" : "Additional information required",
			message: isPassword ? "Enter the access code supplied by the host." : isName ? "Choose the name the host should see." : "Enter the requested value to continue.",
			input: {
				label: isPassword ? "Access code" : isName ? "Display name" : "Value",
				type: isPassword ? "password" : "text",
				value: options.value || ""
			},
			actions: [
				{ label: "Cancel", value: false, variant: "secondary" },
				{ label: "Continue", value: true, variant: "primary" }
			]
		});
	}

	function openSettings() {
		if (!isOwnedRoute()) {
			return false;
		}
		window.dispatchEvent(new CustomEvent("mcast:open-settings"));
		return true;
	}

	function safeErrorMessage(error, capability) {
		return mediaErrorCopy(error, capability).message;
	}

	function mediaErrorCopy(error, capability) {
		var name = String(error && error.name || "").toLowerCase();
		var requested = normalizeCapability(capability);
		var noun = requested === "microphone" ? "microphone" : requested === "screen" ? "screen" : requested === "camera and microphone" ? "camera and microphone" : "camera";

		if (/notallowed|permissiondenied|security/.test(name)) {
			return {
				eyebrow: "Permission needed",
				title: requested === "screen" ? "Screen sharing wasn’t allowed" : "Allow " + noun + " access",
				message: requested === "screen"
					? "Choose a screen, window, or tab and allow the browser to share it with MCast Studio."
					: "Use the browser’s site controls to allow " + noun + " access, then try again.",
				hint: requested === "screen" ? "Nothing was shared." : "MCast Studio cannot start the device until permission is allowed."
			};
		}
		if (/notfound|devicesnotfound/.test(name)) {
			return {
				eyebrow: "Device not found",
				title: "No " + noun + " is available",
				message: "Connect or enable the device, then open settings and choose it again.",
				hint: "If the device was just connected, refresh the page once."
			};
		}
		if (/notreadable|trackstart|abort/.test(name)) {
			return {
				eyebrow: "Device is busy",
				title: requested === "screen" ? "Screen sharing could not start" : "The " + noun + " could not start",
				message: requested === "screen"
					? "Close the system sharing prompt and try choosing the screen again."
					: "Another app or browser tab may be using the device. Close it, then try again.",
				hint: "You can also choose a different device in MCast settings."
			};
		}
		if (/overconstrained|constraint/.test(name)) {
			return {
				eyebrow: "Device setup",
				title: "This device setting is not available",
				message: "Choose another device or use its default quality setting, then try again.",
				hint: "MCast Studio has not started sending media."
			};
		}
		return {
			eyebrow: "Couldn’t start media",
			title: requested === "screen" ? "Screen sharing could not start" : "The " + noun + " could not start",
			message: "Check the device connection and browser permission, then try again.",
			hint: "If the issue continues, refresh this secure link and reconnect."
		};
	}

	function routeErrorCopy(reason) {
		var normalized = String(reason || "").toLowerCase();
		if (/expired|410/.test(normalized)) {
			return {
				title: "This invite has expired",
				message: "Ask the host to create a new MCast Studio link.",
				hint: "For your security, expired links cannot be reopened."
			};
		}
		if (/missing|invalid|not valid|unauthorized|401|403|404/.test(normalized)) {
			return {
				title: "This invite is not valid",
				message: "Check that the complete MCast Studio link was opened, or ask the host for a new one.",
				hint: "No camera, microphone, or screen has been shared."
			};
		}
		return {
			title: "This invite could not be opened",
			message: "Check your internet connection and try again.",
			hint: "If the link still does not open, ask the host to create a new invite."
		};
	}

	function installLegacyUiQuarantine() {
		if (!isOwnedRoute() || state.observer || !document.body) {
			return;
		}
		document.documentElement.classList.add("mcast-owned-guest-ui");
		document.body.classList.add("mcast-owned-guest-ui");
		quarantineLegacyNodes(document.body, false);
		state.observer = new MutationObserver(function (records) {
			records.forEach(function (record) {
				Array.prototype.forEach.call(record.addedNodes || [], function (node) {
					if (node && node.nodeType === 1) { quarantineLegacyNodes(node, true); }
				});
			});
		});
		state.observer.observe(document.body, { childList: true, subtree: true });
	}

	function quarantineLegacyNodes(scope, captureActiveMessage) {
		var selectors = [
			".alertModal", ".promptModal", "#promptModal", "#modalBackdrop", ".modalBackdrop", ".opaqueBackdrop",
			".customModelPopup", "#messagePopup", ".startupWarning", ".cameraTip", "#popupSelector"
		].join(",");
		var nodes = [];
		if (scope.matches && scope.matches(selectors)) { nodes.push(scope); }
		if (scope.querySelectorAll) {
			nodes = nodes.concat(Array.prototype.slice.call(scope.querySelectorAll(selectors)));
		}
		nodes.forEach(function (node) {
			if (node.closest && node.closest("#mcastGuestUiRoot")) { return; }
			var shouldCapture = captureActiveMessage && isActiveLegacyUi(node);
			node.setAttribute("data-mcast-upstream-ui", "quarantined");
			if (shouldCapture && !node.dataset.mcastCaptured) {
				node.dataset.mcastCaptured = "true";
				captureEngineMessage(node.textContent || "");
			}
		});
	}

	function isActiveLegacyUi(node) {
		if (!node || node.hidden || node.getAttribute("aria-hidden") === "true") {
			return false;
		}
		if (node.classList && node.classList.contains("hidden")) {
			return false;
		}
		var inlineDisplay = node.style && String(node.style.display || "").toLowerCase();
		var inlineVisibility = node.style && String(node.style.visibility || "").toLowerCase();
		if (inlineDisplay === "none" || inlineVisibility === "hidden") {
			return false;
		}
		return !!safePlainText(node.textContent || "", "");
	}

	function installLegacyBrowserDialogGuard() {
		if (state.legacyBrowserDialogsInstalled || !isOwnedRoute()) {
			return;
		}
		state.legacyBrowserDialogsInstalled = true;
		window.alert = function (message) {
			captureEngineMessage(message);
		};
		window.confirm = function (message) {
			showInfo("Confirmation required", "Use the visible MCast Studio controls to continue or cancel this action.", { kind: "warning" });
			return false;
		};
		window.prompt = function (message) {
			promptEngineAction(message);
			return null;
		};
	}

	function inferMediaErrorName(message) {
		if (/denied|permission|notallowed/.test(message)) { return "NotAllowedError"; }
		if (/not found|couldn.t find|no camera|no microphone/.test(message)) { return "NotFoundError"; }
		if (/busy|already.*use|notreadable|trackstart/.test(message)) { return "NotReadableError"; }
		return "AbortError";
	}

	function inferCapability(message) {
		if (/screen/.test(message)) { return "screen"; }
		if (/microphone|mic/.test(message) && !/camera/.test(message)) { return "microphone"; }
		if (/camera/.test(message) && /microphone|audio|mic/.test(message)) { return "camera and microphone"; }
		return "camera";
	}

	function normalizeCapability(value) {
		var capability = String(value || "camera").toLowerCase();
		if (capability === "screen") { return "screen"; }
		if (capability === "microphone" || capability === "audio") { return "microphone"; }
		if (capability.indexOf("microphone") >= 0 && capability.indexOf("camera") >= 0) { return "camera and microphone"; }
		return "camera";
	}

	function normalizeKind(value) {
		return /^(info|success|warning|error)$/.test(value) ? value : "info";
	}

	function normalizeVariant(value) {
		return /^(primary|secondary|danger)$/.test(value) ? value : "secondary";
	}

	function safePlainText(value, fallback) {
		var text = String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
		return (text || fallback || "").slice(0, 320);
	}

	function stripHtml(value) {
		var container = document.createElement("div");
		container.innerHTML = String(value == null ? "" : value);
		return container.textContent || "";
	}

	function setText(scope, selector, value) {
		var element = scope.querySelector(selector);
		if (element) { element.textContent = safePlainText(value, ""); }
	}

	function clampNumber(value, min, max, fallback) {
		var number = Number(value);
		return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
	}
})();
