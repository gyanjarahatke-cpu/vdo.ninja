(function () {
	"use strict";

	var shortInviteResolveUrl = "https://mcast-studio.web.app/api/vdoShortInviteResolve";
	var tokenResolveUrl = "https://mcast-studio.web.app/api/vdoTokenResolve";
	var roomTicketResolveUrl = "https://mcast-studio.web.app/api/vdoRoomTicketResolve";
	var rawPath = (window.location.pathname || "").replace(/\/+$/, "");
	var path = rawPath.toLowerCase();
	var route = path === "/g" || path.indexOf("/g/") === 0 ? "guest" : path.endsWith("/vcall") ? "call" : "";
	if (!route) {
		return;
	}

	document.documentElement.classList.add("mcast-route");
	document.documentElement.classList.add(route === "guest" ? "mcast-guest" : "mcast-vcall");

	if (route === "guest") {
		var style = document.createElement("style");
		style.textContent = [
			"html.mcast-guest,html.mcast-guest body{background:#0b0f16!important;}",
			"html.mcast-guest #header,html.mcast-guest #mainmenu,html.mcast-guest #head1,html.mcast-guest #head1a,html.mcast-guest #head3,html.mcast-guest #head3a,html.mcast-guest #dropButton,html.mcast-guest #container-1,html.mcast-guest #container-2,html.mcast-guest #container-4,html.mcast-guest #container-5,html.mcast-guest #container-6,html.mcast-guest #container-7,html.mcast-guest #container-8,html.mcast-guest #container-9,html.mcast-guest #credits,html.mcast-guest #legal{display:none!important;}",
			"html.mcast-guest #mcastJoining{position:fixed;inset:0;display:grid;place-items:center;color:#d7e3f3;font:500 16px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:0;text-align:center;padding:24px;z-index:1;pointer-events:none;}",
			"html.mcast-guest .prompt,html.mcast-guest [role='dialog'],html.mcast-guest .modal,html.mcast-guest #passwordPrompt{z-index:10000!important;}"
		].join("");
		document.head.appendChild(style);
		document.addEventListener("DOMContentLoaded", function () {
			if (document.getElementById("mcastJoining")) {
				startGuestJoinStatusMonitor();
				return;
			}
			var status = document.createElement("div");
			status.id = "mcastJoining";
			status.setAttribute("aria-live", "polite");
			status.textContent = "Joining secure MCast Studio room...";
			document.body.appendChild(status);
			startGuestJoinStatusMonitor();
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
	if (typeof session !== "undefined") {
		session.decrypted = "?" + decoded.replace(/^\?/, "");
		session.nohistory = true;
	}

	function applyRouteDefaults(query, currentRoute) {
		var routedParams = new URLSearchParams(query.replace(/^\?/, ""));
		if (currentRoute === "guest") {
			setFlag(routedParams, "webcam");
			setFlag(routedParams, "autostart");
			setFlag(routedParams, "nosettings");
			setFlag(routedParams, "mcastguest");
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
				routedParams.set("quality", "0");
			}
		}
		return serializeParams(routedParams);
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

	function readShortInviteCodeFromPath(currentPath) {
		var match = (currentPath || "").match(/^\/g\/([A-Za-z0-9]{6,16})\/?$/);
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
			if (removeGuestJoinStatusIfReady() || Date.now() - startedAt > 60000) {
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
