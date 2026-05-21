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
		rememberName: readGuestPreference("rememberName", true),
		joined: false,
		nativeRoomEntered: false,
		nativeReady: false,
		joinStartedAt: 0,
		readyTimer: null,
		roomSkinTimer: null,
		inlineVideoGuardTimer: null,
		inlineVideoGuardObserver: null,
		directPreviewPromise: null,
		directPreviewFailed: false,
		directPreviewError: "",
		manualRotation: 0,
		routeOrientation: "",
		pendingJoinShell: null,
		orientationGateInstalled: false,
		orientationCanvas: null,
		orientationContext: null,
		orientationSourceVideo: null,
		orientationSourceTrackId: "",
		orientationFrameRequest: 0,
		normalizedVideoTrack: null,
		normalizedVideoStream: null,
		videoRepairScheduled: false,
		canvasRenderStarted: false
	};
	var guestRouteResolved = false;
	var activeGuestShell = null;

	installDirectorControlBridge();

	document.documentElement.classList.add("mcast-route");
	document.documentElement.classList.add(route === "guest" ? "mcast-guest" : "mcast-vcall");

	if (route === "guest") {
		installEarlyNativeRotationSuppressor();
		installGuestExperienceStyles();
		document.addEventListener("DOMContentLoaded", function () {
			if (guestRouteResolved) {
				ensureGuestJoinShell();
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
	} else if (route === "guest") {
		decoded = readStoredResolvedGuestRoute();
	} else if (route === "call") {
		showInviteError("This MCast Studio room link is not authorized.");
		return;
	}

	if (!decoded) {
		if (route === "guest") {
			showInviteError("This MCast Studio room link is missing or has expired.");
		}
		return;
	}

	if ((token || shortCode) && route !== "guest") {
		cleanTransportRouteParams(params);
	}
	decoded = applyRouteDefaults(decoded, route);
	if (route === "guest") {
		guestJoinPreferences.routeOrientation = readRequestedOrientationFromQuery(decoded);
		if (!hasGuestRoomTarget(decoded)) {
			showInviteError("This MCast Studio room link is missing or has expired.");
			return;
		}
		persistResolvedGuestRoute(decoded);
		if (!token && !shortCode) {
			persistResolvedGuestRouteInLocation(decoded);
		}
		cleanNativeDisplayNamePromptParamsFromLocation();
	}
	applyRouteMetadata(decoded, route);
	if (typeof session !== "undefined") {
		session.decrypted = "?" + decoded.replace(/^\?/, "");
		session.nohistory = true;
	}
	guestRouteResolved = route === "guest";

	function applyRouteDefaults(query, currentRoute) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		if (currentRoute === "guest") {
			setFlag(routedParams, "webcam");
			setFlag(routedParams, "nosettings");
			setFlag(routedParams, "mcastguest");
			setFlag(routedParams, "mcastprejoin");
			routedParams.delete("mcastengine");
			disableNativePageRotation(routedParams);
			cleanEmptyNativeDeviceParams(routedParams);
			normalizeGuestNameParams(routedParams);
			if (!routedParams.has("mcastautojoin")) {
				routedParams.delete("autostart");
			}

			var mode = normalizeRouteToken(routedParams.get("mcastmode") || "", "");
			if (!routedParams.has("push") && (mode === "meeting" || mode === "classroom" || mode === "webinar")) {
				routedParams.set("push", getOrCreateSingleLinkGuestPush(routedParams));
				routedParams.set("mcastsinglelink", "1");
			}
			if (routedParams.has("mcastautojoin")) {
				setFlag(routedParams, "autostart");
			}
			if (!routedParams.has("roombitrate") && !routedParams.has("rbr")) {
				routedParams.set("roombitrate", "1200");
			}
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

	function hasGuestRoomTarget(query) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		return !!(routedParams.get("room") || routedParams.get("r"));
	}

	function readRequestedOrientationFromQuery(query) {
		var routedParams = new URLSearchParams((query || "").replace(/^\?/, ""));
		if (routedParams.has("forcelandscape") || routedParams.has("forcedlandscape") || routedParams.has("fl")) {
			return "landscape";
		}
		if (routedParams.has("forceportrait") || routedParams.has("forcedportrait") || routedParams.has("fp")) {
			return "portrait";
		}
		return "";
	}

	function disableNativePageRotation(routedParams) {
		[
			"rotate",
			"rotatewindow",
			"rotatepage"
		].forEach(function (key) {
			routedParams.delete(key);
		});
	}

	function cleanEmptyNativeDeviceParams(routedParams) {
		[
			"audiodevice",
			"adevice",
			"ad",
			"videodevice",
			"vdevice",
			"vd",
			"device",
			"d"
		].forEach(function (key) {
			if (routedParams.has(key) && !String(routedParams.get(key) || "").trim()) {
				routedParams.delete(key);
			}
		});
	}

	function installDirectorControlBridge() {
		if (window.MCastDirectorControl) {
			return;
		}

		function normalize(value) {
			return (value || "").toString().trim().toLowerCase().replace(/\s+/g, "");
		}

		function findRpc(guestKey) {
			var expected = normalize(guestKey);
			if (!expected || !window.session || !window.session.rpcs) {
				return null;
			}

			for (var uuid in window.session.rpcs) {
				if (!Object.prototype.hasOwnProperty.call(window.session.rpcs, uuid)) {
					continue;
				}
				var rpc = window.session.rpcs[uuid];
				if (!rpc) {
					continue;
				}
				var streamId = normalize(rpc.streamID || rpc.streamId || rpc.id || "");
				if (streamId === expected) {
					return { uuid: uuid, rpc: rpc };
				}
			}
			return null;
		}

		function setParticipantMedia(policy) {
			policy = policy || {};
			var match = findRpc(policy.guestKey);
			if (!match || !match.rpc) {
				return false;
			}

			var uuid = match.uuid;
			var rpc = match.rpc;
			var audioEnabled = !!policy.audioEnabled;
			var videoEnabled = !!policy.videoEnabled;
			var videoQuality = (policy.videoQuality || "").toString().toLowerCase() === "low" ? "low" : "high";

			try {
				rpc.directorMutedState = audioEnabled ? 0 : 1;
				if (window.session && typeof window.session.sendRequest === "function") {
					window.session.sendRequest({ volume: audioEnabled ? 100 : 0, UUID: uuid }, uuid);
				}
			} catch (error) {}

			try {
				var video = rpc.videoElement || document.querySelector('[data-uuid="' + uuid + '"],[data-UUID="' + uuid + '"],#videosource_' + uuid);
				if (!videoEnabled) {
					if (typeof pauseVideo === "function" && video) {
						pauseVideo(video, false);
					} else if (window.session && typeof window.session.requestRateLimit === "function") {
						window.session.requestRateLimit(0, uuid, true);
					}
					if (video && typeof video.pause === "function") {
						video.pause();
					}
					return true;
				}

				if (typeof unPauseVideo === "function" && video) {
					unPauseVideo(video, false);
				}
				if (window.session && typeof window.session.requestRateLimit === "function") {
					window.session.requestRateLimit(videoQuality === "low" ? 300 : false, uuid, false);
				}
			} catch (error) {}
			return true;
		}

		window.MCastDirectorControl = {
			setParticipantMedia: setParticipantMedia,
			applyPolicies: function (policies) {
				if (!Array.isArray(policies)) {
					return 0;
				}
				var applied = 0;
				policies.forEach(function (policy) {
					if (setParticipantMedia(policy)) {
						applied++;
					}
				});
				return applied;
			}
		};
	}

	function applyRouteMetadata(query, currentRoute) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		var mode = normalizeRouteToken(routedParams.get("mcastmode") || "stream_guest", "stream_guest");
		var role = normalizeRouteToken(routedParams.get("mcastrole") || (currentRoute === "guest" ? "participant" : "source"), "participant");
		var state = normalizeRouteToken(routedParams.get("mcaststate") || "backstage", "backstage");
		var routing = normalizeRouteToken(routedParams.get("mcastrouting") || "low_bitrate", "low_bitrate");
		var guestName = normalizeGuestDisplayName(routedParams.get("label") || routedParams.get("l") || "");
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
			routing: routing,
			guestName: guestName
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
		var modeTitle = toTitleCase(mode);
		if (role === "participant") {
			document.title = "MCast Studio " + modeTitle;
		}
	}

	function installGuestExperienceStyles() {
		if (document.getElementById("mcastGuestExperienceStyles")) {
			return;
		}
		var style = document.createElement("style");
		style.id = "mcastGuestExperienceStyles";
		style.textContent = [
			"html.mcast-guest,html.mcast-guest body{background:#0a0d12!important;min-height:100%;letter-spacing:0!important;}",
			"html.mcast-guest body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;transform:none!important;transform-origin:initial!important;position:static!important;top:auto!important;left:auto!important;width:auto!important;height:auto!important;overflow:auto!important;}",
			"html.mcast-guest #mcastJoining,html.mcast-guest #mcastJoining *{box-sizing:border-box;}",
			"html.mcast-guest #mcastJoining{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:#0a0d12;color:#eef2f7;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));pointer-events:auto;transition:opacity .22s ease,visibility .22s ease;}",
			"html.mcast-guest #mcastJoining.mcast-ready{opacity:0;visibility:hidden;pointer-events:none;}",
			"html.mcast-guest .mcast-join-panel{width:min(1180px,100%);max-width:100%;min-height:min(720px,calc(100dvh - 32px));display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,440px);overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#111722;box-shadow:0 24px 80px rgba(0,0,0,.42);}",
			"html.mcast-guest .mcast-join-preview{position:relative;min-width:0;min-height:430px;background:#05070b;overflow:hidden;padding:18px;}",
			"html.mcast-guest .mcast-join-preview:before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(17,24,39,.72),rgba(5,7,11,.08) 34%,rgba(5,7,11,.7));pointer-events:none;}",
			"html.mcast-guest .mcast-join-topbar{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;}",
			"html.mcast-guest .mcast-join-brand{display:flex;align-items:center;gap:10px;min-width:0;}",
			"html.mcast-guest .mcast-join-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:8px;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.12);overflow:hidden;flex:0 0 auto;}",
			"html.mcast-guest .mcast-join-logo{display:block;width:100%;height:100%;object-fit:cover;}",
			"html.mcast-guest .mcast-join-brand-title{font-size:14px;font-weight:760;line-height:1.15;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-join-brand-subtitle{margin-top:2px;color:#9ca8ba;font-size:12px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-join-mode{display:inline-flex;align-items:center;gap:7px;max-width:46%;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.08);color:#e8edf5;font-size:12px;font-weight:720;padding:7px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-join-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.16);flex:0 0 auto;}",
			"html.mcast-guest .mcast-preview-stage{position:absolute;inset:74px 18px 104px;display:grid;place-items:center;border-radius:8px;background:#0b1018;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}",
			"html.mcast-guest .mcast-preview-avatar{display:grid;place-items:center;width:118px;height:118px;border-radius:50%;background:#202938;color:#d7dde7;font-size:42px;font-weight:760;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}",
			"html.mcast-guest .mcast-preview-off{position:absolute;inset:0;display:none;place-items:center;background:#0b1018;color:#a8b3c2;font-size:13px;font-weight:680;text-align:center;padding:24px;}",
			"html.mcast-guest #mcastJoining.mcast-video-off .mcast-preview-off{display:grid;}",
			"html.mcast-guest #mcastJoining.mcast-video-off .mcast-preview-avatar{display:none;}",
			"html.mcast-guest .mcast-preview-label{position:absolute;left:14px;bottom:12px;max-width:calc(100% - 28px);padding:6px 9px;border-radius:6px;background:rgba(0,0,0,.62);color:#f8fafc;font-size:12px;font-weight:680;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-device-row{position:absolute;left:18px;right:18px;bottom:18px;z-index:2;display:flex;justify-content:center;gap:12px;}",
			"html.mcast-guest .mcast-device-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:126px;height:42px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#252d3a;color:#f8fafc;font-size:13px;font-weight:720;white-space:nowrap;overflow:hidden;cursor:pointer;}",
			"html.mcast-guest .mcast-device-button span:not(.mcast-device-icon){min-width:0;overflow:hidden;text-overflow:ellipsis;}",
			"html.mcast-guest .mcast-device-button:hover{background:#303949;}",
			"html.mcast-guest .mcast-device-button.is-off{background:#b91c1c;border-color:#dc2626;color:#fff;}",
			"html.mcast-guest .mcast-device-icon{display:grid;place-items:center;width:20px;height:20px;flex:0 0 auto;}",
			"html.mcast-guest .mcast-device-icon svg{display:block;width:19px;height:19px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}",
			"html.mcast-guest .mcast-join-form{display:flex;flex-direction:column;justify-content:center;min-width:0;background:#f7f8fa;color:#1f2937;padding:36px 32px;}",
			"html.mcast-guest .mcast-join-heading{color:#101827;font-size:28px;line-height:1.16;font-weight:780;margin:0 0 10px;letter-spacing:0;}",
			"html.mcast-guest .mcast-join-message{color:#4b5563;font-size:14px;line-height:1.52;margin:0 0 24px;font-weight:520;}",
			"html.mcast-guest .mcast-field{display:flex;flex-direction:column;gap:7px;margin-bottom:14px;}",
			"html.mcast-guest .mcast-field-label{font-size:12px;font-weight:760;color:#374151;}",
			"html.mcast-guest .mcast-name-input{height:46px;border:1px solid #cfd5dd;border-radius:6px;background:#fff;color:#111827;font:650 15px Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:0 12px;outline:none;letter-spacing:0;}",
			"html.mcast-guest .mcast-name-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14);}",
			"html.mcast-guest .mcast-check-row{display:flex;align-items:center;gap:9px;color:#4b5563;font-size:13px;font-weight:620;margin:2px 0 18px;}",
			"html.mcast-guest .mcast-check-row input{width:16px;height:16px;accent-color:#2563eb;}",
			"html.mcast-guest .mcast-join-action{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:48px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-size:15px;font-weight:780;cursor:pointer;letter-spacing:0;}",
			"html.mcast-guest .mcast-join-action:hover{background:#1d4ed8;}",
			"html.mcast-guest .mcast-join-action:disabled{opacity:.72;cursor:default;}",
			"html.mcast-guest .mcast-join-action:before{content:'';display:none;width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.36);border-top-color:#fff;animation:mcastSpin .85s linear infinite;}",
			"html.mcast-guest .mcast-join-action.is-busy:before{display:block;}",
			"html.mcast-guest .mcast-join-status{min-height:18px;margin-top:12px;color:#64748b;font-size:12px;line-height:1.45;font-weight:650;}",
			"html.mcast-guest .mcast-join-footer,html.mcast-guest .mcast-terms{margin-top:16px;color:#6b7280;font-size:11px;line-height:1.45;font-weight:520;}",
			"html.mcast-guest .mcast-terms{margin-top:18px;}",
			"html.mcast-guest #mcastOrientationGate{position:fixed!important;inset:0!important;z-index:2147483300!important;display:none!important;place-items:center!important;background:#070b12!important;color:#f8fafc!important;padding:max(18px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(18px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left))!important;text-align:center!important;box-sizing:border-box!important;}",
			"html.mcast-guest.mcast-orientation-blocked #mcastOrientationGate{display:grid!important;}",
			"html.mcast-guest .mcast-orientation-card{width:min(420px,100%)!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:8px!important;background:#111827!important;padding:24px 22px!important;box-shadow:0 22px 70px rgba(0,0,0,.38)!important;}",
			"html.mcast-guest .mcast-orientation-icon{display:grid!important;place-items:center!important;width:72px!important;height:72px!important;margin:0 auto 18px!important;border-radius:50%!important;background:#1f2937!important;color:#93c5fd!important;}",
			"html.mcast-guest .mcast-orientation-icon svg{width:40px!important;height:40px!important;stroke:currentColor!important;stroke-width:1.8!important;fill:none!important;stroke-linecap:round!important;stroke-linejoin:round!important;}",
			"html.mcast-guest .mcast-orientation-title{font-size:21px!important;line-height:1.2!important;font-weight:780!important;margin:0 0 8px!important;color:#f8fafc!important;}",
			"html.mcast-guest .mcast-orientation-copy{font-size:14px!important;line-height:1.5!important;font-weight:560!important;margin:0!important;color:#cbd5e1!important;}",
			"html.mcast-guest.mcast-native-room body{isolation:isolate!important;}",
			"html.mcast-guest.mcast-native-room #gridlayout{position:relative!important;z-index:1!important;display:block!important;visibility:visible!important;opacity:1!important;}",
			"html.mcast-guest.mcast-native-room #gridlayout video,html.mcast-guest.mcast-native-room #gridlayout .holder,html.mcast-guest.mcast-native-room #gridlayout .container_holder_video{visibility:visible!important;opacity:1!important;}",
			"html.mcast-guest.mcast-native-room #controlButtons{z-index:995!important;}",
			"html.mcast-guest.mcast-room-active #mcastJoining{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}",
			"html.mcast-guest.mcast-room-active{background:#05070b!important;overflow:hidden!important;width:100vw!important;height:100dvh!important;min-height:100dvh!important;transform:none!important;transform-origin:initial!important;}",
			"html.mcast-guest.mcast-room-active body{background:#05070b!important;overflow:hidden!important;position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;min-height:100dvh!important;margin:0!important;transform:none!important;transform-origin:initial!important;}",
			"html.mcast-guest.mcast-room-active #header,html.mcast-guest.mcast-room-active #head1,html.mcast-guest.mcast-room-active #head1a,html.mcast-guest.mcast-room-active #head2,html.mcast-guest.mcast-room-active #head3,html.mcast-guest.mcast-room-active #head3a,html.mcast-guest.mcast-room-active #head5,html.mcast-guest.mcast-room-active #head9,html.mcast-guest.mcast-room-active #qos,html.mcast-guest.mcast-room-active #logoname,html.mcast-guest.mcast-room-active #credits,html.mcast-guest.mcast-room-active #legal,html.mcast-guest.mcast-room-active #translateButton{display:none!important;}",
			"html.mcast-guest.mcast-room-active #container-1,html.mcast-guest.mcast-room-active #container-2,html.mcast-guest.mcast-room-active #container-3,html.mcast-guest.mcast-room-active #container-3a,html.mcast-guest.mcast-room-active #container-4,html.mcast-guest.mcast-room-active #container-5,html.mcast-guest.mcast-room-active #container-6,html.mcast-guest.mcast-room-active #container-7,html.mcast-guest.mcast-room-active #container-8,html.mcast-guest.mcast-room-active #container-9,html.mcast-guest.mcast-room-active #container-10,html.mcast-guest.mcast-room-active #container-11,html.mcast-guest.mcast-room-active #container-12,html.mcast-guest.mcast-room-active #container-13,html.mcast-guest.mcast-room-active #container-14,html.mcast-guest.mcast-room-active #container-15,html.mcast-guest.mcast-room-active #container-16,html.mcast-guest.mcast-room-active #container-17,html.mcast-guest.mcast-room-active #container-18,html.mcast-guest.mcast-room-active #container-19,html.mcast-guest.mcast-room-active #container-20,html.mcast-guest.mcast-room-active #container-21{display:none!important;}",
			"html.mcast-guest.mcast-room-active #main{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;overflow:hidden!important;background:#05070b!important;}",
			"html.mcast-guest.mcast-room-active #mainmenu{position:fixed!important;inset:0!important;display:block!important;visibility:visible!important;opacity:1!important;width:100vw!important;min-width:100vw!important;height:100dvh!important;min-height:100dvh!important;overflow:hidden!important;background:#05070b!important;padding:12px 12px 92px!important;box-sizing:border-box!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoom,html.mcast-guest.mcast-room-active #mcastRoom *{box-sizing:border-box!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoom{position:fixed!important;inset:0!important;z-index:2147482500!important;display:grid!important;grid-template-rows:58px minmax(0,1fr) 74px!important;gap:12px!important;width:100vw!important;height:100dvh!important;padding:12px 12px max(12px,env(safe-area-inset-bottom))!important;background:#05070b!important;color:#f8fafc!important;overflow:hidden!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomHeader{position:relative!important;z-index:3!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;min-width:0!important;min-height:0!important;padding:0 10px!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:8px!important;background:rgba(12,17,25,.86)!important;box-shadow:0 12px 34px rgba(0,0,0,.22)!important;}",
			"html.mcast-guest.mcast-room-active .mcast-room-brand{display:flex!important;align-items:center!important;gap:10px!important;min-width:0!important;}",
			"html.mcast-guest.mcast-room-active .mcast-room-logo{width:34px!important;height:34px!important;border-radius:7px!important;display:block!important;flex:0 0 auto!important;}",
			"html.mcast-guest.mcast-room-active .mcast-room-title{min-width:0!important;color:#f8fafc!important;font-size:14px!important;font-weight:780!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}",
			"html.mcast-guest.mcast-room-active .mcast-room-subtitle{color:#94a3b8!important;font-size:11px!important;font-weight:700!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomStats{display:flex!important;align-items:center!important;gap:8px!important;min-width:0!important;color:#cbd5e1!important;font-size:12px!important;font-weight:760!important;white-space:nowrap!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomStats:before{content:'';display:block!important;width:8px!important;height:8px!important;border-radius:50%!important;background:#22c55e!important;box-shadow:0 0 0 4px rgba(34,197,94,.12)!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomStage{position:relative!important;min-width:0!important;min-height:0!important;overflow:hidden!important;border-radius:8px!important;background:#070b12!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomGrid{position:absolute!important;inset:0!important;z-index:2!important;display:grid!important;gap:12px!important;padding:12px!important;width:100%!important;height:100%!important;align-items:center!important;justify-items:center!important;place-content:center!important;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr))!important;background:#070b12!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomGrid[data-count='1']{grid-template-columns:minmax(0,min(100%,1320px))!important;}",
			"html.mcast-guest.mcast-room-active .mcast-video-tile{position:relative!important;display:block!important;width:100%!important;height:100%!important;min-height:0!important;max-height:100%!important;aspect-ratio:16/9!important;border-radius:8px!important;overflow:hidden!important;background:#111827!important;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 18px 52px rgba(0,0,0,.28)!important;}",
			"html.mcast-guest.mcast-room-active .mcast-render-canvas{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;background:#0b1018!important;transform:none!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;}",
			"html.mcast-guest.mcast-room-active .mcast-render-video,html.mcast-guest.mcast-room-active .mcast-video-tile>video{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;background:#0b1018!important;transform:none!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;}",
			"html.mcast-guest.mcast-room-active .mcast-render-video[data-mcast-manual-rotation='90'],html.mcast-guest.mcast-room-active .mcast-video-tile>video[data-mcast-manual-rotation='90']{transform:rotate(90deg)!important;}",
			"html.mcast-guest.mcast-room-active .mcast-render-video[data-mcast-manual-rotation='180'],html.mcast-guest.mcast-room-active .mcast-video-tile>video[data-mcast-manual-rotation='180']{transform:rotate(180deg)!important;}",
			"html.mcast-guest.mcast-room-active .mcast-render-video[data-mcast-manual-rotation='270'],html.mcast-guest.mcast-room-active .mcast-video-tile>video[data-mcast-manual-rotation='270']{transform:rotate(270deg)!important;}",
			"html.mcast-guest.mcast-room-active .mcast-tile-label{position:absolute!important;left:10px!important;bottom:10px!important;z-index:2!important;max-width:calc(100% - 20px)!important;padding:5px 8px!important;border-radius:6px!important;background:rgba(0,0,0,.62)!important;color:#f8fafc!important;font-size:12px!important;font-weight:760!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomControls{position:relative!important;z-index:2!important;display:flex!important;align-items:center!important;justify-content:center!important;min-width:0!important;min-height:0!important;pointer-events:none!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomStatus{position:absolute!important;inset:0!important;z-index:1!important;display:grid!important;place-items:center!important;padding:24px!important;color:#a8b3c2!important;font-size:13px!important;font-weight:680!important;text-align:center!important;background:#070b12!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoom.has-live-video #mcastRoomStatus{display:none!important;}",
			"html.mcast-guest.mcast-room-active #directorlayout{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout{position:absolute!important;inset:12px 12px 92px!important;z-index:2!important;display:grid!important;visibility:visible!important;opacity:1!important;width:auto!important;height:auto!important;margin:0!important;overflow:hidden!important;background:#05070b!important;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))!important;gap:12px!important;align-items:center!important;justify-items:center!important;place-content:center!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomStage>#gridlayout{inset:0!important;z-index:2!important;width:100%!important;height:100%!important;background:#070b12!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout>video,html.mcast-guest.mcast-room-active #gridlayout>.vidcon,html.mcast-guest.mcast-room-active #gridlayout>#minipreview,html.mcast-guest.mcast-room-active #gridlayout>[id^='container_']{position:relative!important;inset:auto!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;display:block!important;visibility:visible!important;opacity:1!important;width:100%!important;max-width:min(100%,1280px)!important;height:auto!important;min-height:0!important;aspect-ratio:16/9!important;margin:0!important;border-radius:8px!important;background:#111827!important;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 16px 44px rgba(0,0,0,.28)!important;overflow:hidden!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout>video,html.mcast-guest.mcast-room-active #gridlayout>.mcast-room-video{object-fit:cover!important;max-height:100%!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout video,html.mcast-guest.mcast-room-active #gridlayout canvas{width:100%!important;height:100%!important;border-radius:8px!important;object-fit:cover!important;background:#0b1018!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout video[data-mcast-manual-rotation='90']{transform:rotate(90deg)!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout video[data-mcast-manual-rotation='180']{transform:rotate(180deg)!important;}",
			"html.mcast-guest.mcast-room-active #gridlayout video[data-mcast-manual-rotation='270']{transform:rotate(270deg)!important;}",
			"html.mcast-guest.mcast-room-active #mcastNativeSink{position:fixed!important;left:-10000px!important;top:-10000px!important;width:2px!important;height:2px!important;overflow:hidden!important;opacity:0!important;visibility:visible!important;pointer-events:none!important;z-index:-1!important;}",
			"html.mcast-guest.mcast-room-active #mcastNativeSink #gridlayout{position:relative!important;inset:auto!important;display:block!important;width:2px!important;height:2px!important;min-width:0!important;min-height:0!important;overflow:hidden!important;opacity:0!important;visibility:visible!important;pointer-events:none!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #mcastNativeSink video:not(.mcast-render-video),html.mcast-guest.mcast-room-active #mcastNativeSink canvas{width:1px!important;height:1px!important;opacity:0!important;visibility:visible!important;pointer-events:none!important;}",
			"html.mcast-guest.mcast-room-active .togglePreview,html.mcast-guest.mcast-room-active .video-label-container,html.mcast-guest.mcast-room-active .video-label{display:none!important;}",
			"html.mcast-guest.mcast-room-active #controlButtons{display:flex!important;position:fixed!important;left:0!important;right:0!important;bottom:max(14px,env(safe-area-inset-bottom))!important;z-index:2147482990!important;width:100%!important;padding:0 12px!important;box-sizing:border-box!important;justify-content:center!important;align-items:center!important;pointer-events:none!important;transform:none!important;}",
			"html.mcast-guest.mcast-room-active #mcastRoomControls>#controlButtons{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;z-index:2!important;width:auto!important;max-width:100%!important;padding:0!important;}",
			"html.mcast-guest.mcast-room-active #subControlButtons{display:flex!important;max-width:calc(100vw - 24px)!important;min-width:0!important;min-height:52px!important;gap:6px!important;padding:7px!important;border:1px solid rgba(255,255,255,.13)!important;border-radius:999px!important;background:rgba(10,13,18,.78)!important;box-shadow:0 16px 42px rgba(0,0,0,.36)!important;backdrop-filter:blur(14px)!important;pointer-events:auto!important;align-items:center!important;justify-content:center!important;flex-wrap:nowrap!important;}",
			"html.mcast-guest.mcast-room-active #subControlButtons button,html.mcast-guest.mcast-room-active #subControlButtons .float,html.mcast-guest.mcast-room-active #subControlButtons a{border-radius:999px!important;min-width:42px!important;min-height:42px!important;}",
			"html.mcast-guest.mcast-room-active .prompt,html.mcast-guest.mcast-room-active [role='dialog'],html.mcast-guest.mcast-room-active .modal,html.mcast-guest.mcast-room-active #passwordPrompt{z-index:2147483001!important;}",
			"@keyframes mcastSpin{to{transform:rotate(360deg);}}",
			"html.mcast-guest.mcast-room-active.mcast-device-landscape #mcastRoom{grid-template-rows:46px minmax(0,1fr) 56px!important;gap:6px!important;padding:6px 6px max(6px,env(safe-area-inset-bottom))!important;}",
			"html.mcast-guest.mcast-room-active.mcast-device-landscape #mainmenu{padding:6px 6px 70px!important;}",
			"html.mcast-guest.mcast-room-active.mcast-device-landscape #directorlayout,html.mcast-guest.mcast-room-active.mcast-device-landscape #gridlayout{inset:6px 6px 70px!important;}",
			"html.mcast-guest.mcast-room-active.mcast-device-landscape #mcastRoomStage>#gridlayout{inset:0!important;}",
			"html.mcast-guest.mcast-room-active.mcast-device-landscape #controlButtons{bottom:max(8px,env(safe-area-inset-bottom))!important;}",
			"html.mcast-guest.mcast-room-active.mcast-device-landscape #subControlButtons{min-height:48px!important;padding:5px!important;}",
			"@media (max-width:760px){html.mcast-guest #mcastJoining{padding:0;}html.mcast-guest .mcast-join-panel{width:100%;height:100dvh;min-height:100dvh;border:0;border-radius:0;grid-template-columns:1fr;grid-template-rows:minmax(42dvh,1fr) auto;}html.mcast-guest .mcast-join-preview{min-height:42dvh;padding:14px;}html.mcast-guest .mcast-preview-stage{inset:64px 14px 84px;}html.mcast-guest .mcast-join-form{padding:24px 20px 20px;justify-content:flex-start;}html.mcast-guest .mcast-join-heading{font-size:24px;}html.mcast-guest .mcast-device-row{left:14px;right:14px;bottom:14px;gap:10px;}html.mcast-guest .mcast-device-button{min-width:0;flex:1;height:40px;font-size:12px;padding:0 10px;}html.mcast-guest.mcast-room-active #mcastRoom{grid-template-rows:50px minmax(0,1fr) 64px!important;gap:8px!important;padding:8px 8px max(8px,env(safe-area-inset-bottom))!important;}html.mcast-guest.mcast-room-active #mcastRoomHeader{padding:0 8px!important;}html.mcast-guest.mcast-room-active #mcastRoomStats{font-size:11px!important;}html.mcast-guest.mcast-room-active .mcast-room-subtitle{display:none!important;}html.mcast-guest.mcast-room-active #mcastRoomGrid{gap:8px!important;padding:8px!important;grid-template-columns:1fr!important;align-content:center!important;}html.mcast-guest.mcast-room-active #mcastRoomGrid[data-count='2'],html.mcast-guest.mcast-room-active #mcastRoomGrid[data-count='3'],html.mcast-guest.mcast-room-active #mcastRoomGrid[data-count='4']{grid-auto-rows:minmax(0,1fr)!important;}html.mcast-guest.mcast-room-active .mcast-video-tile{aspect-ratio:16/9!important;}html.mcast-guest.mcast-room-active #mainmenu{padding:8px 8px 88px!important;}html.mcast-guest.mcast-room-active #directorlayout,html.mcast-guest.mcast-room-active #gridlayout{inset:8px 8px 88px!important;}html.mcast-guest.mcast-room-active #mcastRoomStage>#gridlayout{display:none!important;}html.mcast-guest.mcast-room-active #subControlButtons{max-width:calc(100vw - 16px)!important;}}",
			"@media (orientation:landscape) and (max-height:540px){html.mcast-guest #mcastJoining{padding:8px;}html.mcast-guest .mcast-join-panel{height:calc(100dvh - 16px);min-height:0;grid-template-columns:minmax(0,1fr) minmax(300px,360px);}html.mcast-guest .mcast-join-preview{min-height:0;padding:12px;}html.mcast-guest .mcast-preview-stage{inset:58px 12px 70px;}html.mcast-guest .mcast-preview-avatar{width:88px;height:88px;font-size:32px;}html.mcast-guest .mcast-join-form{padding:18px;}html.mcast-guest .mcast-join-heading{font-size:21px;margin-bottom:7px;}html.mcast-guest .mcast-join-message{font-size:13px;margin-bottom:12px;}html.mcast-guest .mcast-device-row{left:12px;right:12px;bottom:12px;}html.mcast-guest .mcast-device-button{height:38px;min-width:110px;}html.mcast-guest .mcast-terms,html.mcast-guest .mcast-join-footer{display:none;}html.mcast-guest.mcast-room-active #mcastRoom{grid-template-rows:46px minmax(0,1fr) 56px!important;gap:6px!important;padding:6px 6px max(6px,env(safe-area-inset-bottom))!important;}html.mcast-guest.mcast-room-active #mcastRoomGrid{gap:6px!important;padding:6px!important;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))!important;}html.mcast-guest.mcast-room-active #mainmenu{padding:6px 6px 70px!important;}html.mcast-guest.mcast-room-active #directorlayout,html.mcast-guest.mcast-room-active #gridlayout{inset:6px 6px 70px!important;}html.mcast-guest.mcast-room-active #mcastRoomStage>#gridlayout{display:none!important;}html.mcast-guest.mcast-room-active #controlButtons{bottom:max(8px,env(safe-area-inset-bottom))!important;}html.mcast-guest.mcast-room-active #subControlButtons{min-height:48px!important;padding:5px!important;}}",
			"@media (min-width:1200px){html.mcast-guest.mcast-room-active #mcastRoom{grid-template-rows:64px minmax(0,1fr) 76px!important;gap:14px!important;padding:18px 18px max(18px,env(safe-area-inset-bottom))!important;}html.mcast-guest.mcast-room-active #mcastRoomGrid{gap:14px!important;padding:14px!important;}html.mcast-guest.mcast-room-active #mainmenu{padding:18px 18px 104px!important;}html.mcast-guest.mcast-room-active #directorlayout,html.mcast-guest.mcast-room-active #gridlayout{inset:18px 18px 104px!important;}html.mcast-guest.mcast-room-active #mcastRoomStage>#gridlayout{display:none!important;}}"
		].join("");
		document.head.appendChild(style);
	}

	function ensureGuestJoinShell() {
		if (route !== "guest" || !window.MCastRoute) {
			return null;
		}
		var existing = document.getElementById("mcastJoining");
		if (existing) {
			activeGuestShell = existing;
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
			"<button type=\"button\" class=\"mcast-join-action is-busy\" data-mcast-join disabled>Preparing room...</button>",
			"<div class=\"mcast-join-status\" data-mcast-status>Loading secure room...</div>",
			"<div class=\"mcast-join-footer\">Use headphones when possible. Keep this tab open while the host prepares the session.</div>",
			"<div class=\"mcast-terms\">By joining, you allow this browser to use your microphone and camera for this MCast Studio session.</div>",
			"</div>",
			"</section>"
		].join("");
		document.body.appendChild(shell);
		activeGuestShell = shell;
		hydrateGuestJoinShell(shell);
		updateGuestJoinStatus(window.MCastRoute.mode, window.MCastRoute.state);
		startNativeReadyMonitor(shell);
		return shell;
	}

	function updateGuestJoinStatus(mode, state) {
		if (route !== "guest" || !document.body) {
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
		if (!guestJoinPreferences.nativeReady && !guestJoinPreferences.joined) {
			setShellText(shell, "[data-mcast-status]", "Preparing room engine...");
		} else if (!guestJoinPreferences.joined) {
			setShellText(shell, "[data-mcast-status]", profile.status);
		}
	}

	function hydrateGuestJoinShell(shell) {
		var nameInput = shell.querySelector("[data-mcast-name]");
		var rememberInput = shell.querySelector("[data-mcast-remember]");
		var joinButton = shell.querySelector("[data-mcast-join]");
		var audioButton = shell.querySelector("[data-mcast-audio-toggle]");
		var videoButton = shell.querySelector("[data-mcast-video-toggle]");
		var rememberedName = getInitialGuestName();

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
			rememberInput.checked = guestJoinPreferences.rememberName;
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
				if (guestJoinPreferences.joined) {
					forceGuestMuteState(!guestJoinPreferences.audio);
				}
			});
		}
		if (videoButton) {
			videoButton.addEventListener("click", function () {
				guestJoinPreferences.video = !guestJoinPreferences.video;
				writeGuestPreference("video", guestJoinPreferences.video);
				renderGuestDeviceControls(shell);
				if (guestJoinPreferences.joined) {
					forceGuestVideoMuteState(!guestJoinPreferences.video);
				}
			});
		}

		updateGuestPreviewName(shell, rememberedName);
		renderGuestDeviceControls(shell);
	}

	function startNativeReadyMonitor(shell) {
		if (guestJoinPreferences.readyTimer) {
			window.clearInterval(guestJoinPreferences.readyTimer);
		}
		var attempts = 0;
		guestJoinPreferences.readyTimer = window.setInterval(function () {
			attempts++;
			if (guestJoinPreferences.joined) {
				window.clearInterval(guestJoinPreferences.readyTimer);
				guestJoinPreferences.readyTimer = null;
				return;
			}
			if (isNativeGuestJoinReady()) {
				guestJoinPreferences.nativeReady = true;
				setJoinButtonState(shell, false, "Join", false);
				updateGuestJoinStatus(window.MCastRoute.mode, window.MCastRoute.state);
				window.clearInterval(guestJoinPreferences.readyTimer);
				guestJoinPreferences.readyTimer = null;
				return;
			}
			if (attempts === 18) {
				setShellText(shell, "[data-mcast-status]", "Still preparing the secure room...");
			}
			if (attempts > 160) {
				window.clearInterval(guestJoinPreferences.readyTimer);
				guestJoinPreferences.readyTimer = null;
				setJoinButtonState(shell, true, "Room unavailable", false);
				setShellText(shell, "[data-mcast-status]", "Could not prepare the room. Refresh this invite and try again.");
			}
		}, 250);
	}

	function isNativeGuestJoinReady() {
		return typeof session !== "undefined" &&
			typeof requestBasicPermissions === "function" &&
			typeof setupWebcamSelection === "function" &&
			typeof publishWebcam === "function";
	}

	function installEarlyNativeRotationSuppressor() {
		var attempts = 0;
		var timer = window.setInterval(function () {
			attempts++;
			suppressNativePageRotationForMcast();
			normalizeNativeRoomViewport();
			if (
				attempts >= 80 ||
				(typeof window.updateForceRotatedCSS === "function" && window.updateForceRotatedCSS.mcastWrapped)
			) {
				window.clearInterval(timer);
			}
		}, 100);
	}

	function installMcastOrientationGate() {
		if (route !== "guest" || guestJoinPreferences.orientationGateInstalled) {
			return;
		}
		guestJoinPreferences.orientationGateInstalled = true;
		ensureMcastOrientationGateElement();
		["resize", "orientationchange"].forEach(function (eventName) {
			window.addEventListener(eventName, function () {
				window.setTimeout(handleMcastOrientationStateChange, 80);
				window.setTimeout(handleMcastOrientationStateChange, 450);
			});
		});
		handleMcastOrientationStateChange();
	}

	function ensureMcastOrientationGateElement() {
		if (document.getElementById("mcastOrientationGate") || !document.body) {
			return document.getElementById("mcastOrientationGate");
		}
		var gate = document.createElement("div");
		gate.id = "mcastOrientationGate";
		gate.setAttribute("role", "status");
		gate.setAttribute("aria-live", "polite");
		gate.innerHTML = [
			"<div class=\"mcast-orientation-card\">",
			"<div class=\"mcast-orientation-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\"><rect x=\"7\" y=\"3\" width=\"10\" height=\"18\" rx=\"2\"></rect><path d=\"M4 8a8 8 0 0 1 13-3\"></path><path d=\"M17 5h-4V1\"></path></svg></div>",
			"<h2 class=\"mcast-orientation-title\" data-mcast-orientation-title>Rotate your phone</h2>",
			"<p class=\"mcast-orientation-copy\" data-mcast-orientation-copy>Turn the device to continue.</p>",
			"</div>"
		].join("");
		document.body.appendChild(gate);
		return gate;
	}

	function handleMcastOrientationStateChange() {
		updateMcastOrientationGate();
		if (guestJoinPreferences.pendingJoinShell && !shouldBlockMcastForOrientation()) {
			var shell = guestJoinPreferences.pendingJoinShell;
			guestJoinPreferences.pendingJoinShell = null;
			setJoinButtonState(shell, false, "Joining...", true);
			window.setTimeout(function () {
				startGuestJoinFromShell(shell);
			}, 80);
		}
		if (guestJoinPreferences.joined) {
			ensureMcastNormalizedPublishStream();
			scheduleMcastNativeOrientationSync();
		}
	}

	function updateMcastOrientationGate() {
		var requested = getMcastRequestedOrientation();
		var blocked = shouldBlockMcastForOrientation();
		document.documentElement.classList.toggle("mcast-orientation-blocked", blocked);
		var gate = ensureMcastOrientationGateElement();
		if (!gate) {
			return;
		}
		var title = gate.querySelector("[data-mcast-orientation-title]");
		var copy = gate.querySelector("[data-mcast-orientation-copy]");
		if (title) {
			title.textContent = requested === "portrait" ? "Rotate to portrait" : "Rotate to landscape";
		}
		if (copy) {
			copy.textContent = requested === "portrait"
				? "This guest link is set for portrait video. Turn the phone upright to continue."
				: "This guest link is set for landscape video. Turn the phone sideways to continue.";
		}
	}

	function shouldBlockMcastForOrientation() {
		var requested = getMcastRequestedOrientation();
		return !!(requested && isLikelyMobileGuest() && !isMcastViewportOrientation(requested));
	}

	function isLikelyMobileGuest() {
		var ua = (navigator.userAgent || "").toLowerCase();
		return /iphone|ipad|ipod|android|webos|blackberry|iemobile|opera mini/.test(ua) ||
			(ua.indexOf("whatsapp") !== -1 && ua.indexOf("mobile") !== -1);
	}

	function getMcastRequestedOrientation() {
		if (guestJoinPreferences.routeOrientation === "landscape" || guestJoinPreferences.routeOrientation === "portrait") {
			return guestJoinPreferences.routeOrientation;
		}
		try {
			if (typeof session !== "undefined" && (session.orientation === "landscape" || session.orientation === "portrait")) {
				guestJoinPreferences.routeOrientation = session.orientation;
				return session.orientation;
			}
		} catch (error) {}
		return "";
	}

	function configureMcastOrientationSession() {
		var requested = getMcastRequestedOrientation();
		if (!requested || typeof session === "undefined") {
			return;
		}
		try {
			session.forceAspectRatio = requested === "landscape" ? 16 / 9 : 9 / 16;
		} catch (error) {}
	}

	function isMcastViewportOrientation(requested) {
		var width = window.innerWidth || document.documentElement.clientWidth || 0;
		var height = window.innerHeight || document.documentElement.clientHeight || 0;
		if (window.visualViewport) {
			width = window.visualViewport.width || width;
			height = window.visualViewport.height || height;
		}
		if (!width || !height) {
			return true;
		}
		return requested === "landscape" ? width >= height : height >= width;
	}

	function startGuestJoinFromShell(shell) {
		if (!shell || guestJoinPreferences.joined || !guestJoinPreferences.nativeReady) {
			return;
		}
		var nameInput = shell.querySelector("[data-mcast-name]");
		var rememberInput = shell.querySelector("[data-mcast-remember]");
		var name = nameInput ? nameInput.value.trim().slice(0, 60) : "";
		var rememberName = rememberInput ? rememberInput.checked : true;

		rememberMcastNativeOrientation();
		if (shouldBlockMcastForOrientation()) {
			normalizeNativeRoomViewport();
		}

		guestJoinPreferences.joined = true;
		guestJoinPreferences.nativeRoomEntered = false;
		guestJoinPreferences.joinStartedAt = Date.now();
		guestJoinPreferences.manualRotation = 0;
		writeGuestPreference("rememberName", rememberName);
		writeGuestPreference("audio", guestJoinPreferences.audio);
		writeGuestPreference("video", guestJoinPreferences.video);
		if (rememberName && name) {
			writeStoredGuestName(name);
		} else if (!rememberName) {
			writeStoredGuestName("");
		}

		updateGuestPreviewName(shell, name);
		applyGuestNameToNativeSession(name);
		setJoinButtonState(shell, true, "Joining...", true);
		setShellText(shell, "[data-mcast-status]", "Starting camera and microphone...");
		tryStartNativeGuestWebcamJoin(shell);
	}

	function tryStartNativeGuestWebcamJoin(shell) {
		try {
			rememberMcastNativeOrientation();
			suppressNativePageRotationForMcast();
			configureMcastOrientationSession();
			session.autostart = false;
			var constraints = {
				audio: !!guestJoinPreferences.audio,
				video: !!guestJoinPreferences.video
			};
			var miconly = !constraints.video;
			setShellText(shell, "[data-mcast-status]", "Allow browser camera and microphone permissions...");
			requestBasicPermissions(constraints, function (nativeMicOnly) {
				var joinMicOnly = miconly || !guestJoinPreferences.video;
				try {
					setupWebcamSelection(joinMicOnly);
				} catch (setupError) {
					console.error("MCast guest setup failed", setupError);
					setShellText(shell, "[data-mcast-status]", "Could not prepare media. Check browser permissions and try again.");
					resetGuestJoinButton(shell);
					return;
				}
				waitForNativeWebcamReadyAndPublish(shell, joinMicOnly, 0);
			}, miconly);
			window.setTimeout(function () {
				if (guestJoinPreferences.joined && !hasLiveGuestMedia()) {
					setShellText(shell, "[data-mcast-status]", "Waiting for browser permission...");
				}
			}, 1800);
			window.setTimeout(function () {
				if (guestJoinPreferences.joined && !hasLiveGuestMedia() && !guestJoinPreferences.nativeRoomEntered) {
					setShellText(shell, "[data-mcast-status]", "Permission was not completed. Allow browser camera/mic access and click Join again.");
					resetGuestJoinButton(shell);
				}
			}, 30000);
		} catch (error) {
			console.error("MCast guest webcam start failed", error);
			setShellText(shell, "[data-mcast-status]", "Could not start media. Check browser permissions and try again.");
			resetGuestJoinButton(shell);
		}
	}

	function waitForNativeWebcamReadyAndPublish(shell, miconly, attempt) {
		if (!guestJoinPreferences.joined) {
			return;
		}

		var goButton = document.getElementById("gowebcam");
		var ready = goButton && goButton.dataset && goButton.dataset.ready === "true";
		var audioReady = goButton && goButton.dataset && goButton.dataset.audioready === "true";
		var requiresVideo = !miconly && !!guestJoinPreferences.video;
		if (requiresVideo && hasLiveGuestVideoTrack()) {
			ensureMcastNormalizedPublishStream();
		}
		var videoReady = !requiresVideo || hasPublishableGuestVideo();
		if (requiresVideo && !videoReady && attempt >= 4) {
			ensureDirectGuestPreviewStream(shell);
		}
		if (requiresVideo && hasLiveGuestVideoTrack() && !hasLiveGuestVideoFrame()) {
			primeMcastGuestVideoPlayback();
		}
		if (requiresVideo && !videoReady && attempt > 0 && attempt % 12 === 0) {
			setShellText(shell, "[data-mcast-status]", guestJoinPreferences.directPreviewFailed ? "Could not start camera. Check browser permissions and try again." : "Starting camera preview...");
		}
		if (goButton && videoReady && (ready || miconly || !guestJoinPreferences.video) && (audioReady || !guestJoinPreferences.audio)) {
			try {
				if (requiresVideo) {
					forceMcastGuestVideoUnmuted();
					primeMcastGuestVideoPlayback();
				}
				setShellText(shell, "[data-mcast-status]", "Joining room...");
				publishWebcam(false, !!miconly);
				enterNativeGuestRoom(shell, miconly);
				if (requiresVideo) {
					forceMcastGuestVideoUnmuted();
					window.setTimeout(forceMcastGuestVideoUnmuted, 500);
					window.setTimeout(primeMcastGuestVideoPlayback, 700);
				}
				applyGuestMediaPreferencesLater();
			} catch (publishError) {
				console.error("MCast guest publish failed", publishError);
				setShellText(shell, "[data-mcast-status]", "Could not join. Check browser permissions and try again.");
				resetGuestJoinButton(shell);
			}
			return;
		}

		if (requiresVideo && guestJoinPreferences.directPreviewFailed && attempt >= 24) {
			setShellText(shell, "[data-mcast-status]", "Could not start camera. Check browser permissions and try again.");
			resetGuestJoinButton(shell);
			return;
		}

		if (attempt >= 100) {
			setShellText(shell, "[data-mcast-status]", "Could not prepare camera or microphone. Check browser permissions and try again.");
			resetGuestJoinButton(shell);
			return;
		}

		window.setTimeout(function () {
			waitForNativeWebcamReadyAndPublish(shell, miconly, attempt + 1);
		}, 250);
	}

	function enterNativeGuestRoom(shell, miconly) {
		guestJoinPreferences.nativeRoomEntered = true;
		document.documentElement.classList.add("mcast-native-room");
		if (document.body) {
			document.body.classList.add("mcast-native-room");
		}
		if (shell) {
			shell.classList.toggle("mcast-video-off", !!miconly || !guestJoinPreferences.video);
			setShellText(shell, "[data-mcast-status]", "Connected");
			window.setTimeout(function () {
				shell.classList.add("mcast-ready");
				shell.style.display = "none";
			}, 350);
		}
		startNativeInlineVideoGuard();
		scheduleMcastNativeOrientationSync();
		showOriginalVdoRoomAfterJoin();
		window.setTimeout(requestMixerLayoutUpdate, 300);
		window.setTimeout(showOriginalVdoRoomAfterJoin, 900);
		window.setTimeout(requestMixerLayoutUpdate, 1200);
		window.setTimeout(showOriginalVdoRoomAfterJoin, 2500);
	}

	function showOriginalVdoRoomAfterJoin() {
		document.documentElement.classList.remove("mcast-room-active");
		if (document.body) {
			document.body.classList.remove("mcast-room-active");
		}
		normalizeNativeRoomViewport();
		if (guestJoinPreferences.roomSkinTimer) {
			window.clearInterval(guestJoinPreferences.roomSkinTimer);
			guestJoinPreferences.roomSkinTimer = null;
		}
		var mcastRoom = document.getElementById("mcastRoom");
		var nativeSink = document.getElementById("mcastNativeSink");
		var gridlayout = document.getElementById("gridlayout");
		var mainmenu = document.getElementById("mainmenu");
		if (gridlayout && nativeSink && nativeSink.contains(gridlayout)) {
			var testtone = document.getElementById("testtone");
			var restoreParent = (testtone && testtone.parentNode) || (mainmenu && mainmenu.parentNode) || document.body || document.documentElement;
			restoreParent.insertBefore(gridlayout, testtone || null);
		}
		if (mcastRoom) {
			mcastRoom.remove();
		}
		restoreNativeRoomElement(gridlayout, true);
		restoreNativeRoomElement(document.getElementById("controlButtons"), true);
		restoreNativeRoomElement(document.getElementById("subControlButtons"), true);
		repairNativeVideoLayer();
		normalizeNativeInlineVideoElements(document);
		if (mainmenu) {
			mainmenu.classList.remove("permahide");
			mainmenu.style.removeProperty("transform");
			mainmenu.style.removeProperty("position");
			mainmenu.style.removeProperty("inset");
			mainmenu.style.removeProperty("width");
			mainmenu.style.removeProperty("height");
			mainmenu.style.removeProperty("min-width");
			mainmenu.style.removeProperty("min-height");
			mainmenu.style.removeProperty("overflow");
			mainmenu.style.removeProperty("padding");
		}
		var joiningShell = document.getElementById("mcastJoining");
		if (joiningShell && guestJoinPreferences.nativeRoomEntered) {
			joiningShell.classList.add("mcast-ready");
			joiningShell.style.display = "none";
		}
	}

	function restoreNativeRoomElement(element, show) {
		if (!element) {
			return;
		}
		element.classList.remove("permahide");
		if (show) {
			element.classList.remove("hidden", "hidden2");
		}
		[
			"display",
			"visibility",
			"opacity",
			"pointer-events",
			"position",
			"inset",
			"left",
			"right",
			"top",
			"bottom",
			"width",
			"height",
			"min-width",
			"min-height",
			"max-width",
			"max-height",
			"margin",
			"padding",
			"transform",
			"z-index"
		].forEach(function (property) {
			element.style.removeProperty(property);
		});
	}

	function repairNativeVideoLayer() {
		var gridlayout = document.getElementById("gridlayout");
		if (!gridlayout) {
			return;
		}
		gridlayout.classList.remove("hidden", "hidden2", "permahide");
		gridlayout.style.setProperty("display", "block", "important");
		gridlayout.style.setProperty("visibility", "visible", "important");
		gridlayout.style.setProperty("opacity", "1", "important");
		gridlayout.style.setProperty("position", "relative", "important");
		gridlayout.style.setProperty("z-index", "1", "important");
		var visibleNodes = gridlayout.querySelectorAll("video,.holder,.container_holder_video,.vidcon");
		for (var index = 0; index < visibleNodes.length; index++) {
			visibleNodes[index].style.setProperty("visibility", "visible", "important");
			visibleNodes[index].style.setProperty("opacity", "1", "important");
		}
	}

	function normalizeNativeInlineVideoElements(root) {
		var videos = [];
		if (root && root.tagName && root.tagName.toLowerCase() === "video") {
			videos.push(root);
		}
		if (root && root.querySelectorAll) {
			videos = videos.concat(Array.prototype.slice.call(root.querySelectorAll("video")));
		}
		videos.forEach(function (video) {
			video.playsInline = true;
			video.setAttribute("playsinline", "");
			video.setAttribute("webkit-playsinline", "");
			video.controls = false;
			video.removeAttribute("controls");
		});
	}

	function startNativeInlineVideoGuard() {
		repairNativeVideoLayer();
		normalizeNativeInlineVideoElements(document);
		syncMcastNativeOrientation();
		if (!guestJoinPreferences.inlineVideoGuardTimer) {
			var passes = 0;
			guestJoinPreferences.inlineVideoGuardTimer = window.setInterval(function () {
				passes++;
				repairNativeVideoLayer();
				normalizeNativeInlineVideoElements(document);
				syncMcastNativeOrientation();
				if (passes >= 40) {
					window.clearInterval(guestJoinPreferences.inlineVideoGuardTimer);
					guestJoinPreferences.inlineVideoGuardTimer = null;
				}
			}, 750);
		}
		if (guestJoinPreferences.inlineVideoGuardObserver || typeof MutationObserver !== "function" || !document.body) {
			return;
		}
		guestJoinPreferences.inlineVideoGuardObserver = new MutationObserver(function (mutations) {
			mutations.forEach(function (mutation) {
				for (var index = 0; index < mutation.addedNodes.length; index++) {
					var node = mutation.addedNodes[index];
					if (node && node.nodeType === 1) {
						repairNativeVideoLayer();
						normalizeNativeInlineVideoElements(node);
					}
				}
			});
		});
		guestJoinPreferences.inlineVideoGuardObserver.observe(document.body, { childList: true, subtree: true });
		window.setTimeout(function () {
			if (guestJoinPreferences.inlineVideoGuardObserver) {
				guestJoinPreferences.inlineVideoGuardObserver.disconnect();
				guestJoinPreferences.inlineVideoGuardObserver = null;
			}
		}, 30000);
	}

	function startNativeRoomSkinSync() {
		if (guestJoinPreferences.roomSkinTimer) {
			return;
		}
		var attempts = 0;
		guestJoinPreferences.roomSkinTimer = window.setInterval(function () {
			attempts++;
			if (!guestJoinPreferences.joined) {
				window.clearInterval(guestJoinPreferences.roomSkinTimer);
				guestJoinPreferences.roomSkinTimer = null;
				return;
			}
			skinNativeRoomOnce();
			if (attempts % 8 === 0) {
				requestMixerLayoutUpdate();
				window.setTimeout(skinNativeRoomOnce, 80);
			}
		}, 350);
		window.addEventListener("resize", function () {
			requestMixerLayoutUpdate();
			queueMcastRoomRepairPasses([80, 260, 700]);
		});
		window.addEventListener("orientationchange", function () {
			queueMcastRoomRepairPasses([80, 250, 700, 1400]);
		});
	}

	function scheduleMcastRoomVideoRepairs() {
		if (guestJoinPreferences.videoRepairScheduled) {
			return;
		}
		guestJoinPreferences.videoRepairScheduled = true;
		queueMcastRoomRepairPasses([0, 120, 300, 700, 1400, 2600, 4200]);
	}

	function queueMcastRoomRepairPasses(delays) {
		(delays || [120]).forEach(function (delay) {
			window.setTimeout(function () {
				if (guestJoinPreferences.nativeRoomEntered) {
					repairMcastNativeRoomPass();
				} else {
					requestMixerLayoutUpdate();
					skinNativeRoomOnce();
				}
			}, delay);
		});
	}

	function repairMcastNativeRoomPass() {
		requestMixerLayoutUpdate();
		suppressNativePageRotationForMcast();
		normalizeNativeRoomViewport();
		repairNativeVideoLayer();
		normalizeNativeInlineVideoElements(document);
		syncMcastNativeOrientation();
		showOriginalVdoRoomAfterJoin();
	}

	function installMcastRoomControlHandlers() {
		var flipButton = document.getElementById("flipcamerabutton");
		if (!flipButton || flipButton.dataset.mcastBound === "1") {
			return;
		}
		flipButton.dataset.mcastBound = "1";
		flipButton.title = "Switch camera";
		flipButton.setAttribute("aria-label", "Switch camera");
	}

	function hasMultipleCameraChoices() {
		var videoSelect = document.getElementById("videoSource3") || document.getElementById("videoSourceSelect");
		if (!videoSelect || !videoSelect.options) {
			return false;
		}
		var maxIndex = parseInt((document.getElementById("flipcamerabutton") || {}).dataset && document.getElementById("flipcamerabutton").dataset.maxIndex, 10);
		if (!maxIndex || maxIndex > videoSelect.options.length) {
			maxIndex = videoSelect.options.length;
		}
		return maxIndex > 1;
	}

	function cycleMcastLocalRotation() {
		var current = normalizeMcastRotation(guestJoinPreferences.manualRotation);
		var next = current === 0 ? 90 : current === 90 ? 180 : current === 180 ? 270 : 0;
		guestJoinPreferences.manualRotation = next;
		var room = document.getElementById("mcastRoom");
		if (room) {
			room.dataset.mcastManualRotation = String(next);
		}
		normalizeMcastOutgoingRotation();
		normalizeMcastRoomVideos(document.getElementById("mcastRoomGrid") || document.getElementById("gridlayout") || document);
		requestMixerLayoutUpdate();
		queueMcastRoomRepairPasses([80, 260, 700]);
	}

	function prepareMcastRoomBeforePublish() {
		document.documentElement.classList.add("mcast-room-active");
		if (document.body) {
			document.body.classList.add("mcast-room-active");
		}
		var roomSurface = ensureMcastRoomSurface();
		var gridlayout = document.getElementById("gridlayout");
		if (gridlayout) {
			prepareNativeRoomGrid(gridlayout, roomSurface.nativeSink);
		}
		ensureLocalVideoInNativeSink(roomSurface.nativeSink);
		syncMcastRenderedRoom(roomSurface);
	}

	function suppressNativePageRotationForMcast() {
		if (typeof window.updateForceRotatedCSS !== "function" || window.updateForceRotatedCSS.mcastWrapped) {
			return;
		}
		var nativeUpdateForceRotatedCSS = window.updateForceRotatedCSS;
		window.updateForceRotatedCSS = function () {
			if (route === "guest") {
				normalizeNativeRoomViewport();
				return;
			}
			return nativeUpdateForceRotatedCSS.apply(this, arguments);
		};
		window.updateForceRotatedCSS.mcastWrapped = true;
	}

	function rememberMcastNativeOrientation() {
		try {
			if (
				typeof session !== "undefined" &&
				(session.orientation === "landscape" || session.orientation === "portrait")
			) {
				guestJoinPreferences.routeOrientation = session.orientation;
			}
		} catch (error) {}
	}

	function restoreMcastNativeOrientation() {
		try {
			if (
				typeof session !== "undefined" &&
				!normalizeMcastRotation(guestJoinPreferences.manualRotation) &&
				(guestJoinPreferences.routeOrientation === "landscape" || guestJoinPreferences.routeOrientation === "portrait")
			) {
				session.orientation = guestJoinPreferences.routeOrientation;
			}
		} catch (error) {}
	}

	function scheduleMcastNativeOrientationSync() {
		[0, 250, 700, 1400, 2600, 4200].forEach(function (delay) {
			window.setTimeout(syncMcastNativeOrientation, delay);
		});
	}

	function syncMcastNativeOrientation() {
		try {
			rememberMcastNativeOrientation();
			if (ensureMcastNormalizedPublishStream()) {
				sendMcastPeerRotation(0);
				return;
			}
			if (normalizeMcastRotation(guestJoinPreferences.manualRotation)) {
				normalizeMcastOutgoingRotation();
				return;
			}
			restoreMcastNativeOrientation();
			if (
				typeof session !== "undefined" &&
				session.orientation &&
				typeof window.updateForceRotate === "function"
			) {
				window.updateForceRotate(true);
			}
		} catch (error) {}
	}

	function skinNativeRoomOnce() {
		document.documentElement.classList.add("mcast-room-active");
		if (document.body) {
			document.body.classList.add("mcast-room-active");
		}
		suppressNativePageRotationForMcast();
		normalizeNativeRoomViewport();
		var joiningShell = document.getElementById("mcastJoining");
		if (joiningShell) {
			joiningShell.classList.add("mcast-ready");
			joiningShell.style.display = "none";
		}
		var roomSurface = ensureMcastRoomSurface();
		var controlButtons = document.getElementById("controlButtons");
		if (controlButtons) {
			controlButtons.classList.remove("hidden");
		}
		var subControlButtons = document.getElementById("subControlButtons");
		if (subControlButtons) {
			subControlButtons.classList.remove("hidden");
		}
		installMcastRoomControlHandlers();
		var mainmenu = document.getElementById("mainmenu");
		if (mainmenu) {
			mainmenu.classList.remove("hidden", "hidden2", "permahide", "row");
			mainmenu.style.display = "block";
			mainmenu.style.opacity = "1";
			mainmenu.style.visibility = "visible";
		}
		var directorlayout = document.getElementById("directorlayout");
		if (directorlayout) {
			directorlayout.classList.add("hidden");
		}
		var gridlayout = document.getElementById("gridlayout");
		if (gridlayout) {
			prepareNativeRoomGrid(gridlayout, roomSurface.nativeSink);
		}
		ensureLocalVideoInNativeSink(roomSurface.nativeSink);
		syncMcastRenderedRoom(roomSurface);
	}

	function ensureMcastRoomSurface() {
		var room = document.getElementById("mcastRoom");
		if (!room) {
			room = document.createElement("div");
			room.id = "mcastRoom";
			room.setAttribute("aria-label", "MCast room");
			room.innerHTML = [
				"<div id=\"mcastRoomHeader\"><div class=\"mcast-room-brand\"><img class=\"mcast-room-logo\" src=\"./media/mcast-apple-touch-icon.png\" alt=\"\"><div><div class=\"mcast-room-title\">MCast Studio</div><div class=\"mcast-room-subtitle\">Remote room</div></div></div><div id=\"mcastRoomStats\">Connecting</div></div>",
				"<div id=\"mcastRoomStage\"><div id=\"mcastRoomStatus\">Opening camera...</div><div id=\"mcastRoomGrid\" data-count=\"0\"></div></div>",
				"<div id=\"mcastRoomControls\"></div>",
				"<div id=\"mcastNativeSink\" aria-hidden=\"true\"></div>"
			].join("");
			(document.body || document.documentElement).appendChild(room);
		}
		var header = document.getElementById("mcastRoomHeader");
		if (!header) {
			header = document.createElement("div");
			header.id = "mcastRoomHeader";
			header.innerHTML = "<div class=\"mcast-room-brand\"><img class=\"mcast-room-logo\" src=\"./media/mcast-apple-touch-icon.png\" alt=\"\"><div><div class=\"mcast-room-title\">MCast Studio</div><div class=\"mcast-room-subtitle\">Remote room</div></div></div><div id=\"mcastRoomStats\">Connecting</div>";
			room.insertBefore(header, room.firstChild);
		}
		var stage = document.getElementById("mcastRoomStage");
		if (!stage) {
			stage = document.createElement("div");
			stage.id = "mcastRoomStage";
			room.insertBefore(stage, document.getElementById("mcastRoomControls") || null);
		}
		var status = document.getElementById("mcastRoomStatus");
		if (!status) {
			status = document.createElement("div");
			status.id = "mcastRoomStatus";
			status.textContent = "Opening camera...";
			stage.insertBefore(status, stage.firstChild);
		}
		var renderGrid = document.getElementById("mcastRoomGrid");
		if (!renderGrid) {
			renderGrid = document.createElement("div");
			renderGrid.id = "mcastRoomGrid";
			renderGrid.dataset.count = "0";
			stage.appendChild(renderGrid);
		}
		var controls = document.getElementById("mcastRoomControls");
		if (!controls) {
			controls = document.createElement("div");
			controls.id = "mcastRoomControls";
			room.appendChild(controls);
		}
		var nativeSink = document.getElementById("mcastNativeSink");
		if (!nativeSink) {
			nativeSink = document.createElement("div");
			nativeSink.id = "mcastNativeSink";
			nativeSink.setAttribute("aria-hidden", "true");
			room.appendChild(nativeSink);
		}
		var gridlayout = document.getElementById("gridlayout");
		if (gridlayout && gridlayout.parentNode !== nativeSink) {
			nativeSink.appendChild(gridlayout);
		}
		var controlButtons = document.getElementById("controlButtons");
		if (controlButtons && controlButtons.parentNode !== controls) {
			controls.appendChild(controlButtons);
		}
		return {
			room: room,
			header: header,
			stage: stage,
			grid: renderGrid,
			controls: controls,
			nativeSink: nativeSink
		};
	}

	function prepareNativeRoomGrid(gridlayout, nativeSink) {
		if (!gridlayout || !nativeSink) {
			return;
		}
		if (gridlayout.parentNode !== nativeSink) {
			nativeSink.appendChild(gridlayout);
		}
		gridlayout.classList.remove("hidden", "hidden2", "permahide");
		gridlayout.style.display = "block";
		gridlayout.style.visibility = "visible";
		gridlayout.style.opacity = "0";
		gridlayout.style.pointerEvents = "none";
	}

	function ensureLocalVideoInNativeSink(nativeSink) {
		if (!nativeSink) {
			return;
		}
		try {
			var localVideo = resolveLocalMcastVideo();
			if (!localVideo) {
				return;
			}
			attachMcastStreamIfNeeded(localVideo);
			configureMcastRoomVideo(localVideo, true);
			if (!localVideo.isConnected) {
				nativeSink.appendChild(localVideo);
			}
			playMcastVideo(localVideo);
		} catch (error) {
			console.warn("MCast could not keep the native local video alive", error);
		}
	}

	function syncMcastRenderedRoom(roomSurface) {
		if (!roomSurface || !roomSurface.grid) {
			return;
		}
		var sources = collectMcastVideoSources();
		var activeKeys = {};
		sources.forEach(function (source) {
			activeKeys[source.key] = true;
			upsertMcastRenderTile(roomSurface.grid, source);
		});
		Array.prototype.slice.call(roomSurface.grid.querySelectorAll(".mcast-video-tile")).forEach(function (tile) {
			if (!activeKeys[tile.dataset.mcastKey]) {
				var video = tile.querySelector("video");
				if (video && roomSurface.nativeSink) {
					video.classList.remove("mcast-render-video");
					roomSurface.nativeSink.appendChild(video);
				}
				tile.remove();
			}
		});
		roomSurface.grid.dataset.count = String(sources.length);
		roomSurface.room.classList.toggle("has-live-video", sources.length > 0);
		ensureMcastCanvasRenderer();
		var stats = document.getElementById("mcastRoomStats");
		if (stats) {
			stats.textContent = sources.length ? sources.length + " connected" : "Connecting";
		}
	}

	function collectMcastVideoSources() {
		var sources = [];
		var localVideo = resolveLocalMcastVideo();
		if (localVideo && hasPlayableVideoSource(localVideo)) {
			sources.push({
				key: "local",
				label: "You",
				local: true,
				video: localVideo,
				rotation: normalizeMcastRotation(guestJoinPreferences.manualRotation)
			});
		}
		try {
			if (typeof session !== "undefined" && session.rpcs) {
				for (var UUID in session.rpcs) {
					if (!Object.prototype.hasOwnProperty.call(session.rpcs, UUID)) {
						continue;
					}
					var rpc = session.rpcs[UUID];
					var remoteVideo = getRpcVideoSource(UUID, rpc);
					if (!remoteVideo || !hasPlayableVideoSource(remoteVideo)) {
						continue;
					}
					sources.push({
						key: "remote-" + UUID,
						label: getMcastRenderLabel(rpc, remoteVideo, "Guest"),
						local: false,
						video: remoteVideo,
						rotation: 0
					});
				}
			}
		} catch (error) {}
		return sources;
	}

	function getRpcVideoSource(UUID, rpc) {
		if (rpc && rpc.videoElement) {
			return rpc.videoElement;
		}
		return document.getElementById("videosource_" + UUID) ||
			document.querySelector("[data-uuid='" + UUID + "'],[data-UUID='" + UUID + "']");
	}

	function upsertMcastRenderTile(grid, source) {
		var tile = grid.querySelector("[data-mcast-key='" + source.key + "']");
		if (!tile) {
			tile = document.createElement("div");
			tile.className = "mcast-video-tile";
			tile.dataset.mcastKey = source.key;
			tile.innerHTML = "<canvas class=\"mcast-render-canvas\"></canvas><div class=\"mcast-tile-label\"></div>";
			grid.appendChild(tile);
		}
		Array.prototype.slice.call(tile.querySelectorAll("video")).forEach(function (video) {
			video.classList.remove("mcast-render-video");
			var nativeSink = document.getElementById("mcastNativeSink");
			if (nativeSink) {
				nativeSink.appendChild(video);
			}
		});
		var label = tile.querySelector(".mcast-tile-label");
		if (label) {
			label.textContent = source.label;
		}
		syncMcastRenderCanvas(tile.querySelector("canvas"), source);
	}

	function syncMcastRenderCanvas(canvas, source) {
		if (!canvas || !source || !source.video) {
			return;
		}
		var video = source.video;
		configureMcastRoomVideo(video, source.local);
		video.classList.remove("mcast-render-video");
		keepMcastSourceVideoOffscreen(video);
		canvas._mcastSourceVideo = video;
		canvas._mcastSourceLocal = !!source.local;
		canvas._mcastSourceRotation = normalizeMcastRotation(source.rotation);
		if (canvas.dataset) {
			canvas.dataset.rotated = String(canvas._mcastSourceRotation);
			if (source.local && canvas._mcastSourceRotation) {
				canvas.dataset.mcastManualRotation = String(canvas._mcastSourceRotation);
			} else {
				delete canvas.dataset.mcastManualRotation;
			}
		}
		playMcastVideo(video);
	}

	function keepMcastSourceVideoOffscreen(video) {
		if (!video) {
			return;
		}
		var nativeSink = document.getElementById("mcastNativeSink");
		if (!nativeSink) {
			return;
		}
		if (!video.isConnected || (video.parentElement && video.parentElement.classList && video.parentElement.classList.contains("mcast-video-tile"))) {
			nativeSink.appendChild(video);
		}
	}

	function ensureMcastCanvasRenderer() {
		if (guestJoinPreferences.canvasRenderStarted) {
			return;
		}
		guestJoinPreferences.canvasRenderStarted = true;
		function render() {
			try {
				drawMcastCanvasTiles();
			} catch (error) {}
			window.requestAnimationFrame(render);
		}
		window.requestAnimationFrame(render);
	}

	function drawMcastCanvasTiles() {
		var canvases = document.querySelectorAll("#mcastRoomGrid canvas.mcast-render-canvas");
		Array.prototype.forEach.call(canvases, function (canvas) {
			drawMcastCanvasTile(canvas);
		});
	}

	function drawMcastCanvasTile(canvas) {
		var video = canvas._mcastSourceVideo;
		if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
			return;
		}
		var rect = canvas.getBoundingClientRect();
		var ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		var width = Math.max(1, Math.round(rect.width * ratio));
		var height = Math.max(1, Math.round(rect.height * ratio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		var context = canvas.getContext("2d");
		if (!context) {
			return;
		}
		var rotation = normalizeMcastRotation(canvas._mcastSourceRotation);
		var rotated = rotation === 90 || rotation === 270;
		var drawAreaWidth = rotated ? height : width;
		var drawAreaHeight = rotated ? width : height;
		var videoRatio = video.videoWidth / video.videoHeight;
		var areaRatio = drawAreaWidth / drawAreaHeight;
		var drawWidth = drawAreaWidth;
		var drawHeight = drawAreaHeight;
		if (videoRatio > areaRatio) {
			drawHeight = drawAreaHeight;
			drawWidth = drawHeight * videoRatio;
		} else {
			drawWidth = drawAreaWidth;
			drawHeight = drawWidth / videoRatio;
		}
		context.save();
		context.clearRect(0, 0, width, height);
		context.fillStyle = "#0b1018";
		context.fillRect(0, 0, width, height);
		context.translate(width / 2, height / 2);
		if (canvas._mcastSourceLocal) {
			context.scale(-1, 1);
		}
		if (rotation) {
			context.rotate(rotation * Math.PI / 180);
		}
		context.drawImage(video, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
		context.restore();
	}

	function getMcastRenderLabel(rpc, video, fallback) {
		if (rpc && rpc.label) {
			return String(rpc.label).split("\n")[0].trim() || fallback;
		}
		if (video && video.labelText) {
			return String(video.labelText).split("\n")[0].trim() || fallback;
		}
		if (rpc && rpc.streamID) {
			return String(rpc.streamID).trim() || fallback;
		}
		return fallback;
	}

	function syncMcastRoomSurfaceState(room, gridlayout) {
		if (!room) {
			return;
		}
		var hasLiveTile = false;
		if (gridlayout) {
			var tiles = gridlayout.querySelectorAll("video,canvas,.container_holder_video,.vidcon,#minipreview,[id^='container_']");
			hasLiveTile = Array.prototype.some.call(tiles, function (tile) {
				return hasVisibleVideoTile(tile);
			});
		}
		room.classList.toggle("has-live-video", hasLiveTile);
	}

	function hasVisibleVideoTile(tile) {
		if (!tile) {
			return false;
		}
		var tagName = tile.tagName ? tile.tagName.toLowerCase() : "";
		if (tagName === "video") {
			return hasPlayableVideoSource(tile);
		}
		if (tagName === "canvas") {
			return tile.offsetWidth > 0 && tile.offsetHeight > 0;
		}
		var videos = tile.querySelectorAll ? tile.querySelectorAll("video") : [];
		for (var index = 0; index < videos.length; index++) {
			if (hasPlayableVideoSource(videos[index])) {
				return true;
			}
		}
		var canvases = tile.querySelectorAll ? tile.querySelectorAll("canvas") : [];
		return canvases.length > 0 && tile.offsetWidth > 0 && tile.offsetHeight > 0;
	}

	function normalizeNativeRoomViewport() {
		syncMcastViewportClasses();
		if (!document.body) {
			return;
		}
		document.body.dataset.rotated = "";
		document.body.style.transform = "none";
		document.body.style.position = "fixed";
		document.body.style.top = "0";
		document.body.style.left = "0";
		document.body.style.width = "100vw";
		document.body.style.height = "100dvh";
		document.body.style.transformOrigin = "initial";
	}

	function ensureLocalVideoOnNativeStage(stage) {
		if (!stage) {
			return;
		}
		try {
			var localVideo = resolveLocalMcastVideo();
			if (!localVideo) {
				return;
			}
			attachMcastStreamIfNeeded(localVideo);
			if (!hasPlayableVideoSource(localVideo)) {
				return;
			}
			localVideo.classList.add("mcast-room-video");
			localVideo.classList.remove("hidden", "hidden2", "permahide");
			localVideo.setAttribute("playsinline", "");
			localVideo.setAttribute("webkit-playsinline", "");
			localVideo.autoplay = true;
			localVideo.muted = true;
			localVideo.style.display = "block";
			localVideo.style.visibility = "visible";
			localVideo.style.opacity = "1";
			applyMcastVideoRotation(localVideo, normalizeMcastRotation(guestJoinPreferences.manualRotation), true);
			if (localVideo.parentNode !== stage && !stage.contains(localVideo)) {
				stage.appendChild(localVideo);
			}
			playMcastVideo(localVideo);
		} catch (error) {
			console.warn("MCast could not place the local video in the room stage", error);
		}
	}

	function resolveLocalMcastVideo() {
		var candidates = [];
		function add(video) {
			if (video && candidates.indexOf(video) === -1) {
				candidates.push(video);
			}
		}
		try {
			if (typeof session !== "undefined") {
				add(session.videoElement);
			}
		} catch (error) {}
		add(document.getElementById("videosource"));
		add(document.getElementById("previewWebcam"));
		for (var index = 0; index < candidates.length; index++) {
			if (hasPlayableVideoSource(candidates[index])) {
				return candidates[index];
			}
		}
		for (var fallbackIndex = 0; fallbackIndex < candidates.length; fallbackIndex++) {
			if (attachMcastStreamIfNeeded(candidates[fallbackIndex])) {
				return candidates[fallbackIndex];
			}
		}
		return candidates[0] || null;
	}

	function attachMcastStreamIfNeeded(video) {
		if (!video) {
			return false;
		}
		if (video.srcObject && typeof video.srcObject.getVideoTracks === "function" && video.srcObject.getVideoTracks().some(function (track) {
			return track.readyState === "live";
		})) {
			return true;
		}
		try {
			if (typeof session === "undefined" || !session.streamSrc || typeof session.streamSrc.getVideoTracks !== "function") {
				return false;
			}
			var tracks = session.streamSrc.getVideoTracks();
			if (!tracks.some(function (track) {
				return track.readyState === "live";
			})) {
				return false;
			}
			video.srcObject = session.streamSrc;
			return true;
		} catch (error) {
			return false;
		}
	}

	function normalizeMcastRoomVideos(root) {
		syncMcastViewportClasses();
		normalizeMcastOutgoingRotation();
		var videos = [];
		if (root && root.tagName && root.tagName.toLowerCase() === "video") {
			videos.push(root);
		}
		if (root && root.querySelectorAll) {
			videos = videos.concat(Array.prototype.slice.call(root.querySelectorAll("video")));
		}
		videos.forEach(function (video) {
			var local = isLocalMcastVideo(video);
			configureMcastRoomVideo(video, local);
			applyMcastVideoRotation(video, local ? normalizeMcastRotation(guestJoinPreferences.manualRotation) : 0, local);
			playMcastVideo(video);
		});
	}

	function configureMcastRoomVideo(video, local) {
		if (!video) {
			return;
		}
		if (local) {
			attachMcastStreamIfNeeded(video);
			video.classList.add("mcast-room-video");
			video.muted = true;
		}
		video.classList.remove("hidden", "hidden2", "permahide");
		video.setAttribute("playsinline", "");
		video.setAttribute("webkit-playsinline", "");
		video.autoplay = true;
		video.controls = false;
		video.removeAttribute("controls");
		video.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback");
		try {
			video.disablePictureInPicture = true;
			video.disableRemotePlayback = true;
		} catch (error) {}
		video.style.display = "block";
		video.style.visibility = "visible";
		video.style.opacity = "1";
	}

	function isLocalMcastVideo(video) {
		if (!video) {
			return false;
		}
		if (video.id === "videosource" || video.id === "previewWebcam") {
			return true;
		}
		try {
			return typeof session !== "undefined" && session.videoElement === video;
		} catch (error) {
			return false;
		}
	}

	function applyMcastVideoRotation(video, rotation, local) {
		if (!video) {
			return;
		}
		var normalized = normalizeMcastRotation(rotation);
		video.rotated = normalized;
		if (video.dataset) {
			video.dataset.rotated = String(normalized);
			if (local && normalized) {
				video.dataset.mcastManualRotation = String(normalized);
			} else {
				delete video.dataset.mcastManualRotation;
			}
		}
		video.style.setProperty("transform", normalized ? "rotate(" + normalized + "deg)" : "none", "important");
	}

	function normalizeMcastOutgoingRotation() {
		var rotation = normalizeMcastRotation(guestJoinPreferences.manualRotation);
		try {
			if (typeof session === "undefined") {
				return;
			}
			if (hasMcastNormalizedVideoTrack()) {
				session.orientation = false;
				session.forceRotate = 0;
				session.rotate = 0;
				sendMcastPeerRotation(0);
				return;
			}
			rememberMcastNativeOrientation();
			if (!rotation) {
				restoreMcastNativeOrientation();
				if (session.orientation && typeof window.updateForceRotate === "function") {
					window.updateForceRotate(true);
					return;
				}
			} else {
				session.orientation = false;
			}
			session.forceRotate = 0;
			session.rotate = rotation;
			if (session.videoElement) {
				applyMcastVideoRotation(session.videoElement, rotation, true);
			}
			if (!session.pcs) {
				return;
			}
			for (var UUID in session.pcs) {
				if (!Object.prototype.hasOwnProperty.call(session.pcs, UUID)) {
					continue;
				}
				try {
					if (session.pcs[UUID] && session.pcs[UUID].rotation !== rotation) {
						session.pcs[UUID].rotation = rotation;
						if (typeof session.sendMessage === "function") {
							session.sendMessage({ rotate_video: rotation }, UUID);
						}
					}
				} catch (error) {}
			}
		} catch (error) {}
	}

	function normalizeMcastRotation(value) {
		var rotation = parseInt(value, 10);
		if (!rotation) {
			return 0;
		}
		rotation = ((rotation % 360) + 360) % 360;
		return rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;
	}

	function syncMcastViewportClasses() {
		var width = window.innerWidth || (window.visualViewport && window.visualViewport.width) || 0;
		var height = window.innerHeight || (window.visualViewport && window.visualViewport.height) || 0;
		if (window.visualViewport) {
			width = window.visualViewport.width || width;
			height = window.visualViewport.height || height;
		}
		var landscape = width > height;
		document.documentElement.classList.toggle("mcast-device-landscape", landscape);
		if (document.body) {
			document.body.classList.toggle("mcast-device-landscape", landscape);
		}
		var room = document.getElementById("mcastRoom");
		if (room) {
			room.classList.toggle("mcast-device-landscape", landscape);
		}
	}

	function playMcastVideo(video, force) {
		if (!video || typeof video.play !== "function") {
			return;
		}
		prepareMcastInlineVideo(video);
		if (!force && shouldAvoidExplicitMobileVideoPlay()) {
			return;
		}
		try {
			video.play().catch(function () {});
		} catch (error) {}
	}

	function prepareMcastInlineVideo(video) {
		if (!video) {
			return;
		}
		video.muted = true;
		video.autoplay = true;
		video.playsInline = true;
		video.setAttribute("playsinline", "");
		video.setAttribute("webkit-playsinline", "");
		video.controls = false;
		video.removeAttribute("controls");
	}

	function shouldAvoidExplicitMobileVideoPlay() {
		var ua = (navigator.userAgent || "").toLowerCase();
		return /iphone|ipad|ipod/.test(ua) || (ua.indexOf("whatsapp") !== -1 && ua.indexOf("mobile") !== -1);
	}

	function hasPlayableVideoSource(video) {
		if (!video) {
			return false;
		}
		if (hasRenderedVideoFrame(video)) {
			return true;
		}
		var stream = video.srcObject;
		if (!stream || typeof stream.getTracks !== "function") {
			return !!((video.src || video.currentSrc) && video.readyState >= 2);
		}
		if (typeof stream.getVideoTracks === "function") {
			return stream.getVideoTracks().some(function (track) {
				return track.readyState === "live";
			});
		}
		return stream.getTracks().some(function (track) {
			return track.kind === "video" && track.readyState === "live";
		});
	}

	function hasRenderedVideoFrame(video) {
		return !!(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
	}

	function hasLiveStreamTrack(stream, kind) {
		if (!stream || typeof stream.getTracks !== "function") {
			return false;
		}
		var tracks = [];
		if (kind === "video" && typeof stream.getVideoTracks === "function") {
			tracks = stream.getVideoTracks();
		} else if (kind === "audio" && typeof stream.getAudioTracks === "function") {
			tracks = stream.getAudioTracks();
		} else {
			tracks = stream.getTracks().filter(function (track) {
				return track.kind === kind;
			});
		}
		return tracks.some(function (track) {
			return track && track.readyState === "live";
		});
	}

	function hasLiveGuestVideoTrack() {
		if (!guestJoinPreferences.video) {
			return false;
		}
		try {
			if (typeof session !== "undefined") {
				if (hasLiveStreamTrack(session.streamSrc, "video")) {
					return true;
				}
				if (session.videoElement && hasLiveStreamTrack(session.videoElement.srcObject, "video")) {
					return true;
				}
			}
		} catch (error) {}
		var preview = document.getElementById("previewWebcam");
		if (preview && hasLiveStreamTrack(preview.srcObject, "video")) {
			return true;
		}
		var published = document.getElementById("videosource");
		return !!(published && hasLiveStreamTrack(published.srcObject, "video"));
	}

	function hasLiveGuestVideoFrame() {
		if (!guestJoinPreferences.video) {
			return false;
		}
		try {
			if (typeof session !== "undefined" && session.videoElement && hasRenderedVideoFrame(session.videoElement)) {
				return true;
			}
		} catch (error) {}
		var preview = document.getElementById("previewWebcam");
		if (hasRenderedVideoFrame(preview)) {
			return true;
		}
		var published = document.getElementById("videosource");
		return hasRenderedVideoFrame(published);
	}

	function hasPublishableGuestVideo() {
		return hasLiveGuestVideoTrack() && hasLiveGuestVideoFrame();
	}

	function hasLiveGuestVideo() {
		if (!guestJoinPreferences.video) {
			return false;
		}
		var preview = document.getElementById("previewWebcam");
		if (hasPlayableVideoSource(preview)) {
			return true;
		}
		var published = document.getElementById("videosource");
		if (hasPlayableVideoSource(published)) {
			return true;
		}
		try {
			return !!(typeof session !== "undefined" && session.videoElement && session.videoElement.isConnected && hasPlayableVideoSource(session.videoElement));
		} catch (error) {
			return false;
		}
	}

	function ensureDirectGuestPreviewStream(shell) {
		if (!guestJoinPreferences.video || guestJoinPreferences.directPreviewPromise || hasLiveGuestVideoTrack()) {
			return;
		}
		if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
			return;
		}
		guestJoinPreferences.directPreviewFailed = false;
		guestJoinPreferences.directPreviewError = "";
		setShellText(shell, "[data-mcast-status]", "Starting camera...");
		cancelNativeCameraProbe();
		guestJoinPreferences.directPreviewPromise = requestMcastCameraStream().then(function (stream) {
			try {
				if (!attachMcastCameraStream(stream)) {
					throw new Error("Camera did not provide a video track.");
				}
				markNativeGoButtonReady();
			} catch (error) {
				console.warn("MCast direct guest preview setup failed", error);
				guestJoinPreferences.directPreviewFailed = true;
				guestJoinPreferences.directPreviewError = error && (error.name || error.message) ? (error.name || error.message) : "setup failed";
				stopMediaStream(stream);
				throw error;
			}
		}).catch(function (error) {
			console.warn("MCast direct guest media request failed", error);
			guestJoinPreferences.directPreviewFailed = true;
			guestJoinPreferences.directPreviewError = error && (error.name || error.message) ? (error.name || error.message) : "request failed";
		}).finally(function () {
			guestJoinPreferences.directPreviewPromise = null;
		});
	}

	function requestMcastCameraStream() {
		var facing = false;
		try {
			facing = typeof session !== "undefined" && session.facingMode ? session.facingMode : false;
		} catch (error) {}
		var firstVideoConstraint = getMcastOrientationVideoConstraints(facing);
		return navigator.mediaDevices.getUserMedia({
			audio: false,
			video: firstVideoConstraint
		}).catch(function (firstError) {
			if (!facing) {
				throw firstError;
			}
			return navigator.mediaDevices.getUserMedia({
				audio: false,
				video: true
			});
		});
	}

	function getMcastOrientationVideoConstraints(facing) {
		var requested = getMcastRequestedOrientation();
		var video = facing ? { facingMode: { ideal: facing } } : {};
		if (requested === "landscape") {
			video.width = { ideal: 1280 };
			video.height = { ideal: 720 };
			video.aspectRatio = { ideal: 16 / 9 };
		} else if (requested === "portrait") {
			video.width = { ideal: 720 };
			video.height = { ideal: 1280 };
			video.aspectRatio = { ideal: 9 / 16 };
		}
		return Object.keys(video).length ? video : true;
	}

	function ensureMcastNormalizedPublishStream() {
		var requested = getMcastRequestedOrientation();
		if (!requested || typeof session === "undefined" || !session.streamSrc || typeof session.streamSrc.getVideoTracks !== "function") {
			return false;
		}
		var tracks = session.streamSrc.getVideoTracks();
		if (!tracks.length) {
			return false;
		}
		var currentTrack = tracks[0];
		if (currentTrack && currentTrack._mcastNormalized && currentTrack._mcastOrientation === requested) {
			sendMcastPeerRotation(0);
			return true;
		}
		if (!currentTrack || currentTrack.readyState !== "live" || currentTrack._mcastNormalized) {
			return false;
		}
		var normalizedTrack = createMcastOrientationTrack(currentTrack, requested);
		if (!normalizedTrack) {
			return false;
		}
		replaceSessionVideoTrackWithoutStoppingRaw(currentTrack, normalizedTrack);
		try {
			session.orientation = false;
			session.forceRotate = 0;
			session.rotate = 0;
		} catch (error) {}
		forceMcastGuestVideoUnmuted();
		try {
			if (typeof updateRenderOutpipe === "function") {
				updateRenderOutpipe();
			} else if (session.videoElement) {
				session.videoElement.srcObject = session.streamSrc;
			}
		} catch (error) {
			if (session.videoElement) {
				session.videoElement.srcObject = session.streamSrc;
			}
		}
		ensureMcastNormalizedTrackAttached(normalizedTrack);
		if (session.videoElement) {
			prepareMcastInlineVideo(session.videoElement);
			playMcastVideo(session.videoElement, true);
		}
		var preview = ensurePreviewVideoElement();
		preview.srcObject = session.videoElement && session.videoElement.srcObject ? session.videoElement.srcObject : session.streamSrc;
		prepareMcastInlineVideo(preview);
		playMcastVideo(preview, true);
		sendMcastPeerRotation(0);
		return true;
	}

	function createMcastOrientationTrack(rawTrack, requested) {
		if (!rawTrack || typeof document === "undefined") {
			return null;
		}
		var canvas = ensureMcastOrientationCanvas(requested);
		if (!canvas || typeof canvas.captureStream !== "function") {
			return null;
		}
		var sourceVideo = ensureMcastOrientationSourceVideo(rawTrack);
		if (!sourceVideo) {
			return null;
		}
		startMcastOrientationCanvasLoop(sourceVideo, canvas, requested);
		var captureStream = canvas.captureStream(30);
		var track = captureStream && captureStream.getVideoTracks ? captureStream.getVideoTracks()[0] : null;
		if (!track) {
			return null;
		}
		track._mcastNormalized = true;
		track._mcastOrientation = requested;
		track._mcastSourceTrackId = rawTrack.id || "";
		try {
			track.contentHint = "motion";
		} catch (error) {}
		guestJoinPreferences.normalizedVideoTrack = track;
		guestJoinPreferences.normalizedVideoStream = captureStream;
		return track;
	}

	function ensureMcastOrientationCanvas(requested) {
		var canvas = guestJoinPreferences.orientationCanvas;
		if (!canvas) {
			canvas = document.createElement("canvas");
			canvas.id = "mcastOrientationCanvas";
			canvas.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;opacity:0;pointer-events:none;";
			(document.body || document.documentElement).appendChild(canvas);
			guestJoinPreferences.orientationCanvas = canvas;
			guestJoinPreferences.orientationContext = canvas.getContext("2d", { alpha: false });
		}
		var target = getMcastOrientationCanvasSize(requested);
		if (canvas.width !== target.width || canvas.height !== target.height) {
			canvas.width = target.width;
			canvas.height = target.height;
		}
		return canvas;
	}

	function ensureMcastOrientationSourceVideo(rawTrack) {
		var sourceVideo = guestJoinPreferences.orientationSourceVideo;
		if (!sourceVideo) {
			sourceVideo = document.createElement("video");
			sourceVideo.id = "mcastOrientationSource";
			sourceVideo.muted = true;
			sourceVideo.autoplay = true;
			sourceVideo.playsInline = true;
			sourceVideo.setAttribute("playsinline", "");
			sourceVideo.setAttribute("webkit-playsinline", "");
			sourceVideo.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;opacity:0;pointer-events:none;";
			(document.body || document.documentElement).appendChild(sourceVideo);
			guestJoinPreferences.orientationSourceVideo = sourceVideo;
		}
		if (guestJoinPreferences.orientationSourceTrackId !== rawTrack.id) {
			sourceVideo.srcObject = new MediaStream([rawTrack]);
			guestJoinPreferences.orientationSourceTrackId = rawTrack.id || "";
		}
		playMcastVideo(sourceVideo, true);
		return sourceVideo;
	}

	function startMcastOrientationCanvasLoop(sourceVideo, canvas, requested) {
		var context = guestJoinPreferences.orientationContext || canvas.getContext("2d", { alpha: false });
		guestJoinPreferences.orientationContext = context;
		if (!context) {
			return;
		}
		if (guestJoinPreferences.orientationFrameRequest) {
			window.cancelAnimationFrame(guestJoinPreferences.orientationFrameRequest);
			guestJoinPreferences.orientationFrameRequest = 0;
		}
		var draw = function () {
			try {
				drawMcastOrientationFrame(sourceVideo, canvas, context);
			} catch (error) {}
			guestJoinPreferences.orientationFrameRequest = window.requestAnimationFrame(draw);
		};
		draw();
	}

	function drawMcastOrientationFrame(sourceVideo, canvas, context) {
		var sourceWidth = sourceVideo.videoWidth || 0;
		var sourceHeight = sourceVideo.videoHeight || 0;
		if (!sourceWidth || !sourceHeight) {
			context.fillStyle = "#05070b";
			context.fillRect(0, 0, canvas.width, canvas.height);
			return;
		}
		var targetRatio = canvas.width / canvas.height;
		var sourceRatio = sourceWidth / sourceHeight;
		var drawWidth = sourceWidth;
		var drawHeight = sourceHeight;
		var sourceX = 0;
		var sourceY = 0;
		if (sourceRatio > targetRatio) {
			drawWidth = sourceHeight * targetRatio;
			sourceX = (sourceWidth - drawWidth) / 2;
		} else if (sourceRatio < targetRatio) {
			drawHeight = sourceWidth / targetRatio;
			sourceY = (sourceHeight - drawHeight) / 2;
		}
		context.fillStyle = "#05070b";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(sourceVideo, sourceX, sourceY, drawWidth, drawHeight, 0, 0, canvas.width, canvas.height);
	}

	function getMcastOrientationCanvasSize(requested) {
		return requested === "portrait"
			? { width: 720, height: 1280 }
			: { width: 1280, height: 720 };
	}

	function replaceSessionVideoTrackWithoutStoppingRaw(rawTrack, normalizedTrack) {
		if (!session.streamSrc || typeof session.streamSrc.getVideoTracks !== "function") {
			session.streamSrc = createMcastMediaStream();
		}
		session.streamSrc.getVideoTracks().forEach(function (track) {
			try {
				session.streamSrc.removeTrack(track);
			} catch (error) {}
			if (track !== rawTrack && track._mcastNormalized) {
				try {
					track.stop();
				} catch (error) {}
			}
		});
		session.streamSrc.addTrack(normalizedTrack);
	}

	function ensureMcastNormalizedTrackAttached(normalizedTrack) {
		try {
			if (!normalizedTrack || normalizedTrack.readyState !== "live" || !session.streamSrc || typeof session.streamSrc.getVideoTracks !== "function") {
				return;
			}
			var attached = session.streamSrc.getVideoTracks().some(function (track) {
				return track === normalizedTrack;
			});
			if (!attached) {
				session.streamSrc.addTrack(normalizedTrack);
			}
		} catch (error) {}
	}

	function sendMcastPeerRotation(rotation) {
		try {
			if (typeof session === "undefined") {
				return;
			}
			session.forceRotate = 0;
			session.rotate = rotation || 0;
			if (!session.pcs) {
				return;
			}
			for (var UUID in session.pcs) {
				if (!Object.prototype.hasOwnProperty.call(session.pcs, UUID)) {
					continue;
				}
				if (session.pcs[UUID] && session.pcs[UUID].rotation !== rotation) {
					session.pcs[UUID].rotation = rotation;
					if (typeof session.sendMessage === "function") {
						session.sendMessage({ rotate_video: rotation }, UUID);
					}
				}
			}
		} catch (error) {}
	}

	function hasMcastNormalizedVideoTrack() {
		try {
			if (typeof session === "undefined" || !session.streamSrc || typeof session.streamSrc.getVideoTracks !== "function") {
				return false;
			}
			return session.streamSrc.getVideoTracks().some(function (track) {
				return !!(track && track._mcastNormalized && track.readyState === "live");
			});
		} catch (error) {
			return false;
		}
	}

	function attachMcastCameraStream(cameraStream) {
		if (!cameraStream || !hasLiveStreamTrack(cameraStream, "video")) {
			return false;
		}
		if (typeof session === "undefined") {
			return false;
		}
		if (!session.streamSrc || typeof session.streamSrc.getTracks !== "function") {
			session.streamSrc = createMcastMediaStream();
		}
		removeVideoTracks(session.streamSrc);
		cameraStream.getVideoTracks().forEach(function (track) {
			if (track.readyState === "live") {
				session.streamSrc.addTrack(track);
			}
		});
		if (!hasLiveStreamTrack(session.streamSrc, "video")) {
			return false;
		}
		ensureMcastNormalizedPublishStream();
		forceMcastGuestVideoUnmuted();
		try {
			if (typeof checkBasicStreamsExist === "function") {
				checkBasicStreamsExist();
			}
			if (typeof updateRenderOutpipe === "function") {
				updateRenderOutpipe();
			} else if (session.videoElement) {
				session.videoElement.srcObject = session.streamSrc;
			}
		} catch (error) {
			console.warn("MCast camera render pipe update failed", error);
			if (session.videoElement) {
				session.videoElement.srcObject = session.streamSrc;
			}
		}
		forceMcastGuestVideoUnmuted();
		if (session.videoElement) {
			prepareMcastInlineVideo(session.videoElement);
			playMcastVideo(session.videoElement, true);
		}
		var preview = ensurePreviewVideoElement();
		preview.srcObject = session.videoElement && session.videoElement.srcObject ? session.videoElement.srcObject : session.streamSrc;
		prepareMcastInlineVideo(preview);
		playMcastVideo(preview, true);
		return hasLiveGuestVideoTrack();
	}

	function primeMcastGuestVideoPlayback() {
		try {
			if (typeof session !== "undefined" && session.videoElement) {
				playMcastVideo(session.videoElement, true);
			}
		} catch (error) {}
		playMcastVideo(document.getElementById("previewWebcam"), true);
		playMcastVideo(document.getElementById("videosource"), true);
	}

	function forceMcastGuestVideoUnmuted() {
		try {
			if (typeof session === "undefined") {
				return;
			}
			session.videoMuted = false;
			session.videoMutedFlag = false;
			enableVideoTracks(session.streamSrc);
			if (session.videoElement) {
				enableVideoTracks(session.videoElement.srcObject);
			}
			var button = document.getElementById("mutevideobutton");
			if (button) {
				button.classList.remove("red");
				button.ariaPressed = "false";
			}
			var toggle = document.getElementById("mutevideotoggle");
			if (toggle) {
				toggle.className = "las la-video toggleSize";
			}
		} catch (error) {}
	}

	function enableVideoTracks(stream) {
		if (!stream || typeof stream.getVideoTracks !== "function") {
			return;
		}
		stream.getVideoTracks().forEach(function (track) {
			try {
				track.enabled = true;
			} catch (error) {}
		});
	}

	function createMcastMediaStream() {
		if (typeof createMediaStream === "function") {
			return createMediaStream();
		}
		return new MediaStream();
	}

	function removeVideoTracks(stream) {
		if (!stream || typeof stream.getVideoTracks !== "function") {
			return;
		}
		stream.getVideoTracks().forEach(function (track) {
			try {
				stream.removeTrack(track);
			} catch (error) {}
			try {
				track.stop();
			} catch (error) {}
		});
	}

	function stopMediaStream(stream) {
		if (!stream || typeof stream.getTracks !== "function") {
			return;
		}
		stream.getTracks().forEach(function (track) {
			try {
				track.stop();
			} catch (error) {}
		});
	}

	function cancelNativeCameraProbe() {
		try {
			if (typeof getUserMediaRequestID !== "undefined") {
				getUserMediaRequestID += 1;
			}
		} catch (error) {}
		try {
			if (typeof activatedPreview !== "undefined") {
				activatedPreview = true;
			}
		} catch (error) {}
	}

	function replaceNativeStream(stream) {
		try {
			var oldStream = session.streamSrc;
			if (oldStream && oldStream !== stream && typeof oldStream.getTracks === "function") {
				oldStream.getTracks().forEach(function (track) {
					try {
						track.stop();
					} catch (error) {}
				});
			}
			session.streamSrc = stream;
			if (session.videoDevice === 0) {
				session.videoDevice = 1;
			}
			if (guestJoinPreferences.audio && session.audioDevice === 0) {
				session.audioDevice = 1;
			}
		} catch (error) {}
	}

	function ensurePreviewVideoElement() {
		var preview = document.getElementById("previewWebcam");
		if (!preview) {
			preview = document.createElement("video");
			preview.id = "previewWebcam";
			preview.className = "myVideo mirrorControl";
			var parent = document.getElementById("mcastJoining") || document.getElementById("main") || document.body || document.documentElement;
			parent.appendChild(preview);
		}
		return preview;
	}

	function markNativeGoButtonReady() {
		var goButton = document.getElementById("gowebcam");
		if (!goButton || !goButton.dataset) {
			return;
		}
		goButton.dataset.ready = "true";
		if (guestJoinPreferences.audio) {
			goButton.dataset.audioready = "true";
		}
		goButton.disabled = false;
	}

	function requestMixerLayoutUpdate() {
		try {
			if (typeof updateMixer === "function") {
				updateMixer();
			}
		} catch (error) {}
	}

	function resetGuestJoinButton(shell) {
		guestJoinPreferences.joined = false;
		guestJoinPreferences.nativeRoomEntered = false;
		guestJoinPreferences.pendingJoinShell = null;
		document.documentElement.classList.remove("mcast-native-room");
		if (document.body) {
			document.body.classList.remove("mcast-native-room");
		}
		if (guestJoinPreferences.inlineVideoGuardTimer) {
			window.clearInterval(guestJoinPreferences.inlineVideoGuardTimer);
			guestJoinPreferences.inlineVideoGuardTimer = null;
		}
		if (guestJoinPreferences.inlineVideoGuardObserver) {
			guestJoinPreferences.inlineVideoGuardObserver.disconnect();
			guestJoinPreferences.inlineVideoGuardObserver = null;
		}
		setJoinButtonState(shell, false, "Join", false);
	}

	function setJoinButtonState(shell, disabled, label, busy) {
		var joinButton = shell ? shell.querySelector("[data-mcast-join]") : null;
		if (!joinButton) {
			return;
		}
		joinButton.disabled = !!disabled;
		joinButton.textContent = label || "Join";
		joinButton.classList.toggle("is-busy", !!busy);
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
		var fields = document.querySelectorAll("input[name='label'],input[name='l'],input[name='name'],input[id='label'],input[id='name'],input[id='username'],input[id^='videoname']");
		for (var index = 0; index < fields.length; index++) {
			fields[index].value = cleanName;
			fields[index].dispatchEvent(new Event("input", { bubbles: true }));
			fields[index].dispatchEvent(new Event("change", { bubbles: true }));
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
		var element = root ? root.querySelector(selector) : null;
		if (element) {
			element.textContent = value || "";
		}
	}

	function setShellHtml(root, selector, value) {
		var element = root ? root.querySelector(selector) : null;
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
				heading: "Join the meeting",
				message: "Check your name and devices before entering the room.",
				status: "Ready to join"
			},
			classroom: {
				heading: "Join the classroom",
				message: "Check your name and devices before entering the class.",
				status: "Ready to join"
			},
			stream_guest: {
				heading: "Join the green room",
				message: "The production team can prepare your feed before you go live.",
				status: "Ready to join"
			},
			webinar: {
				heading: "Join the webinar",
				message: "The host will approve speakers before they appear on screen.",
				status: "Ready to join"
			},
			podcast: {
				heading: "Podcast audio check",
				message: "Keep your microphone ready while the host prepares the recording.",
				status: "Ready to join"
			},
			remote_interview: {
				heading: "Interview waiting room",
				message: "The producer will check your audio and video before the session.",
				status: "Ready to join"
			}
		};
		var profile = profiles[mode] || profiles.stream_guest;
		if (state === "raised_hand") {
			profile = {
				heading: "Hand raised",
				message: "The host can see your request and will bring you in when ready.",
				status: "Ready to join"
			};
		} else if (state === "on_screen") {
			profile = {
				heading: "Join live",
				message: "Stay ready and keep this browser tab open.",
				status: "Ready to join"
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

	function normalizeGuestNameParams(routedParams) {
		var explicitName = readFirstGuestNameParam(routedParams, ["label", "l"]);
		var suggestedName = readFirstGuestNameParam(routedParams, ["defaultlabel", "labelsuggestion", "ls"]);
		var storedName = readStoredGuestName();

		["label", "l", "defaultlabel", "labelsuggestion", "ls"].forEach(function (key) {
			routedParams.delete(key);
		});

		var name = explicitName || storedName || suggestedName;
		if (name) {
			routedParams.set("l", name);
		}
	}

	function readFirstGuestNameParam(routedParams, keys) {
		for (var index = 0; index < keys.length; index++) {
			var value = normalizeGuestDisplayName(routedParams.get(keys[index]) || "");
			if (value) {
				return value;
			}
		}
		return "";
	}

	function normalizeGuestDisplayName(value) {
		var name = (value || "").toString().replace(/_/g, " ");
		try {
			name = decodeURIComponent(name);
		} catch (error) {}
		return name.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
	}

	function getInitialGuestName() {
		var routeName = window.MCastRoute ? normalizeGuestDisplayName(window.MCastRoute.guestName || "") : "";
		return routeName || readStoredGuestName();
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
		} catch (error) {}
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

	function cleanTransportRouteParams(sourceParams) {
		try {
			if (!window.history || typeof window.history.replaceState !== "function") {
				return;
			}
			var cleanParams = new URLSearchParams(sourceParams.toString());
			cleanParams.delete("t");
			cleanParams.delete("token");
			cleanParams.delete("r");
			cleanParams.delete("s");
			cleanParams.delete("code");
			var nextQuery = cleanParams.toString();
			var nextUrl = window.location.pathname +
				(nextQuery ? "?" + nextQuery : "") +
				(window.location.hash || "");
			window.history.replaceState({ path: nextUrl }, "", nextUrl);
		} catch (error) {
			console.warn("MCast could not clean transport route params", error);
		}
	}

	function cleanNativeDisplayNamePromptParamsFromLocation() {
		try {
			if (!window.history || typeof window.history.replaceState !== "function") {
				return;
			}
			var currentParams = new URLSearchParams(window.location.search || "");
			var changed = false;
			["label", "l", "defaultlabel", "labelsuggestion", "ls"].forEach(function (key) {
				if (currentParams.has(key)) {
					currentParams.delete(key);
					changed = true;
				}
			});
			if (!changed) {
				return;
			}
			var nextQuery = currentParams.toString();
			var nextUrl = window.location.pathname +
				(nextQuery ? "?" + nextQuery : "") +
				(window.location.hash || "");
			window.history.replaceState({ path: nextUrl }, "", nextUrl);
		} catch (error) {
			console.warn("MCast could not clean native display-name params", error);
		}
	}

	function persistResolvedGuestRoute(query) {
		try {
			if (!window.sessionStorage) {
				return;
			}
			window.sessionStorage.setItem("mcastResolvedGuestRoute", serializeParams(new URLSearchParams(query.replace(/^\?/, ""))));
		} catch (error) {}
	}

	function readStoredResolvedGuestRoute() {
		try {
			if (!window.sessionStorage) {
				return "";
			}
			return (window.sessionStorage.getItem("mcastResolvedGuestRoute") || "").toString().trim();
		} catch (error) {
			return "";
		}
	}

	function persistResolvedGuestRouteInLocation(query) {
		try {
			if (!window.history || typeof window.history.replaceState !== "function") {
				return;
			}
			var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
			["label", "l", "defaultlabel", "labelsuggestion", "ls", "t", "token", "s", "code"].forEach(function (key) {
				routedParams.delete(key);
			});
			var nextQuery = serializeParams(routedParams);
			if (!nextQuery) {
				return;
			}
			var nextUrl = window.location.pathname.replace(/\/+$/, "/") +
				"?" + nextQuery +
				(window.location.hash || "");
			if (nextUrl !== window.location.pathname + window.location.search + window.location.hash) {
				window.history.replaceState({ path: nextUrl }, "", nextUrl);
			}
		} catch (error) {
			console.warn("MCast could not persist the guest room route", error);
		}
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
		document.documentElement.classList.add("mcast-route-error");
		var style = document.getElementById("mcastRouteErrorStyles");
		if (!style) {
			style = document.createElement("style");
			style.id = "mcastRouteErrorStyles";
			style.textContent = [
				"html.mcast-route-error,html.mcast-route-error body{margin:0!important;min-height:100%!important;background:#0b0f16!important;overflow:hidden!important;}",
				"html.mcast-route-error body>*:not(#mcastRouteError){display:none!important;}",
				"#mcastRouteError{position:fixed!important;inset:0!important;z-index:2147483647!important;display:grid!important;place-items:center!important;background:#0b0f16!important;color:#f8d7da!important;font:500 16px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;text-align:center!important;padding:24px!important;box-sizing:border-box!important;}"
			].join("");
			document.head.appendChild(style);
		}
		var render = function () {
			if (!document.body) {
				return;
			}
			var error = document.getElementById("mcastRouteError");
			if (!error) {
				error = document.createElement("div");
				error.id = "mcastRouteError";
				document.body.appendChild(error);
			}
			error.textContent = message;
		};
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", render);
		} else {
			render();
		}
	}

	function escapeHtml(value) {
		return (value || "").toString()
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}
})();
