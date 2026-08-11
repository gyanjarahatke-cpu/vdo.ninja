(function () {
	"use strict";

	var roomTicketResolveUrl = "https://mcast-studio.web.app/api/vdoRoomTicketResolve";
	var rawPath = (window.location.pathname || "").replace(/\/+$/, "");
	var path = rawPath.toLowerCase();
	var route = isGuestInvitePath(path) ? "guest" : isCallPath(path) ? "call" : "";
	if (!route) {
		return;
	}

	installDirectorControlBridge();

	if (route === "call") {
		document.documentElement.classList.add("mcast-route");
		document.documentElement.classList.add("mcast-vcall");
	}

	var params = new URLSearchParams(window.location.search || "");
	var decoded = "";
	var shortCode = route === "call"
		? params.get("r") || ""
		: params.get("s") || params.get("code") || readShortInviteCodeFromPath(rawPath);

	if (route === "guest") {
		decoded = consumePreloadedGuestRoute(shortCode);
	} else if (shortCode) {
		decoded = resolveStoredRoute(shortCode, route);
	} else {
		showInviteError("This MCast Studio room link is not authorized.");
		return;
	}

	if (!decoded) {
		if (route === "guest") {
			showInviteError("This MCast Studio room link is missing or has expired.");
		}
		return;
	}

	if (shortCode && route !== "guest") {
		cleanTransportRouteParams(params);
	}

	decoded = applyRouteDefaults(decoded, route);
	if (route === "guest") {
		if (!hasGuestRoomTarget(decoded)) {
			showInviteError("This MCast Studio room link is missing or has expired.");
			return;
		}
	}

	applyRouteMetadata(decoded, route);
	if (typeof session !== "undefined") {
		session.decrypted = "?" + decoded.replace(/^\?/, "");
		session.nohistory = true;
	}

	function applyRouteDefaults(query, currentRoute) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		if (currentRoute === "guest") {
			var mode = normalizeRouteToken(routedParams.get("mcastmode") || "", "");
			var remoteSource = normalizeRouteToken(routedParams.get("mcastremote") || "", "");
			if (remoteSource) {
				applyRemoteSourceDefaults(routedParams, remoteSource);
				return serializeParams(routedParams);
			}
			setFlag(routedParams, "webcam");
			disableGuestAuxiliaryUiParams(routedParams);
			removeMcastGuestShellParams(routedParams);
			cleanEmptyNativeDeviceParams(routedParams);
			normalizeGuestNameParams(routedParams);

			if (!routedParams.has("push") && (mode === "meeting" || mode === "classroom")) {
				routedParams.set("push", getOrCreateSingleLinkGuestPush(routedParams));
			}
			removeGuestAutostartParams(routedParams);
			disableGuestAuxiliaryUiParams(routedParams);
			removeMcastGuestShellParams(routedParams);
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

	function applyRemoteSourceDefaults(routedParams, remoteSource) {
		disableGuestAuxiliaryUiParams(routedParams);
		removeMcastGuestShellParams(routedParams);
		removeGuestAutostartParams(routedParams);
		routedParams.delete("mcastrequestedautostart");
		cleanEmptyNativeDeviceParams(routedParams);
		normalizeGuestNameParams(routedParams);

		if (remoteSource === "remote_screen") {
			routedParams.delete("webcam");
			setFlag(routedParams, "screenshare");
			var screenShareId = routedParams.get("screenshareid") || routedParams.get("ssid") || routedParams.get("push") || "";
			if (screenShareId) {
				routedParams.set("push", screenShareId);
				routedParams.set("screenshareid", screenShareId);
			}
		} else if (remoteSource === "remote_audio") {
			setFlag(routedParams, "miconly");
			setFlag(routedParams, "webcam");
		} else {
			setFlag(routedParams, "webcam");
		}

		disableGuestAuxiliaryUiParams(routedParams);
	}

	function removeMcastGuestShellParams(routedParams) {
		[
			"mcastguest",
			"mcastprejoin",
			"mcastengine",
			"mcastautojoin",
			"mcastsinglelink",
			"nosettings"
		].forEach(function (key) {
			routedParams.delete(key);
		});
	}

	function removeGuestAutostartParams(routedParams) {
		[
			"autostart",
			"autojoin",
			"aj",
			"as",
			"mcastautojoin",
			"mcastrequestedautostart"
		].forEach(function (key) {
			routedParams.delete(key);
		});
	}

	function disableGuestAuxiliaryUiParams(routedParams) {
		[
			"chatbutton",
			"chat",
			"cb",
			"chatlite",
			"ssnlite",
			"socialstreamlite",
			"chatlitebutton",
			"ssnchatbutton",
			"chatliteconfig",
			"chatlitesession",
			"ssnsession",
			"chatliteprofile",
			"chatliteposition",
			"chatlitemax",
			"chatlitetransparent",
			"chatlitenoavatar",
			"chatlitehideavatar",
			"chatlitetts",
			"fileshare",
			"fs",
			"broadcasttransfer",
			"bct",
			"queuetransfer",
			"qt"
		].forEach(function (key) {
			routedParams.delete(key);
		});
		routedParams.set("chatbutton", "off");
		routedParams.set("nofileshare", "");
		routedParams.set("mcastdisableauxui", "1");
	}

	function hasGuestRoomTarget(query) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		return !!(routedParams.get("room") || routedParams.get("r"));
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
		var remoteSourceKind = normalizeRemoteSourceKind(routedParams.get("mcastremote") || "");
		var role = normalizeRouteToken(routedParams.get("mcastrole") || (currentRoute === "guest" ? "participant" : "source"), "participant");
		var state = normalizeRouteToken(routedParams.get("mcaststate") || "backstage", "backstage");
		var routing = normalizeRouteToken(routedParams.get("mcastrouting") || "low_bitrate", "low_bitrate");
		var guestName = normalizeGuestDisplayName(routedParams.get("label") || routedParams.get("l") || "");
		var nativeWebRtcRequested = currentRoute === "guest" &&
			(routedParams.has("mcastnativewebrtc") || routedParams.has("mcastnative"));
		window.MCastRoute = {
			route: currentRoute,
			inviteCode: currentRoute === "guest" ? shortCode : "",
			mode: mode,
			remoteSourceKind: remoteSourceKind,
			role: role,
			state: state,
			routing: routing,
			guestName: guestName,
			nativeWebRtcRequested: nativeWebRtcRequested
		};
		var root = document.documentElement;
		root.classList.add("mcast-route");
		root.classList.add("mcast-route-" + currentRoute);
		root.classList.add("mcast-mode-" + mode);
		if (remoteSourceKind) {
			root.classList.add("mcast-remote-" + remoteSourceKind.replace(/^remote_/, ""));
		}
		root.classList.add("mcast-role-" + role);
		root.classList.add("mcast-state-" + state);
		root.classList.add("mcast-routing-" + routing);
		if (currentRoute !== "guest" && role === "participant") {
			document.title = "MCast Studio " + toTitleCase(mode);
		}
		if (currentRoute === "guest") {
			document.title = "MCast Studio " + toTitleCase(remoteSourceKind || mode);
			if (window.MCastGuestUi && typeof window.MCastGuestUi.configureRoute === "function") {
				window.MCastGuestUi.configureRoute(window.MCastRoute);
			}
		}
	}

	function normalizeRemoteSourceKind(value) {
		var normalized = normalizeRouteToken(value, "");
		return /^(remote_camera|remote_audio|remote_screen)$/.test(normalized) ? normalized : "";
	}

	function normalizeRouteToken(value, fallback) {
		var normalized = (value || "").toString().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
		return normalized || fallback;
	}

	function isGuestInvitePath(currentPath) {
		return /^\/s(?:\/|$)/.test(currentPath || "") || currentPath === "/g/index.html";
	}

	function isCallPath(currentPath) {
		return currentPath === "/vcall" || (currentPath || "").indexOf("/vcall/") === 0;
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

		["label", "l", "defaultlabel", "labelsuggestion", "ls"].forEach(function (key) {
			routedParams.delete(key);
		});

		var name = explicitName || suggestedName;
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

	function readShortInviteCodeFromPath(currentPath) {
		var match = (currentPath || "").match(/^\/s\/([A-Za-z0-9]{6,32})\/?$/i);
		return match ? match[1] : "";
	}

	function consumePreloadedGuestRoute(code) {
		if (!/^[A-Za-z0-9]{6,32}$/.test(code || "")) {
			return "";
		}
		var payload = window.__MCastResolvedGuestRoute;
		try { delete window.__MCastResolvedGuestRoute; } catch (error) { window.__MCastResolvedGuestRoute = null; }
		if (!payload || payload.code !== code || typeof payload.query !== "string") {
			return "";
		}
		var query = payload.query.trim().replace(/^\?/, "");
		if (!query || !hasSupportedGuestExperience(query)) {
			return "";
		}
		return query;
	}

	function hasSupportedGuestExperience(query) {
		var params = new URLSearchParams(query.replace(/^\?/, ""));
		var requestedRemote = normalizeRouteToken(params.get("mcastremote") || "", "");
		return !requestedRemote || !!normalizeRemoteSourceKind(requestedRemote);
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

	function resolveStoredRoute(code, currentRoute) {
		if (currentRoute !== "call" || !/^[A-Za-z0-9]{6,32}$/.test(code || "")) {
			showInviteError("This MCast Studio invitation link is not valid.");
			return "";
		}

		try {
			var request = new XMLHttpRequest();
			request.open("GET", roomTicketResolveUrl + "?code=" + encodeURIComponent(code), false);
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

	function showInviteError(message) {
		if (route === "guest" && window.MCastGuestUi && typeof window.MCastGuestUi.showRouteError === "function") {
			window.MCastGuestUi.showRouteError(message);
			return;
		}
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

	function toTitleCase(value) {
		return (value || "").replace(/_/g, " ").replace(/\b\w/g, function (match) {
			return match.toUpperCase();
		});
	}
})();
