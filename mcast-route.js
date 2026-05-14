(function () {
	"use strict";

	var tokenPassphrase = "MCastStudio.VdoToken.v1.c7f1e4d2a0b84a53b9d6e2084f39a721";
	var path = (window.location.pathname || "").replace(/\/+$/, "").toLowerCase();
	var route = path.endsWith("/g") ? "guest" : path.endsWith("/vcall") ? "call" : "";
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
	if (token) {
		decoded = decryptToken(token);
	} else if (search.length > 1) {
		decoded = search.substring(1);
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

	function decryptToken(tokenValue) {
		try {
			var payload = tokenValue.indexOf("v1.") === 0 ? tokenValue.substring(3) : tokenValue;
			payload = fromBase64Url(payload);
			var bytes = CryptoJS.AES.decrypt(payload, tokenPassphrase);
			var text = bytes.toString(CryptoJS.enc.Utf8);
			if (!text) {
				throw new Error("empty token payload");
			}
			return text.replace(/^\?/, "");
		} catch (error) {
			console.error("MCast token decode failed", error);
			document.addEventListener("DOMContentLoaded", function () {
				document.body.innerHTML = "<div style=\"display:grid;place-items:center;min-height:100vh;background:#0b0f16;color:#f8d7da;font:500 16px system-ui;text-align:center;padding:24px;\">This MCast Studio invitation link is not valid.</div>";
			});
			return "";
		}
	}

	function fromBase64Url(value) {
		var base64 = value.replace(/-/g, "+").replace(/_/g, "/");
		while (base64.length % 4) {
			base64 += "=";
		}
		return base64;
	}
})();
