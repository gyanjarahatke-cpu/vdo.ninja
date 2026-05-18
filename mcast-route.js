(function () {
	"use strict";

	var shortInviteResolveUrl = "https://mcast-studio.web.app/api/vdoShortInviteResolve";
	var tokenResolveUrl = "https://mcast-studio.web.app/api/vdoTokenResolve";
	var roomTicketResolveUrl = "https://mcast-studio.web.app/api/vdoRoomTicketResolve";
	var rawPath = (window.location.pathname || "").replace(/\/+$/, "");
	var path = rawPath.toLowerCase();
	var route = isGuestInvitePath(path) ? "guest" : isCallPath(path) ? "call" : "";
	if (!route) {
		return;
	}
	var guestJoinPreferences = {
		audio: readGuestPreference("audio", true),
		video: readGuestPreference("video", true),
		joined: false
	};

	document.documentElement.classList.add("mcast-route");
	document.documentElement.classList.add(route === "guest" ? "mcast-guest" : "mcast-vcall");

	if (route === "guest") {
		installGuestShellStyles();
		document.addEventListener("DOMContentLoaded", function () {
			ensureGuestJoinShell();
			if (window.MCastRoute) {
				updateGuestJoinStatus(window.MCastRoute.mode, window.MCastRoute.state);
			}
		});
	}

	var search = window.location.search || "";
	var params = new URLSearchParams(search);
	var decoded = "";
	var token = params.get("t") || params.get("token") || "";
	var shortCode = route === "call"
		? params.get("r") || params.get("s") || params.get("code")
		: params.get("s") || params.get("code") || readShortInviteCodeFromPath(rawPath);
	if (token) {
		if (route === "call") {
			showInviteError("This MCast Studio room link is not authorized.");
			return;
		}
		decoded = resolvePackedToken(token, route);
	} else if (shortCode) {
		decoded = resolveStoredRoute(shortCode, route);
	} else if (route === "guest" && search.length > 1) {
		decoded = search.substring(1);
	} else if (route === "call") {
		showInviteError("This MCast Studio room link is not authorized.");
		return;
	}

	if (!decoded) {
		return;
	}

	decoded = applyRouteDefaults(decoded, route);
	applyRouteMetadata(decoded, route);
	if (typeof session !== "undefined") {
		session.decrypted = "?" + decoded.replace(/^\?/, "");
		session.nohistory = true;
	}

	function applyRouteDefaults(query, currentRoute) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		if (currentRoute === "guest") {
			setFlag(routedParams, "webcam");
			setFlag(routedParams, "nosettings");
			setFlag(routedParams, "mcastguest");
			setFlag(routedParams, "mcastprejoin");
			if (!routedParams.has("mcastautojoin")) {
				routedParams.delete("autostart");
			}
			var mcastMode = normalizeRouteToken(routedParams.get("mcastmode") || "", "");
			if (!routedParams.has("push") && (mcastMode === "meeting" || mcastMode === "classroom" || mcastMode === "webinar")) {
				routedParams.set("push", getOrCreateSingleLinkGuestPush(routedParams));
				routedParams.set("mcastsinglelink", "1");
			}
			if (routedParams.has("mcastautojoin")) {
				setFlag(routedParams, "autostart");
			}
			applyStoredGuestIdentity(routedParams);
		} else if (currentRoute === "call") {
			if (routedParams.has("mcastbridge")) {
				setFlag(routedParams, "showdirector");
				setFlag(routedParams, "mutespeaker");
				setFlag(routedParams, "autostart");
				routedParams.set("quality", "0");
			}
			if (routedParams.has("mcastsource") || routedParams.has("cbguestkey")) {
				setFlag(routedParams, "cleanoutput");
				setFlag(routedParams, "cleanviewer");
				setFlag(routedParams, "transparent");
				setFlag(routedParams, "mutespeaker");
				setFlag(routedParams, "autostart");
				routedParams.set("mcastsource", "1");
				if (!routedParams.has("quality")) {
					routedParams.set("quality", routedParams.get("mcastrouting") === "low_bitrate" ? "2" : "0");
				}
			}
		}
		return serializeParams(routedParams);
	}

	function applyRouteMetadata(query, currentRoute) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		var mode = normalizeRouteToken(routedParams.get("mcastmode") || "stream_guest", "stream_guest");
		var role = normalizeRouteToken(routedParams.get("mcastrole") || (currentRoute === "guest" ? "participant" : "source"), "participant");
		var state = normalizeRouteToken(routedParams.get("mcaststate") || "backstage", "backstage");
		var routing = normalizeRouteToken(routedParams.get("mcastrouting") || "low_bitrate", "low_bitrate");
		var root = document.documentElement;
		root.classList.add("mcast-mode-" + mode);
		root.classList.add("mcast-role-" + role);
		root.classList.add("mcast-state-" + state);
		root.classList.add("mcast-routing-" + routing);
		window.MCastRoute = {
			route: currentRoute,
			mode: mode,
			role: role,
			state: state,
			routing: routing
		};
		updateRouteTitle(mode, role);
		updateGuestJoinStatus(mode, state);
	}

	function normalizeRouteToken(value, fallback) {
		var normalized = (value || "").toString().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
		return normalized || fallback;
	}

	function isGuestInvitePath(currentPath) {
		return /^\/(?:g|m|c|s|w|p|i)(?:\/|$)/.test(currentPath || "");
	}

	function isCallPath(currentPath) {
		return currentPath === "/vcall" || (currentPath || "").indexOf("/vcall/") === 0;
	}

	function updateRouteTitle(mode, role) {
		var modeTitle = mode.replace(/_/g, " ").replace(/\b\w/g, function (match) {
			return match.toUpperCase();
		});
		if (role === "participant") {
			document.title = "MCast Studio " + modeTitle;
		}
	}

	function installGuestShellStyles() {
		if (document.getElementById("mcastGuestShellStyles")) {
			return;
		}

		var style = document.createElement("style");
		style.id = "mcastGuestShellStyles";
		style.textContent = [
			"html.mcast-guest,html.mcast-guest body{background:#111315!important;min-height:100%;}",
			"html.mcast-guest body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;letter-spacing:0!important;overflow:hidden!important;}",
			"html.mcast-guest #header,html.mcast-guest #mainmenu,html.mcast-guest #head1,html.mcast-guest #head1a,html.mcast-guest #head3,html.mcast-guest #head3a,html.mcast-guest #dropButton,html.mcast-guest #container-1,html.mcast-guest #container-2,html.mcast-guest #container-4,html.mcast-guest #container-5,html.mcast-guest #container-6,html.mcast-guest #container-7,html.mcast-guest #container-8,html.mcast-guest #container-9,html.mcast-guest #credits,html.mcast-guest #legal{display:none!important;}",
			"html.mcast-guest #mcastJoining{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;color:#eef2f7;background:#111315;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));pointer-events:auto;}",
			"html.mcast-guest #mcastJoining.mcast-ready{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .22s ease,visibility .22s ease;}",
			"html.mcast-guest .mcast-join-panel{width:min(1060px,100%);min-height:min(720px,calc(100dvh - 32px));display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,420px);overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#1a1d21;box-shadow:0 22px 70px rgba(0,0,0,.34);}",
			"html.mcast-guest .mcast-join-preview{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-height:420px;background:#1b1f25;padding:18px;}",
			"html.mcast-guest .mcast-join-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#f8fafc;min-width:0;}",
			"html.mcast-guest .mcast-join-brand{display:flex;align-items:center;gap:10px;min-width:0;}",
			"html.mcast-guest .mcast-join-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.12);overflow:hidden;flex:0 0 auto;}",
			"html.mcast-guest .mcast-join-logo{display:block;width:100%;height:100%;object-fit:cover;}",
			"html.mcast-guest .mcast-join-brand-title{font-size:14px;font-weight:760;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-join-brand-subtitle{margin-top:2px;color:#a8b3c2;font-size:12px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-join-mode{display:inline-flex;align-items:center;gap:7px;max-width:46%;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.07);color:#e8edf5;font-size:12px;font-weight:720;padding:7px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-join-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.16);flex:0 0 auto;}",
			"html.mcast-guest .mcast-preview-stage{position:absolute;inset:72px 18px 104px 18px;display:grid;place-items:center;border-radius:8px;background:#0b0d10;overflow:hidden;}",
			"html.mcast-guest .mcast-preview-avatar{display:grid;place-items:center;width:118px;height:118px;border-radius:50%;background:#2a3038;color:#d7dde7;font-size:42px;font-weight:760;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}",
			"html.mcast-guest .mcast-preview-label{position:absolute;left:14px;bottom:12px;max-width:calc(100% - 28px);padding:6px 9px;border-radius:6px;background:rgba(0,0,0,.62);color:#f8fafc;font-size:12px;font-weight:680;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-preview-off{position:absolute;inset:0;display:none;place-items:center;background:#0b0d10;color:#a8b3c2;font-size:13px;font-weight:680;text-align:center;padding:24px;}",
			"html.mcast-guest #mcastJoining.mcast-video-off .mcast-preview-off{display:grid;}",
			"html.mcast-guest .mcast-device-row{position:relative;z-index:1;display:flex;justify-content:center;gap:14px;margin-top:auto;}",
			"html.mcast-guest .mcast-device-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:128px;height:42px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#2a2f36;color:#f8fafc;font-size:13px;font-weight:720;cursor:pointer;}",
			"html.mcast-guest .mcast-device-button:hover{background:#343b44;}",
			"html.mcast-guest .mcast-device-button.is-off{background:#b91c1c;border-color:#dc2626;color:#fff;}",
			"html.mcast-guest .mcast-device-icon{display:grid;place-items:center;width:20px;height:20px;flex:0 0 auto;}",
			"html.mcast-guest .mcast-device-icon svg{display:block;width:19px;height:19px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}",
			"html.mcast-guest .mcast-join-form{display:flex;flex-direction:column;justify-content:center;background:#f7f8fa;color:#1f2937;padding:34px 30px;}",
			"html.mcast-guest .mcast-join-heading{color:#111827;font-size:26px;line-height:1.18;font-weight:780;margin:0 0 10px 0;}",
			"html.mcast-guest .mcast-join-message{color:#4b5563;font-size:14px;line-height:1.52;margin:0 0 24px 0;}",
			"html.mcast-guest .mcast-field{display:flex;flex-direction:column;gap:7px;margin-bottom:14px;}",
			"html.mcast-guest .mcast-field-label{font-size:12px;font-weight:760;color:#374151;}",
			"html.mcast-guest .mcast-name-input{height:44px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;color:#111827;font:650 15px Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:0 12px;outline:none;}",
			"html.mcast-guest .mcast-name-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14);}",
			"html.mcast-guest .mcast-check-row{display:flex;align-items:center;gap:9px;color:#4b5563;font-size:13px;font-weight:620;margin:2px 0 18px 0;}",
			"html.mcast-guest .mcast-check-row input{width:16px;height:16px;accent-color:#2563eb;}",
			"html.mcast-guest .mcast-join-action{height:46px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-size:15px;font-weight:780;cursor:pointer;}",
			"html.mcast-guest .mcast-join-action:hover{background:#1d4ed8;}",
			"html.mcast-guest .mcast-join-action:disabled{opacity:.65;cursor:default;}",
			"html.mcast-guest .mcast-join-status{display:flex;align-items:center;gap:10px;margin-top:16px;padding:11px 12px;border:1px solid #dde3ea;border-radius:6px;background:#fff;color:#334155;font-size:13px;font-weight:650;}",
			"html.mcast-guest .mcast-join-spinner{width:15px;height:15px;border-radius:50%;border:2px solid rgba(37,99,235,.22);border-top-color:#2563eb;animation:mcastSpin .9s linear infinite;flex:0 0 auto;}",
			"html.mcast-guest .mcast-join-footer{margin-top:16px;color:#6b7280;font-size:11px;line-height:1.45;}",
			"html.mcast-guest .mcast-terms{margin-top:18px;color:#6b7280;font-size:11px;line-height:1.45;}",
			"html.mcast-guest .prompt,html.mcast-guest [role='dialog'],html.mcast-guest .modal,html.mcast-guest #passwordPrompt{z-index:10000!important;}",
			"@keyframes mcastSpin{to{transform:rotate(360deg);}}",
			"@media (max-width:760px){html.mcast-guest #mcastJoining{padding:0;}html.mcast-guest .mcast-join-panel{width:100%;height:100dvh;min-height:100dvh;border:0;border-radius:0;grid-template-columns:1fr;grid-template-rows:minmax(42dvh,1fr) auto;}html.mcast-guest .mcast-join-preview{min-height:42dvh;padding:14px;}html.mcast-guest .mcast-preview-stage{inset:64px 14px 84px 14px;}html.mcast-guest .mcast-join-form{padding:24px 20px 20px 20px;justify-content:flex-start;}html.mcast-guest .mcast-join-heading{font-size:24px;}html.mcast-guest .mcast-device-row{gap:10px;}html.mcast-guest .mcast-device-button{min-width:116px;height:40px;font-size:12px;}}",
			"@media (orientation:landscape) and (max-height:540px){html.mcast-guest #mcastJoining{padding:8px;}html.mcast-guest .mcast-join-panel{height:calc(100dvh - 16px);min-height:0;grid-template-columns:minmax(0,1fr) 360px;}html.mcast-guest .mcast-join-preview{min-height:0;padding:12px;}html.mcast-guest .mcast-preview-stage{inset:58px 12px 72px 12px;}html.mcast-guest .mcast-preview-avatar{width:88px;height:88px;font-size:32px;}html.mcast-guest .mcast-join-form{padding:20px;}html.mcast-guest .mcast-join-heading{font-size:21px;margin-bottom:7px;}html.mcast-guest .mcast-join-message{font-size:13px;margin-bottom:14px;}html.mcast-guest .mcast-device-button{height:38px;min-width:112px;}html.mcast-guest .mcast-terms,html.mcast-guest .mcast-join-footer{display:none;}}",
			"@media (max-width:380px){html.mcast-guest .mcast-device-row{gap:8px;}html.mcast-guest .mcast-device-button{min-width:0;flex:1;padding:0 10px;}html.mcast-guest .mcast-join-mode{max-width:42%;}html.mcast-guest .mcast-join-heading{font-size:22px;}}"
		].join("");
		document.head.appendChild(style);
	}

	function ensureGuestJoinShell() {
		if (route !== "guest") {
			return null;
		}

		var existing = document.getElementById("mcastJoining");
		if (existing) {
			return existing;
		}

		var shell = document.createElement("div");
		shell.id = "mcastJoining";
		shell.setAttribute("aria-live", "polite");
		shell.innerHTML = [
			"<section class=\"mcast-join-panel\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"mcastJoinHeading\">",
			"<div class=\"mcast-join-preview\">",
			"<div class=\"mcast-join-topbar\">",
			"<div class=\"mcast-join-brand\"><div class=\"mcast-join-mark\"><img class=\"mcast-join-logo\" src=\"./media/mcast-apple-touch-icon.png\" alt=\"\"></div><div><div class=\"mcast-join-brand-title\">MCast Studio</div><div class=\"mcast-join-brand-subtitle\">Remote session</div></div></div>",
			"<div class=\"mcast-join-mode\"><span class=\"mcast-join-dot\"></span><span data-mcast-mode>Secure room</span></div>",
			"</div>",
			"<div class=\"mcast-preview-stage\"><div class=\"mcast-preview-avatar\" data-mcast-avatar>G</div><div class=\"mcast-preview-off\">Camera is off</div><div class=\"mcast-preview-label\" data-mcast-preview-name>Guest</div></div>",
			"<div class=\"mcast-device-row\" aria-label=\"Device controls\">",
			"<button type=\"button\" class=\"mcast-device-button\" data-mcast-audio-toggle><span class=\"mcast-device-icon\" data-mcast-audio-icon aria-hidden=\"true\"></span><span data-mcast-audio-label>Mute</span></button>",
			"<button type=\"button\" class=\"mcast-device-button\" data-mcast-video-toggle><span class=\"mcast-device-icon\" data-mcast-video-icon aria-hidden=\"true\"></span><span data-mcast-video-label>Stop Video</span></button>",
			"</div>",
			"</div>",
			"<div class=\"mcast-join-form\">",
			"<h1 id=\"mcastJoinHeading\" class=\"mcast-join-heading\" data-mcast-heading>Join your session</h1>",
			"<p class=\"mcast-join-message\" data-mcast-message>Check your name and devices before entering.</p>",
			"<label class=\"mcast-field\"><span class=\"mcast-field-label\">Your name</span><input class=\"mcast-name-input\" data-mcast-name type=\"text\" autocomplete=\"name\" autocorrect=\"off\" autocapitalize=\"words\" maxlength=\"60\" placeholder=\"Enter your name\"></label>",
			"<label class=\"mcast-check-row\"><input data-mcast-remember type=\"checkbox\" checked><span>Remember my name on this device</span></label>",
			"<button type=\"button\" class=\"mcast-join-action\" data-mcast-join>Join</button>",
			"<div class=\"mcast-join-status\"><span class=\"mcast-join-spinner\"></span><span data-mcast-status>Ready to join</span></div>",
			"<div class=\"mcast-join-footer\">Use headphones when possible. Keep this tab open while the host prepares the session.</div>",
			"<div class=\"mcast-terms\">By joining, you allow this browser to use your microphone and camera for this MCast Studio session.</div>",
			"</div>",
			"</section>"
		].join("");
		document.body.appendChild(shell);
		hydrateGuestJoinShell(shell);
		return shell;
	}

	function updateGuestJoinStatus(mode, state) {
		if (route !== "guest") {
			return;
		}
		var shell = ensureGuestJoinShell();
		if (!shell) {
			return;
		}
		var profile = getGuestShellProfile(mode, state);
		setShellText(shell, "[data-mcast-mode]", profile.modeTitle);
		setShellText(shell, "[data-mcast-heading]", profile.heading);
		setShellText(shell, "[data-mcast-message]", profile.message);
		setShellText(shell, "[data-mcast-status]", profile.status);
	}

	function hydrateGuestJoinShell(shell) {
		var nameInput = shell.querySelector("[data-mcast-name]");
		var rememberInput = shell.querySelector("[data-mcast-remember]");
		var joinButton = shell.querySelector("[data-mcast-join]");
		var audioButton = shell.querySelector("[data-mcast-audio-toggle]");
		var videoButton = shell.querySelector("[data-mcast-video-toggle]");
		var rememberedName = readStoredGuestName();

		if (nameInput) {
			nameInput.value = rememberedName;
			nameInput.addEventListener("input", function () {
				updateGuestPreviewName(shell, nameInput.value);
			});
			nameInput.addEventListener("keydown", function (event) {
				if (event.key === "Enter") {
					event.preventDefault();
					startGuestJoinFromShell(shell);
				}
			});
		}
		if (rememberInput) {
			rememberInput.checked = readGuestPreference("rememberName", true);
		}
		if (joinButton) {
			joinButton.addEventListener("click", function () {
				startGuestJoinFromShell(shell);
			});
		}
		if (audioButton) {
			audioButton.addEventListener("click", function () {
				guestJoinPreferences.audio = !guestJoinPreferences.audio;
				writeGuestPreference("audio", guestJoinPreferences.audio);
				renderGuestDeviceControls(shell);
			});
		}
		if (videoButton) {
			videoButton.addEventListener("click", function () {
				guestJoinPreferences.video = !guestJoinPreferences.video;
				writeGuestPreference("video", guestJoinPreferences.video);
				renderGuestDeviceControls(shell);
			});
		}

		updateGuestPreviewName(shell, rememberedName);
		renderGuestDeviceControls(shell);
	}

	function startGuestJoinFromShell(shell) {
		if (!shell || guestJoinPreferences.joined) {
			return;
		}

		var nameInput = shell.querySelector("[data-mcast-name]");
		var rememberInput = shell.querySelector("[data-mcast-remember]");
		var joinButton = shell.querySelector("[data-mcast-join]");
		var name = nameInput ? nameInput.value.trim() : "";
		var rememberName = rememberInput ? rememberInput.checked : true;

		guestJoinPreferences.joined = true;
		writeGuestPreference("rememberName", rememberName);
		writeGuestPreference("audio", guestJoinPreferences.audio);
		writeGuestPreference("video", guestJoinPreferences.video);
		if (rememberName && name) {
			writeStoredGuestName(name);
		} else if (!rememberName) {
			writeStoredGuestName("");
		}

		applyGuestNameToNativeSession(name);
		setShellText(shell, "[data-mcast-status]", "Starting camera and microphone...");
		if (joinButton) {
			joinButton.disabled = true;
			joinButton.textContent = "Joining...";
		}

		waitForNativeJoinAndStart(shell, 0);
	}

	function waitForNativeJoinAndStart(shell, attempt) {
		if (tryStartNativeGuestJoin(shell)) {
			return;
		}
		if (attempt >= 80) {
			setShellText(shell, "[data-mcast-status]", "Still preparing. Check browser camera and microphone permissions.");
			return;
		}
		window.setTimeout(function () {
			waitForNativeJoinAndStart(shell, attempt + 1);
		}, 250);
	}

	function tryStartNativeGuestJoin(shell) {
		if (route === "guest") {
			return tryStartNativeGuestWebcamJoin(shell);
		}

		var starter = null;
		if (typeof window.press2talk === "function") {
			starter = window.press2talk;
		} else if (typeof press2talk === "function") {
			starter = press2talk;
		}
		var nativeButton = document.getElementById("press2talk");

		try {
			if (starter && nativeButton) {
				Promise.resolve(starter(true)).then(function () {
					applyGuestMediaPreferencesLater();
					setShellText(shell, "[data-mcast-status]", "Connected. Waiting for host routing...");
					window.setTimeout(function () {
						shell.classList.add("mcast-ready");
					}, 450);
				}).catch(function (error) {
					console.error("MCast guest join failed", error);
					setShellText(shell, "[data-mcast-status]", "Could not start media. Check browser permissions and try again.");
					resetGuestJoinButton(shell);
				});
				return true;
			}

			if (nativeButton && typeof nativeButton.click === "function") {
				nativeButton.click();
				applyGuestMediaPreferencesLater();
				setShellText(shell, "[data-mcast-status]", "Connected. Waiting for host routing...");
				window.setTimeout(function () {
					shell.classList.add("mcast-ready");
				}, 450);
				return true;
			}
		} catch (error) {
			console.error("MCast guest join start failed", error);
			setShellText(shell, "[data-mcast-status]", "Could not start media. Check browser permissions and try again.");
			resetGuestJoinButton(shell);
			return true;
		}

		return false;
	}

	function tryStartNativeGuestWebcamJoin(shell) {
		if (typeof session === "undefined") {
			return false;
		}
		if (typeof requestBasicPermissions !== "function" || typeof setupWebcamSelection !== "function" || typeof publishWebcam !== "function") {
			return false;
		}

		try {
			session.autostart = false;
			applyGuestMediaPreferences();
			var constraints = {
				audio: !!guestJoinPreferences.audio,
				video: !!guestJoinPreferences.video
			};
			var miconly = !constraints.video;
			setShellText(shell, "[data-mcast-status]", "Allow camera and microphone permissions...");
			requestBasicPermissions(constraints, function (nativeMicOnly) {
				try {
					setupWebcamSelection(nativeMicOnly || miconly);
				} catch (setupError) {
					console.error("MCast guest setup failed", setupError);
					setShellText(shell, "[data-mcast-status]", "Could not prepare media. Check browser permissions and try again.");
					resetGuestJoinButton(shell);
					return;
				}
				waitForNativeWebcamReadyAndPublish(shell, nativeMicOnly || miconly, 0);
			}, miconly);
			window.setTimeout(function () {
				if (guestJoinPreferences.joined && !hasLiveGuestMedia()) {
					setShellText(shell, "[data-mcast-status]", "Waiting for browser permission...");
				}
			}, 1800);
			return true;
		} catch (error) {
			console.error("MCast guest webcam start failed", error);
			setShellText(shell, "[data-mcast-status]", "Could not start media. Check browser permissions and try again.");
			resetGuestJoinButton(shell);
			return true;
		}
	}

	function waitForNativeWebcamReadyAndPublish(shell, miconly, attempt) {
		if (!guestJoinPreferences.joined) {
			return;
		}

		var goButton = document.getElementById("gowebcam");
		var ready = goButton && goButton.dataset && goButton.dataset.ready === "true";
		var audioReady = goButton && goButton.dataset && goButton.dataset.audioready === "true";
		if (goButton && (ready || miconly || !guestJoinPreferences.video) && (audioReady || !guestJoinPreferences.audio)) {
			try {
				setShellText(shell, "[data-mcast-status]", "Joining room...");
				publishWebcam(false, !!miconly);
				applyGuestMediaPreferencesLater();
				window.setTimeout(function () {
					setShellText(shell, "[data-mcast-status]", "Connected. Waiting for host routing...");
				}, 700);
			} catch (publishError) {
				console.error("MCast guest publish failed", publishError);
				setShellText(shell, "[data-mcast-status]", "Could not join. Check browser permissions and try again.");
				resetGuestJoinButton(shell);
			}
			return;
		}

		if (attempt >= 80) {
			setShellText(shell, "[data-mcast-status]", "Could not prepare camera or microphone. Check browser permissions and try again.");
			resetGuestJoinButton(shell);
			return;
		}

		window.setTimeout(function () {
			waitForNativeWebcamReadyAndPublish(shell, miconly, attempt + 1);
		}, 250);
	}

	function resetGuestJoinButton(shell) {
		guestJoinPreferences.joined = false;
		var joinButton = shell ? shell.querySelector("[data-mcast-join]") : null;
		if (joinButton) {
			joinButton.disabled = false;
			joinButton.textContent = "Join";
		}
	}

	function applyGuestMediaPreferencesLater() {
		var attempts = 0;
		var timer = window.setInterval(function () {
			attempts++;
			applyGuestMediaPreferences();
			if (attempts >= 12 || hasLiveGuestMedia()) {
				window.clearInterval(timer);
			}
		}, 500);
	}

	function applyGuestMediaPreferences() {
		if (!guestJoinPreferences.audio) {
			forceGuestMuteState(true);
		}
		if (!guestJoinPreferences.video) {
			forceGuestVideoMuteState(true);
		}
	}

	function forceGuestMuteState(muted) {
		try {
			if (typeof session === "undefined") {
				return;
			}
			if (typeof session.muted === "undefined") {
				session.muted = false;
			}
			if (session.muted !== muted) {
				if (typeof window.toggleMute === "function") {
					window.toggleMute();
				} else if (typeof toggleMute === "function") {
					toggleMute();
				}
			}
		} catch (error) {
			console.warn("MCast could not apply audio preference", error);
		}
	}

	function forceGuestVideoMuteState(muted) {
		try {
			if (typeof session === "undefined") {
				return;
			}
			if (typeof session.videoMuted === "undefined") {
				session.videoMuted = false;
			}
			if (session.videoMuted !== muted) {
				if (typeof window.toggleVideoMute === "function") {
					window.toggleVideoMute();
				} else if (typeof toggleVideoMute === "function") {
					toggleVideoMute();
				}
			}
		} catch (error) {
			console.warn("MCast could not apply video preference", error);
		}
	}

	function applyGuestNameToNativeSession(name) {
		var cleanName = (name || "").trim().slice(0, 60);
		if (!cleanName) {
			return;
		}
		try {
			if (typeof session !== "undefined") {
				session.label = cleanName;
			}
		} catch (error) {
			console.warn("MCast could not set session label", error);
		}
		var fields = document.querySelectorAll("input[name='label'],input[name='l'],input[name='name'],input[id='label'],input[id='name'],input[id='username']");
		for (var index = 0; index < fields.length; index++) {
			fields[index].value = cleanName;
			fields[index].dispatchEvent(new Event("input", { bubbles: true }));
			fields[index].dispatchEvent(new Event("change", { bubbles: true }));
		}
		var videoNameFields = document.querySelectorAll("input[id^='videoname']");
		for (var videoNameIndex = 0; videoNameIndex < videoNameFields.length; videoNameIndex++) {
			videoNameFields[videoNameIndex].value = cleanName;
			videoNameFields[videoNameIndex].dispatchEvent(new Event("input", { bubbles: true }));
			videoNameFields[videoNameIndex].dispatchEvent(new Event("change", { bubbles: true }));
		}
		try {
			if (typeof urlParams !== "undefined" && urlParams && typeof urlParams.set === "function") {
				urlParams.set("label", cleanName);
				urlParams.set("l", cleanName);
			}
		} catch (error) {
			console.warn("MCast could not set URL label state", error);
		}
	}

	function updateGuestPreviewName(shell, value) {
		var name = (value || "").trim() || "Guest";
		setShellText(shell, "[data-mcast-preview-name]", name);
		var avatar = shell.querySelector("[data-mcast-avatar]");
		if (avatar) {
			avatar.textContent = name.substring(0, 1).toUpperCase();
		}
	}

	function renderGuestDeviceControls(shell) {
		var audioButton = shell.querySelector("[data-mcast-audio-toggle]");
		var videoButton = shell.querySelector("[data-mcast-video-toggle]");
		if (audioButton) {
			audioButton.classList.toggle("is-off", !guestJoinPreferences.audio);
			setShellText(audioButton, "[data-mcast-audio-label]", guestJoinPreferences.audio ? "Mute" : "Unmute");
			setShellHtml(audioButton, "[data-mcast-audio-icon]", getDeviceIcon("mic", guestJoinPreferences.audio));
			audioButton.setAttribute("aria-pressed", guestJoinPreferences.audio ? "false" : "true");
		}
		if (videoButton) {
			videoButton.classList.toggle("is-off", !guestJoinPreferences.video);
			setShellText(videoButton, "[data-mcast-video-label]", guestJoinPreferences.video ? "Stop Video" : "Start Video");
			setShellHtml(videoButton, "[data-mcast-video-icon]", getDeviceIcon("video", guestJoinPreferences.video));
			videoButton.setAttribute("aria-pressed", guestJoinPreferences.video ? "false" : "true");
		}
		shell.classList.toggle("mcast-video-off", !guestJoinPreferences.video);
	}

	function setShellText(root, selector, value) {
		var element = root.querySelector(selector);
		if (element) {
			element.textContent = value || "";
		}
	}

	function setShellHtml(root, selector, value) {
		var element = root.querySelector(selector);
		if (element) {
			element.innerHTML = value || "";
		}
	}

	function getDeviceIcon(type, enabled) {
		if (type === "mic") {
			return enabled
				? "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z\"></path><path d=\"M19 10v2a7 7 0 0 1-14 0v-2\"></path><path d=\"M12 19v3\"></path></svg>"
				: "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 2a3 3 0 0 0-3 3v3\"></path><path d=\"M15 9.3V5a3 3 0 0 0-5.1-2.1\"></path><path d=\"M19 10v2a7 7 0 0 1-.7 3\"></path><path d=\"M5 10v2a7 7 0 0 0 10.5 6.1\"></path><path d=\"M12 19v3\"></path><path d=\"M3 3l18 18\"></path></svg>";
		}
		return enabled
			? "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15 10l4.6-3.1A1 1 0 0 1 21 7.7v8.6a1 1 0 0 1-1.4.8L15 14\"></path><rect x=\"3\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"></rect></svg>"
			: "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M10.7 6H13a2 2 0 0 1 2 2v2.3\"></path><path d=\"M15 14l4.6 3.1a1 1 0 0 0 1.4-.8V7.7a1 1 0 0 0-1.4-.8L17 8.7\"></path><path d=\"M3 3l18 18\"></path><path d=\"M3 8a2 2 0 0 1 2-2h1\"></path><path d=\"M3 12v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1\"></path></svg>";
	}

	function getGuestShellProfile(mode, state) {
		var modeTitle = toTitleCase(mode || "stream_guest");
		var profiles = {
			meeting: {
				heading: "Joining the meeting",
				message: "Your session will open as soon as the connection is ready.",
				status: "Connecting to meeting..."
			},
			classroom: {
				heading: "Classroom waiting room",
				message: "Your teacher will bring you into the class when ready.",
				status: "Waiting for teacher approval..."
			},
			stream_guest: {
				heading: "Joining the green room",
				message: "The production team will bring you on screen when it is time.",
				status: "Connecting backstage..."
			},
			webinar: {
				heading: "Joining the webinar",
				message: "The host will approve speakers before they appear on screen.",
				status: "Waiting for host approval..."
			},
			podcast: {
				heading: "Podcast audio check",
				message: "Keep your microphone ready while the host prepares the recording.",
				status: "Preparing podcast session..."
			},
			remote_interview: {
				heading: "Interview waiting room",
				message: "The producer will check your audio and video before the show.",
				status: "Waiting for producer check..."
			}
		};
		var profile = profiles[mode] || profiles.stream_guest;
		if (state === "active") {
			profile = {
				heading: "You are connected",
				message: "The host can hear you and will decide when to show video.",
				status: "Audio route active..."
			};
		} else if (state === "raised_hand") {
			profile = {
				heading: "Hand raised",
				message: "The host can see your request and will bring you in when ready.",
				status: "Waiting in the raise-hand queue..."
			};
		} else if (state === "backstage") {
			profile = {
				heading: "You are backstage",
				message: "The production team can prepare your feed before you go live.",
				status: "Backstage connection active..."
			};
		} else if (state === "on_screen") {
			profile = {
				heading: "You are on screen",
				message: "Stay ready and keep this browser tab open.",
				status: "Live route active..."
			};
		}
		return {
			modeTitle: modeTitle,
			heading: profile.heading,
			message: profile.message,
			status: profile.status
		};
	}

	function toTitleCase(value) {
		return (value || "").replace(/_/g, " ").replace(/\b\w/g, function (match) {
			return match.toUpperCase();
		});
	}

	function setFlag(routedParams, key) {
		if (!routedParams.has(key)) {
			routedParams.set(key, "");
		}
	}

	function serializeParams(routedParams) {
		var parts = [];
		routedParams.forEach(function (value, key) {
			var encodedKey = encodeURIComponent(key);
			if (value === "") {
				parts.push(encodedKey);
			} else {
				parts.push(encodedKey + "=" + encodeURIComponent(value));
			}
		});
		return parts.join("&");
	}

	function applyStoredGuestIdentity(routedParams) {
		var name = readStoredGuestName();
		if (!name || routedParams.has("label") || routedParams.has("l")) {
			return;
		}
		routedParams.set("l", name);
	}

	function getOrCreateSingleLinkGuestPush(routedParams) {
		var room = normalizeRouteToken(routedParams.get("room") || "room", "room");
		var storageKey = "mcast.singleLinkPush." + room;
		var existing = "";
		try {
			existing = window.localStorage ? window.localStorage.getItem(storageKey) || "" : "";
		} catch (error) {
			existing = "";
		}
		if (/^guest_[a-z0-9_]{8,48}$/i.test(existing)) {
			return existing;
		}

		var generated = "guest_" + createRandomRouteId();
		try {
			if (window.localStorage) {
				window.localStorage.setItem(storageKey, generated);
			}
		} catch (error) {
			// Storage can be blocked; the one-time generated id is still valid.
		}
		return generated;
	}

	function createRandomRouteId() {
		var alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
		var id = "";
		if (window.crypto && typeof window.crypto.getRandomValues === "function") {
			var values = new Uint8Array(16);
			window.crypto.getRandomValues(values);
			for (var index = 0; index < values.length; index++) {
				id += alphabet[values[index] % alphabet.length];
			}
			return id;
		}
		for (var fallbackIndex = 0; fallbackIndex < 16; fallbackIndex++) {
			id += alphabet[Math.floor(Math.random() * alphabet.length)];
		}
		return id;
	}

	function readStoredGuestName() {
		if (readGuestPreference("rememberName", true) === false) {
			return "";
		}
		try {
			return (window.localStorage.getItem("mcastGuestName") || "").trim().slice(0, 60);
		} catch (error) {
			return "";
		}
	}

	function writeStoredGuestName(value) {
		try {
			if (value) {
				window.localStorage.setItem("mcastGuestName", value.trim().slice(0, 60));
			} else {
				window.localStorage.removeItem("mcastGuestName");
			}
		} catch (error) {
			console.warn("MCast could not store guest name", error);
		}
	}

	function readGuestPreference(key, fallback) {
		try {
			var value = window.localStorage.getItem("mcastGuestPreference." + key);
			if (value === "true") {
				return true;
			}
			if (value === "false") {
				return false;
			}
		} catch (error) {
			return fallback;
		}
		return fallback;
	}

	function writeGuestPreference(key, value) {
		try {
			window.localStorage.setItem("mcastGuestPreference." + key, value ? "true" : "false");
		} catch (error) {
			console.warn("MCast could not store guest preference", error);
		}
	}

	function readShortInviteCodeFromPath(currentPath) {
		var match = (currentPath || "").match(/^\/(?:g|m|c|s|w|p|i)\/([A-Za-z0-9]{6,16})\/?$/i);
		return match ? match[1] : "";
	}

	function resolveStoredRoute(code, currentRoute) {
		if (!/^[A-Za-z0-9]{6,16}$/.test(code || "")) {
			showInviteError("This MCast Studio invitation link is not valid.");
			return "";
		}

		try {
			var request = new XMLHttpRequest();
			var endpoint = currentRoute === "call" ? roomTicketResolveUrl : shortInviteResolveUrl;
			request.open("GET", endpoint + "?code=" + encodeURIComponent(code), false);
			request.setRequestHeader("Accept", "application/json");
			request.send(null);
			if (request.status < 200 || request.status >= 300) {
				showInviteError(request.status === 410
					? "This MCast Studio link has expired."
					: "This MCast Studio link is not valid.");
				return "";
			}

			var payload = JSON.parse(request.responseText || "{}");
			return (payload.query || "").toString().trim();
		} catch (error) {
			console.error("MCast route resolve failed", error);
			showInviteError("This MCast Studio link could not be loaded.");
			return "";
		}
	}

	function resolvePackedToken(tokenValue, currentRoute) {
		try {
			var request = new XMLHttpRequest();
			request.open("POST", tokenResolveUrl, false);
			request.setRequestHeader("Accept", "application/json");
			request.setRequestHeader("Content-Type", "application/json");
			request.send(JSON.stringify({ token: tokenValue, route: currentRoute }));
			if (request.status < 200 || request.status >= 300) {
				showInviteError("This MCast Studio link is not valid.");
				return "";
			}

			var payload = JSON.parse(request.responseText || "{}");
			return (payload.query || "").toString().trim();
		} catch (error) {
			console.error("MCast packed route resolve failed", error);
			showInviteError("This MCast Studio link could not be loaded.");
			return "";
		}
	}

	function startGuestJoinStatusMonitor() {
		var startedAt = Date.now();
		var interval = window.setInterval(function () {
			if (removeGuestJoinStatusIfReady() || (guestJoinPreferences.joined && Date.now() - startedAt > 60000)) {
				window.clearInterval(interval);
				removeGuestJoinStatus();
			}
		}, 500);
	}

	function removeGuestJoinStatusIfReady() {
		var status = document.getElementById("mcastJoining");
		if (!status) {
			return true;
		}
		if (!document.body) {
			return false;
		}
		return hasLiveGuestMedia();
	}

	function removeGuestJoinStatus() {
		var status = document.getElementById("mcastJoining");
		if (status && status.parentNode) {
			status.parentNode.removeChild(status);
		}
	}

	function hasLiveGuestMedia() {
		var videos = document.querySelectorAll("video");
		for (var index = 0; index < videos.length; index++) {
			var video = videos[index];
			if (video.readyState >= 2 && (video.videoWidth > 0 || video.videoHeight > 0)) {
				return true;
			}
			var stream = video.srcObject;
			if (stream && typeof stream.getTracks === "function") {
				var tracks = stream.getTracks();
				for (var trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
					if (tracks[trackIndex].readyState === "live") {
						return true;
					}
				}
			}
		}
		return false;
	}

	function showInviteError(message) {
		document.addEventListener("DOMContentLoaded", function () {
			document.body.innerHTML = "<div style=\"display:grid;place-items:center;min-height:100vh;background:#0b0f16;color:#f8d7da;font:500 16px system-ui;text-align:center;padding:24px;\">" +
				escapeHtml(message) +
				"</div>";
		});
	}

	function escapeHtml(value) {
		return (value || "").toString()
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

})();
