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

	installDirectorControlBridge();

	if (route === "call") {
		document.documentElement.classList.add("mcast-route");
		document.documentElement.classList.add("mcast-vcall");
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
		if (!hasGuestRoomTarget(decoded)) {
			showInviteError("This MCast Studio room link is missing or has expired.");
			return;
		}
		persistResolvedGuestRoute(decoded);
		if (!token && !shortCode) {
			persistResolvedGuestRouteInLocation(decoded);
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
			var shouldAutostart = routedParams.has("mcastautojoin");
			setFlag(routedParams, "webcam");
			removeMcastGuestShellParams(routedParams);
			cleanEmptyNativeDeviceParams(routedParams);
			normalizeGuestNameParams(routedParams);

			if (!routedParams.has("push") && (mode === "meeting" || mode === "classroom" || mode === "webinar")) {
				routedParams.set("push", getOrCreateSingleLinkGuestPush(routedParams));
			}
			if (shouldAutostart) {
				setFlag(routedParams, "autostart");
			}
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
		var role = normalizeRouteToken(routedParams.get("mcastrole") || (currentRoute === "guest" ? "participant" : "source"), "participant");
		var state = normalizeRouteToken(routedParams.get("mcaststate") || "backstage", "backstage");
		var routing = normalizeRouteToken(routedParams.get("mcastrouting") || "low_bitrate", "low_bitrate");
		var guestName = normalizeGuestDisplayName(routedParams.get("label") || routedParams.get("l") || "");
		window.MCastRoute = {
			route: currentRoute,
			mode: mode,
			role: role,
			state: state,
			routing: routing,
			guestName: guestName
		};
		if (currentRoute !== "guest") {
			var root = document.documentElement;
			root.classList.add("mcast-mode-" + mode);
			root.classList.add("mcast-role-" + role);
			root.classList.add("mcast-state-" + state);
			root.classList.add("mcast-routing-" + routing);
		}
		if (currentRoute !== "guest" && role === "participant") {
			document.title = "MCast Studio " + toTitleCase(mode);
		}
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
			["t", "token", "s", "code"].forEach(function (key) {
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

	function toTitleCase(value) {
		return (value || "").replace(/_/g, " ").replace(/\b\w/g, function (match) {
			return match.toUpperCase();
		});
	}
})();
