(function () {
	"use strict";

	var root;
	var state = {
		previewStarted: false,
		joining: false,
		joined: false,
		step: "loading",
		devicePoll: 0,
		tilePoll: 0,
		meterFrame: 0,
		meterContext: null,
		meterAnalyser: null,
		lastStatus: ""
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

	function init() {
		root = byId("mcastDesktopGuest");
		if (!root || !isDesktopViewport()) {
			return;
		}
		document.body.classList.add("mcast-desktop-guest-active");
		document.documentElement.classList.add("mcast-desktop-guest-active");
		disableLegacyAuxiliaryModules();
		removeLegacyBranding();
		wireDesktopUi();
		fillDesktopRouteDetails();
		restoreGuestName();
		setStep("loading");
		setStatus("Preparing your secure guest backstage.");
		window.setTimeout(function () {
			if (!state.joined) {
				setStep("setup");
				setStatus("Check your camera and microphone before joining.");
			}
		}, 850);
		state.devicePoll = window.setInterval(syncDevices, 900);
		state.tilePoll = window.setInterval(function () {
			bindLocalVideo("poll");
			syncRoomTiles();
			updateDesktopControls();
		}, 900);
		window.addEventListener("online", function () {
			setStatus(state.joined ? "Connection restored." : "Connection restored. You can join now.");
		});
		window.addEventListener("offline", function () {
			setStatus("You appear to be offline. Check your connection, then rejoin.", true);
		});
	}

	function isDesktopViewport() {
		return !!(window.matchMedia && window.matchMedia("(min-width: 921px) and (hover: hover) and (pointer: fine)").matches);
	}

	function wireDesktopUi() {
		on("mcastDesktopPreviewButton", "click", function () {
			startPreview().catch(function () {});
		});
		on("mcastDesktopJoinButton", "click", joinRoom);
		on("mcastDesktopGuestName", "input", applyGuestName);
		on("mcastDesktopCameraSelect", "change", function (event) {
			applyCameraSelection(event.target.value);
			setSelectValue("mcastDesktopRoomCameraSelect", event.target.value);
		});
		on("mcastDesktopRoomCameraSelect", "change", function (event) {
			applyCameraSelection(event.target.value);
			setSelectValue("mcastDesktopCameraSelect", event.target.value);
		});
		on("mcastDesktopMicSelect", "change", function (event) {
			selectNativeMic(event.target.value);
			setSelectValue("mcastDesktopRoomMicSelect", event.target.value);
		});
		on("mcastDesktopRoomMicSelect", "change", function (event) {
			selectNativeMic(event.target.value);
			setSelectValue("mcastDesktopMicSelect", event.target.value);
		});
		on("mcastDesktopMicToggle", "click", toggleMute);
		on("mcastDesktopRoomMicButton", "click", toggleMute);
		on("mcastDesktopCameraToggle", "click", toggleCamera);
		on("mcastDesktopRoomCameraButton", "click", toggleCamera);
		on("mcastDesktopSettingsButton", "click", toggleSettings);
		on("mcastDesktopLeaveButton", "click", leaveRoom);
	}

	function on(id, type, handler) {
		var element = byId(id);
		if (element) {
			element.addEventListener(type, handler);
		}
	}

	function setStep(step) {
		state.step = step;
		root.dataset.step = step;
		var liveBadge = byId("mcastDesktopLiveBadge");
		if (liveBadge) {
			liveBadge.textContent = step === "live" ? "Live room" : step === "backstage" ? "Backstage" : "Setup";
		}
	}

	function fillDesktopRouteDetails() {
		var meta = byId("mcastDesktopInviteMeta");
		if (!meta || !window.MCastRoute) {
			return;
		}
		meta.textContent = titleCase((window.MCastRoute.mode || "guest").replace(/_/g, " ")) + " invite";
	}

	async function startPreview() {
		setButtonBusy("mcastDesktopPreviewButton", true, "Starting...");
		setStatus("Requesting camera and microphone access...");
		try {
			if (typeof window.previewWebcam !== "function") {
				await waitForFunction("previewWebcam", 4500);
			}
			await window.previewWebcam(false);
			await waitForPreview(9000);
			state.previewStarted = true;
			bindLocalVideo("preview-ready");
			syncDevices();
			startAudioMeter();
			setStatus("Preview is ready. Confirm your setup, then join backstage.");
		} catch (error) {
			setStatus(getPermissionMessage(error), true);
			throw error;
		} finally {
			setButtonBusy("mcastDesktopPreviewButton", false, "Enable preview");
		}
	}

	async function joinRoom() {
		if (state.joining || !validateName()) {
			return;
		}
		state.joining = true;
		setButtonBusy("mcastDesktopJoinButton", true, "Joining...");
		setStatus("Preparing your backstage connection...");
		try {
			if (!state.previewStarted) {
				await startPreview();
			}
			applyGuestName();
			await waitForReadyButton(9000);
			if (typeof window.publishWebcam !== "function") {
				await waitForFunction("publishWebcam", 4500);
			}
			bindLocalVideo("pre-publish");
			await window.publishWebcam(byId("gowebcam") || false);
			await waitForLocalStream(5000);
			state.joined = true;
			document.body.classList.add("mcast-desktop-room-active");
			root.classList.add("has-preview", "is-joined");
			setStep("backstage");
			bindLocalVideo("joined");
			setStatus("You are backstage. The host will add you to the stream shortly.");
			setRoomState("Ready backstage", "Your camera and microphone are connected.");
			syncRoomTiles();
			updateDesktopControls();
		} catch (error) {
			setStatus(getPermissionMessage(error), true);
		} finally {
			state.joining = false;
			setButtonBusy("mcastDesktopJoinButton", false, "Join backstage");
		}
	}

	function bindLocalVideo(reason) {
		var surface = state.joined ? byId("mcastDesktopLocalTile") : byId("mcastDesktopPreviewSurface");
		if (!surface) {
			return false;
		}
		var video = getLocalVideoElement();
		var stream = getLocalStream(video);
		if (!video && stream) {
			video = document.createElement("video");
			video.id = "mcastDesktopLocalVideo";
			video.autoplay = true;
			video.playsInline = true;
			video.muted = true;
		}
		if (!video) {
			return false;
		}
		video.setAttribute("playsinline", "");
		video.setAttribute("autoplay", "");
		video.muted = true;
		video.dataset.mcastDesktopLocal = "true";
		if (stream && video.srcObject !== stream) {
			video.srcObject = stream;
			logDesktop("stream acquired", summarizeStream(stream));
		}
		if (video.parentNode !== surface) {
			surface.insertBefore(video, surface.firstChild);
		}
		if (video.srcObject) {
			root.classList.add("has-preview");
			state.previewStarted = true;
			video.play().catch(function () {});
		}
		logDesktop("local video bound", {
			reason: reason || "",
			hasStream: !!video.srcObject,
			videoWidth: video.videoWidth || 0,
			videoHeight: video.videoHeight || 0
		});
		return !!video.srcObject;
	}

	function startAudioMeter() {
		var stream = getLocalStream(getLocalVideoElement());
		var meter = byId("mcastDesktopAudioMeter");
		if (!stream || !meter || state.meterAnalyser) {
			return;
		}
		var audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
		if (!audioTracks.length) {
			return;
		}
		try {
			state.meterContext = new (window.AudioContext || window.webkitAudioContext)();
			var source = state.meterContext.createMediaStreamSource(new MediaStream(audioTracks));
			state.meterAnalyser = state.meterContext.createAnalyser();
			state.meterAnalyser.fftSize = 256;
			source.connect(state.meterAnalyser);
			updateAudioMeter();
		} catch (error) {
			logDesktop("audio meter unavailable", { name: error && error.name });
		}
	}

	function updateAudioMeter() {
		var meter = byId("mcastDesktopAudioMeter");
		if (!meter || !state.meterAnalyser) {
			return;
		}
		var data = new Uint8Array(state.meterAnalyser.frequencyBinCount);
		state.meterAnalyser.getByteFrequencyData(data);
		var sum = 0;
		for (var i = 0; i < data.length; i += 1) {
			sum += data[i];
		}
		var avg = sum / Math.max(1, data.length);
		var level = avg > 68 ? 4 : avg > 42 ? 3 : avg > 20 ? 2 : avg > 6 ? 1 : 0;
		meter.dataset.level = String(level);
		state.meterFrame = window.requestAnimationFrame(updateAudioMeter);
	}

	function syncDevices() {
		disableLegacyAuxiliaryModules();
		removeLegacyBranding();
		syncCameraDevices();
		syncMicDevices();
		updateDesktopControls();
	}

	function syncCameraDevices() {
		var nativeSelect = byId("videoSourceSelect") || byId("videoSource3");
		if (!nativeSelect) {
			return;
		}
		var options = Array.prototype.map.call(nativeSelect.options || [], function (option) {
			return { value: option.value, text: option.textContent || option.label || "Camera" };
		});
		replaceOptions(byId("mcastDesktopCameraSelect"), options, "Camera");
		replaceOptions(byId("mcastDesktopRoomCameraSelect"), options, "Camera");
		setSelectValue("mcastDesktopCameraSelect", nativeSelect.value || "");
		setSelectValue("mcastDesktopRoomCameraSelect", nativeSelect.value || "");
	}

	function syncMicDevices() {
		var nativeList = byId("audioSource") || byId("audioSource3");
		if (!nativeList) {
			return;
		}
		var inputs = nativeList.querySelectorAll("input[type='checkbox']");
		var active = "";
		var options = Array.prototype.map.call(inputs, function (input) {
			if (input.checked) {
				active = input.value || input.id;
			}
			var label = nativeList.querySelector("label[for='" + cssEscape(input.id) + "']");
			return {
				value: input.value || input.id,
				text: label ? label.textContent.trim() : input.getAttribute("data-label") || "Microphone"
			};
		}).filter(function (item) { return item.value; });
		replaceOptions(byId("mcastDesktopMicSelect"), options, "Microphone");
		replaceOptions(byId("mcastDesktopRoomMicSelect"), options, "Microphone");
		setSelectValue("mcastDesktopMicSelect", active);
		setSelectValue("mcastDesktopRoomMicSelect", active);
	}

	function replaceOptions(select, options, fallbackLabel) {
		if (!select) {
			return;
		}
		var signature = options.map(function (item) { return item.value + ":" + item.text; }).join("|");
		if (select.dataset.signature === signature) {
			return;
		}
		var current = select.value;
		select.dataset.signature = signature;
		select.innerHTML = "";
		if (!options.length) {
			var placeholder = document.createElement("option");
			placeholder.value = "";
			placeholder.textContent = fallbackLabel + " will appear after permission";
			select.appendChild(placeholder);
			return;
		}
		options.forEach(function (item) {
			var option = document.createElement("option");
			option.value = item.value;
			option.textContent = item.text;
			select.appendChild(option);
		});
		if (hasOption(select, current)) {
			select.value = current;
		}
	}

	function applyCameraSelection(value) {
		var nativeSelect = byId("videoSourceSelect") || byId("videoSource3");
		if (!nativeSelect || !value) {
			setStatus("No camera is available to switch to.", true);
			return;
		}
		nativeSelect.value = value;
		dispatchNativeChange(nativeSelect);
		setStatus("Switching camera...");
		window.setTimeout(function () {
			bindLocalVideo("camera-change");
		}, 900);
	}

	function selectNativeMic(value) {
		var nativeList = byId("audioSource") || byId("audioSource3");
		if (!nativeList || !value) {
			setStatus("No microphone is available to switch to.", true);
			return;
		}
		Array.prototype.forEach.call(nativeList.querySelectorAll("input[type='checkbox']"), function (input) {
			input.checked = (input.value || input.id) === value;
			dispatchNativeChange(input);
		});
		setStatus("Switching microphone...");
	}

	function toggleMute(event) {
		if (typeof window.toggleMute === "function") {
			window.toggleMute(false, event || window.event);
		} else {
			setAudioTracksEnabled(isMicMuted());
			if (window.session) {
				window.session.muted = !isMicMuted();
			}
		}
		window.setTimeout(updateDesktopControls, 160);
	}

	function toggleCamera() {
		var stream = getLocalStream(getLocalVideoElement());
		var hasLiveVideo = !!(stream && stream.getVideoTracks && stream.getVideoTracks().some(isLiveTrack));
		if (hasLiveVideo) {
			var nextEnabled = isCameraOff();
			setVideoTracksEnabled(nextEnabled);
			if (window.session) {
				window.session.videoMuted = !nextEnabled;
			}
		} else if (typeof window.toggleVideoMute === "function") {
			window.toggleVideoMute();
		}
		window.setTimeout(updateDesktopControls, 160);
	}

	function updateDesktopControls() {
		var muted = isMicMuted();
		var cameraOff = isCameraOff();
		[
			["mcastDesktopMicToggle", muted ? "Unmute mic" : "Mute mic"],
			["mcastDesktopRoomMicButton", muted ? "Unmute" : "Mute"]
		].forEach(function (item) {
			setButtonText(item[0], item[1]);
			toggleClass(item[0], "is-off", muted);
		});
		[
			["mcastDesktopCameraToggle", cameraOff ? "Camera on" : "Camera off"],
			["mcastDesktopRoomCameraButton", cameraOff ? "Camera on" : "Camera"]
		].forEach(function (item) {
			setButtonText(item[0], item[1]);
			toggleClass(item[0], "is-off", cameraOff);
		});
		toggleClass("mcastDesktopLocalTile", "is-camera-off", cameraOff);
	}

	function syncRoomTiles() {
		var room = byId("mcastDesktopRemoteTiles");
		var grid = byId("mcastDesktopRoomGrid");
		if (!room || !grid) {
			return;
		}
		var sources = Array.prototype.filter.call(document.querySelectorAll("video"), function (video) {
			return video.id !== "previewWebcam" &&
				video.id !== "videosource" &&
				video.id !== "mcastDesktopLocalVideo" &&
				video.dataset.mcastDesktopClone !== "true" &&
				video.srcObject;
		});
		var existing = {};
		Array.prototype.forEach.call(room.querySelectorAll("[data-source-id]"), function (tile) {
			existing[tile.dataset.sourceId] = tile;
		});
		sources.forEach(function (source, index) {
			var id = source.id || source.dataset.streamid || source.srcObject.id || ("remote-" + index);
			var tile = existing[id] || createRemoteTile(id);
			var clone = tile.querySelector("video");
			if (clone.srcObject !== source.srcObject) {
				clone.srcObject = source.srcObject;
				clone.play().catch(function () {});
			}
			var label = tile.querySelector(".mcast-desktop__tile-label");
			label.textContent = source.getAttribute("data-label") || source.title || "Guest";
			delete existing[id];
		});
		Object.keys(existing).forEach(function (id) {
			existing[id].remove();
		});
		var tileCount = Math.max(1, sources.length + 1);
		grid.dataset.tileCount = String(tileCount);
		byId("mcastDesktopParticipantCount").textContent = tileCount + (tileCount === 1 ? " guest" : " guests");
		if (state.joined && sources.length > 0 && state.step !== "live") {
			setStep("live");
			setRoomState("Live room", "Guests are connected on the studio stage.");
		}
	}

	function createRemoteTile(id) {
		var tile = document.createElement("article");
		tile.className = "mcast-desktop__tile";
		tile.dataset.sourceId = id;
		var video = document.createElement("video");
		video.autoplay = true;
		video.playsInline = true;
		video.dataset.mcastDesktopClone = "true";
		var label = document.createElement("div");
		label.className = "mcast-desktop__tile-label";
		label.textContent = "Guest";
		tile.appendChild(video);
		tile.appendChild(label);
		byId("mcastDesktopRemoteTiles").appendChild(tile);
		return tile;
	}

	function applyGuestName() {
		var input = byId("mcastDesktopGuestName");
		var name = input ? input.value.trim().slice(0, 60) : "";
		if (!name) {
			return "";
		}
		if (input && input.value !== name) {
			input.value = name;
		}
		try {
			if (window.urlParams && typeof window.urlParams.set === "function") {
				window.urlParams.set("label", name);
			}
			if (window.session) {
				window.session.label = name;
			}
			window.sessionStorage.setItem("mcastGuestName", name);
			document.title = name + " - MCast Studio";
		} catch (error) {}
		return name;
	}

	function restoreGuestName() {
		var input = byId("mcastDesktopGuestName");
		if (!input || input.value) {
			return;
		}
		if (window.MCastRoute && window.MCastRoute.guestName) {
			input.value = window.MCastRoute.guestName;
			applyGuestName();
			return;
		}
		try {
			input.value = (window.sessionStorage.getItem("mcastGuestName") || "").slice(0, 60);
			applyGuestName();
		} catch (error) {}
	}

	function validateName() {
		if (applyGuestName()) {
			return true;
		}
		setStatus("Enter your display name before joining.", true);
		var input = byId("mcastDesktopGuestName");
		if (input) {
			input.focus();
		}
		return false;
	}

	function toggleSettings() {
		var panel = byId("mcastDesktopSettingsPanel");
		if (panel) {
			panel.hidden = !panel.hidden;
		}
	}

	function leaveRoom() {
		setStatus("You left the room. Refresh this invite to join again.");
		setStep("setup");
		state.joined = false;
		document.body.classList.remove("mcast-desktop-room-active");
		if (typeof window.hangup === "function") {
			window.hangup();
		}
	}

	function setStatus(message, isError) {
		var status = byId("mcastDesktopStatus");
		if (status) {
			status.textContent = message;
			status.classList.toggle("is-error", !!isError);
		}
		state.lastStatus = message;
		var loading = byId("mcastDesktopLoadingStatus");
		if (loading && state.step === "loading") {
			loading.textContent = message;
		}
	}

	function setRoomState(title, hint) {
		setText("mcastDesktopRoomState", title);
		setText("mcastDesktopRoomHint", hint);
	}

	function setButtonBusy(id, busy, label) {
		var button = byId(id);
		if (!button) {
			return;
		}
		button.disabled = !!busy;
		button.textContent = label;
	}

	function disableLegacyAuxiliaryModules() {
		[
			"chatbutton",
			"chatlitebutton",
			"sharefilebutton",
			"mediafileshare",
			"chatModule",
			"activeShares"
		].forEach(function (id) {
			var element = byId(id);
			if (!element) {
				return;
			}
			element.classList.add("hidden");
			element.setAttribute("aria-hidden", "true");
			element.style.display = "none";
			element.onclick = blockLegacyAction;
			element.onkeyup = blockLegacyAction;
		});
		["fileselector", "fileselector2", "fileselector3", "fileselector4", "fileInput"].forEach(function (id) {
			var input = byId(id);
			if (input) {
				input.disabled = true;
				input.onchange = blockLegacyAction;
			}
		});
		if (window.session) {
			window.session.mcastDisableAuxiliaryUi = true;
			window.session.chat = false;
			window.session.chatbutton = false;
			window.session.hostedFiles = false;
			window.session.nodownloads = true;
		}
	}

	function removeLegacyBranding() {
		["info", "credits", "legal", "header", "mainmenu"].forEach(function (id) {
			var element = byId(id);
			if (element) {
				element.classList.add("hidden");
				element.setAttribute("aria-hidden", "true");
				element.style.display = "none";
			}
		});
	}

	function blockLegacyAction(event) {
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		return false;
	}

	function getLocalVideoElement() {
		var sessionVideo = window.session && window.session.videoElement;
		if (sessionVideo && sessionVideo.nodeName === "VIDEO") {
			return sessionVideo;
		}
		return byId("videosource") || byId("previewWebcam") || byId("mcastDesktopLocalVideo");
	}

	function getLocalStream(video) {
		var candidates = [
			video && video.srcObject,
			window.session && window.session.streamSrc,
			window.session && window.session.videoElement && window.session.videoElement.srcObject,
			byId("previewWebcam") && byId("previewWebcam").srcObject,
			window.session && window.session.streamSrcClone
		];
		for (var i = 0; i < candidates.length; i += 1) {
			if (isUsableStream(candidates[i])) {
				return candidates[i];
			}
		}
		return null;
	}

	function isUsableStream(stream) {
		return !!(stream && typeof stream.getTracks === "function" && stream.getTracks().some(isLiveTrack));
	}

	function isLiveTrack(track) {
		return !!track && track.readyState !== "ended";
	}

	function isMicMuted() {
		if (window.session && typeof window.session.muted !== "undefined") {
			return !!window.session.muted;
		}
		var stream = getLocalStream(getLocalVideoElement());
		var tracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
		return !!(tracks.length && tracks.every(function (track) { return !track.enabled; }));
	}

	function isCameraOff() {
		if (window.session && typeof window.session.videoMuted !== "undefined") {
			return !!window.session.videoMuted;
		}
		var stream = getLocalStream(getLocalVideoElement());
		var tracks = stream && stream.getVideoTracks ? stream.getVideoTracks() : [];
		return !!(tracks.length && tracks.every(function (track) { return !track.enabled; }));
	}

	function setAudioTracksEnabled(enabled) {
		var stream = getLocalStream(getLocalVideoElement());
		if (stream && stream.getAudioTracks) {
			stream.getAudioTracks().forEach(function (track) {
				track.enabled = !!enabled;
			});
		}
	}

	function setVideoTracksEnabled(enabled) {
		var stream = getLocalStream(getLocalVideoElement());
		if (stream && stream.getVideoTracks) {
			stream.getVideoTracks().forEach(function (track) {
				track.enabled = !!enabled;
			});
		}
	}

	function waitForLocalStream(timeout) {
		return waitUntil(function () {
			return !!getLocalStream(getLocalVideoElement());
		}, timeout);
	}

	function waitForPreview(timeout) {
		return waitUntil(function () {
			var video = getLocalVideoElement();
			return !!(video && (video.srcObject || video.readyState >= 2));
		}, timeout);
	}

	function waitForReadyButton(timeout) {
		return waitUntil(function () {
			return byId("gowebcam") || typeof window.publishWebcam === "function";
		}, timeout);
	}

	function waitForFunction(name, timeout) {
		return waitUntil(function () {
			return typeof window[name] === "function";
		}, timeout);
	}

	function waitUntil(test, timeout) {
		var start = Date.now();
		return new Promise(function (resolve, reject) {
			(function tick() {
				try {
					if (test()) {
						resolve(true);
						return;
					}
				} catch (error) {}
				if (Date.now() - start >= timeout) {
					reject(new Error("Timed out waiting for studio engine."));
					return;
				}
				window.setTimeout(tick, 100);
			}());
		});
	}

	function dispatchNativeChange(element) {
		element.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function hasOption(select, value) {
		return !!(select && Array.prototype.some.call(select.options || [], function (option) {
			return option.value === value;
		}));
	}

	function setSelectValue(id, value) {
		var select = byId(id);
		if (select && hasOption(select, value)) {
			select.value = value;
		}
	}

	function setText(id, text) {
		var element = byId(id);
		if (element) {
			element.textContent = text;
		}
	}

	function setButtonText(id, text) {
		setText(id, text);
	}

	function toggleClass(id, className, enabled) {
		var element = byId(id);
		if (element) {
			element.classList.toggle(className, !!enabled);
		}
	}

	function getPermissionMessage(error) {
		if (!error) {
			return "Unable to access camera or microphone.";
		}
		if (error.name === "NotAllowedError" || error.name === "SecurityError") {
			return "Camera or microphone permission was blocked. Allow access in the browser prompt, then try again.";
		}
		if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
			return "No matching camera or microphone was found. Check your device settings.";
		}
		return error.message || "Unable to access camera or microphone.";
	}

	function summarizeStream(stream) {
		return {
			hasStream: !!stream,
			videoTracks: stream && stream.getVideoTracks ? stream.getVideoTracks().length : 0,
			audioTracks: stream && stream.getAudioTracks ? stream.getAudioTracks().length : 0
		};
	}

	function logDesktop(message, details) {
		try {
			console.info("[MCast desktop guest]", message, details || {});
		} catch (error) {}
	}

	function cssEscape(value) {
		if (window.CSS && typeof window.CSS.escape === "function") {
			return window.CSS.escape(value);
		}
		return String(value || "").replace(/'/g, "\\'");
	}

	function titleCase(value) {
		return String(value || "").replace(/\b\w/g, function (letter) {
			return letter.toUpperCase();
		});
	}

	function byId(id) {
		return document.getElementById(id);
	}
}());
