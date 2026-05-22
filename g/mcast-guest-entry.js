(function () {
	"use strict";

	var root;
	var state = {
		previewStarted: false,
		joining: false,
		joined: false,
		devicePoll: 0,
		tilePoll: 0,
		slowTimer: 0,
		lastError: "",
		deviceNoticeShown: false,
		lastLocalStreamDebug: "",
		roomLayoutMode: "",
		roomLayoutModeManual: false,
		orientationSwitching: false
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

	function init() {
		root = document.getElementById("mcastGuestEntry");
		if (!root) {
			return;
		}
		document.body.classList.add("mcast-custom-entry");
		document.documentElement.classList.add("mcast-custom-entry");
		disableLegacyAuxiliaryModules();
		removeLegacyBranding();
		installWarningBridge();
		wireUi();
		decorateButtons();
		initRoomLayoutMode();
		movePreviewVideo();
		fillRouteDetails();
		setStatus("Ready when you are. Preview starts only after you allow it.", "ready");
		restoreGuestName();
		state.devicePoll = window.setInterval(syncDevices, 900);
		state.tilePoll = window.setInterval(function () {
			bindLocalVideo("poll");
			syncRoomTiles();
		}, 900);
		window.addEventListener("online", function () {
			setStatus(state.joined ? "Connection restored. Rejoining if needed." : "Connection restored. You can join now.", "ready");
		});
		window.addEventListener("offline", function () {
			setStatus("You appear to be offline. Check your connection, then rejoin.", "error");
		});
		window.addEventListener("resize", updateViewportOrientationState);
		window.addEventListener("orientationchange", function () {
			updateViewportOrientationState();
			applyFootageOrientationMode(state.roomLayoutMode, { recreate: false, silent: true });
		});
	}

	function wireUi() {
		var previewButton = byId("mcastPreviewButton");
		var joinButton = byId("mcastJoinButton");
		var nameInput = byId("mcastGuestName");
		var cameraSelect = byId("mcastCameraSelect");
		var micSelect = byId("mcastMicSelect");
		var muteButton = byId("mcastMuteButton");
		var cameraButton = byId("mcastCameraButton");
		var settingsButton = byId("mcastSettingsButton");
		var orientationButton = byId("mcastOrientationButton");
		var leaveButton = byId("mcastLeaveButton");
		var roomCameraSelect = byId("mcastRoomCameraSelect");
		var roomMicSelect = byId("mcastRoomMicSelect");

		if (previewButton) {
			previewButton.addEventListener("click", function () {
				startPreview().catch(function () {});
			});
		}
		if (joinButton) {
			joinButton.addEventListener("click", function () {
				joinRoomFromCustomUi();
			});
		}
		if (nameInput) {
			nameInput.addEventListener("input", applyGuestName);
			if (window.MCastRoute && window.MCastRoute.guestName) {
				nameInput.value = window.MCastRoute.guestName;
			}
		}
		if (cameraSelect) {
			cameraSelect.addEventListener("change", function () {
				applyCameraSelection(cameraSelect.value);
				if (roomCameraSelect) {
					roomCameraSelect.value = cameraSelect.value;
				}
			});
		}
		if (micSelect) {
			micSelect.addEventListener("change", function () {
				selectNativeMic(micSelect.value);
				if (roomMicSelect) {
					roomMicSelect.value = micSelect.value;
				}
			});
		}
		if (muteButton) {
			muteButton.addEventListener("click", function (event) {
				setLoading("mcastMuteButton", true);
				if (typeof window.toggleMute === "function") {
					window.toggleMute(false, event);
				} else {
					setAudioTracksEnabled(isMicMuted());
					if (window.session) {
						window.session.muted = !isMicMuted();
					}
				}
				window.setTimeout(function () {
					setAudioTracksEnabled(!isMicMuted());
					updateControlStates();
					logLocalStreamState("mic-toggle");
					setLoading("mcastMuteButton", false);
				}, 160);
			});
		}
		if (cameraButton) {
			cameraButton.addEventListener("click", function () {
				setLoading("mcastCameraButton", true);
				if (typeof window.toggleVideoMute === "function") {
					window.toggleVideoMute();
				} else {
					setVideoTracksEnabled(isCameraOff());
					if (window.session) {
						window.session.videoMuted = !isCameraOff();
					}
				}
				window.setTimeout(function () {
					setVideoTracksEnabled(!isCameraOff());
					bindLocalVideo("camera-toggle");
					updateControlStates();
					logLocalStreamState("camera-toggle");
					setLoading("mcastCameraButton", false);
				}, 160);
			});
		}
		if (settingsButton) {
			settingsButton.addEventListener("click", toggleSettingsPanel);
		}
		if (orientationButton) {
			orientationButton.addEventListener("click", toggleRoomLayoutMode);
		}
		if (leaveButton) {
			leaveButton.addEventListener("click", leaveRoom);
		}
		if (roomCameraSelect) {
			roomCameraSelect.addEventListener("change", function () {
				applyCameraSelection(roomCameraSelect.value);
				if (cameraSelect) {
					cameraSelect.value = roomCameraSelect.value;
				}
			});
		}
		if (roomMicSelect) {
			roomMicSelect.addEventListener("change", function () {
				selectNativeMic(roomMicSelect.value);
				if (micSelect) {
					micSelect.value = roomMicSelect.value;
				}
			});
		}
	}

	function movePreviewVideo() {
		var previewSlot = byId("mcastPreviewSurface");
		var preview = byId("previewWebcam");
		if (!previewSlot || !preview) {
			return;
		}
		preview.removeAttribute("style");
		preview.setAttribute("playsinline", "");
		preview.setAttribute("autoplay", "");
		preview.muted = true;
		previewSlot.appendChild(preview);
		preview.addEventListener("loadedmetadata", markPreviewReady);
		preview.addEventListener("playing", markPreviewReady);
	}

	function decorateButtons() {
		setButtonContent(byId("mcastPreviewButton"), "camera", "Enable preview");
		setButtonContent(byId("mcastJoinButton"), "join", "Join room");
		setButtonContent(byId("mcastMuteButton"), "mic", "Mute mic");
		setButtonContent(byId("mcastCameraButton"), "video-off", "Camera off");
		setButtonContent(byId("mcastSettingsButton"), "settings", "Settings");
		setButtonContent(byId("mcastOrientationButton"), "landscape", "Landscape");
		setButtonContent(byId("mcastLeaveButton"), "leave", "Leave");
	}

	function fillRouteDetails() {
		var meta = byId("mcastInviteMeta");
		if (!meta || !window.MCastRoute) {
			return;
		}
		var mode = titleCase((window.MCastRoute.mode || "guest").replace(/_/g, " "));
		meta.textContent = mode + " invite";
	}

	async function startPreview() {
		applyGuestName();
		setLoading("mcastPreviewButton", true);
		state.deviceNoticeShown = false;
		setStatus("Requesting camera and microphone access...", "busy");
		startSlowTimer("Still waiting for browser permission. Use the camera and microphone prompt in your browser to continue.");
		try {
			applyFootageOrientationMode(state.roomLayoutMode, { recreate: false, silent: true });
			if (typeof window.previewWebcam !== "function") {
				await waitForFunction("previewWebcam", 4500);
			}
			await window.previewWebcam(false);
			await waitForPreview(9000);
			state.previewStarted = true;
			bindLocalVideo("preview-ready");
			syncDevices();
			await reportDeviceHealth();
			if (!state.lastError) {
				setStatus("Preview is ready. Check your camera and microphone, then join.", "ready");
			}
		} catch (error) {
			showPermissionError(error);
			throw error;
		} finally {
			clearSlowTimer();
			setLoading("mcastPreviewButton", false);
		}
	}

	async function joinRoomFromCustomUi() {
		if (state.joining) {
			return;
		}
		if (!validateName()) {
			return;
		}
		state.joining = true;
		setLoading("mcastJoinButton", true);
		setStatus("Preparing your room connection...", "busy");
		startSlowTimer("Still connecting. Keep this tab open while the secure room finishes joining.");
		try {
			if (!state.previewStarted) {
				await startPreview();
			}
			applyFootageOrientationMode(state.roomLayoutMode, { recreate: false, silent: true });
			applyGuestName();
			await waitForReadyButton(9000);
			var nativeButton = byId("gowebcam");
			if (typeof window.publishWebcam !== "function") {
				await waitForFunction("publishWebcam", 4500);
			}
			setStatus("Joining the MCast room...", "busy");
			bindLocalVideo("pre-publish");
			await window.publishWebcam(nativeButton || false);
			await waitForLocalStream(5000);
			state.joined = true;
			document.body.classList.add("mcast-room-active");
			root.classList.add("is-joined");
			applyRoomLayoutMode();
			setRoomView(true);
			bindLocalVideo("joined");
			setStatus("You are connected. Keep this tab open while you are on stream.", "ready");
			setRoomStatus("Connected");
			updateControlStates();
			syncRoomTiles();
		} catch (error) {
			showPermissionError(error);
		} finally {
			clearSlowTimer();
			state.joining = false;
			setLoading("mcastJoinButton", false);
		}
	}

	function applyGuestName() {
		var nameInput = byId("mcastGuestName");
		var rawName = nameInput ? nameInput.value.trim() : "";
		if (!rawName) {
			return "";
		}
		var cleanName = rawName.slice(0, 60);
		try {
			if (nameInput && rawName !== cleanName) {
				nameInput.value = cleanName;
			}
			if (window.urlParams && typeof window.urlParams.set === "function") {
				window.urlParams.set("label", cleanName);
			}
			if (window.session) {
				window.session.label = cleanName;
			}
			try {
				window.sessionStorage.setItem("mcastGuestName", cleanName);
			} catch (storageError) {}
			document.title = cleanName + " - MCast Studio";
		} catch (error) {
			console.warn("Unable to apply MCast guest name", error);
		}
		return cleanName;
	}

	function restoreGuestName() {
		var nameInput = byId("mcastGuestName");
		if (!nameInput || nameInput.value) {
			return;
		}
		try {
			var storedName = window.sessionStorage.getItem("mcastGuestName") || "";
			if (storedName) {
				nameInput.value = storedName.slice(0, 60);
				applyGuestName();
				setStatus("Welcome back. Check your preview, then rejoin when ready.", "ready");
			}
		} catch (error) {}
	}

	function validateName() {
		var name = applyGuestName();
		if (name) {
			return true;
		}
		setStatus("Enter your display name before joining.", "error");
		var nameInput = byId("mcastGuestName");
		if (nameInput) {
			nameInput.focus();
		}
		return false;
	}

	function syncDevices() {
		disableLegacyAuxiliaryModules();
		removeLegacyBranding();
		syncCameraDevices();
		syncMicDevices();
		updateControlStates();
	}

	function removeLegacyBranding() {
		[
			"info",
			"credits",
			"legal",
			"header",
			"mainmenu"
		].forEach(function (id) {
			var element = byId(id);
			if (element) {
				element.classList.add("hidden");
				element.setAttribute("aria-hidden", "true");
				element.style.display = "none";
			}
		});
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
			element.onclick = blockLegacyAuxiliaryAction;
			element.onkeyup = blockLegacyAuxiliaryAction;
		});
		["fileselector", "fileselector2", "fileselector3", "fileselector4", "fileInput"].forEach(function (id) {
			var input = byId(id);
			if (!input) {
				return;
			}
			input.disabled = true;
			input.onchange = blockLegacyAuxiliaryAction;
		});
		if (window.session) {
			window.session.mcastDisableAuxiliaryUi = true;
			window.session.chat = false;
			window.session.chatbutton = false;
			window.session.chatLiteEnabled = false;
			window.session.chatLiteButton = false;
			window.session.hostedFiles = false;
			window.session.nodownloads = true;
		}
	}

	function blockLegacyAuxiliaryAction(event) {
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		return false;
	}

	function syncCameraDevices() {
		var custom = byId("mcastCameraSelect");
		var roomCustom = byId("mcastRoomCameraSelect");
		var nativeSelect = byId("videoSourceSelect") || byId("videoSource3");
		if (!custom || !nativeSelect) {
			return;
		}
		var selected = custom.value || nativeSelect.value || "";
		var options = Array.prototype.map.call(nativeSelect.options || [], function (option) {
			return {
				value: option.value,
				text: option.textContent || option.label || "Camera"
			};
		});
		replaceOptions(custom, options, "Camera");
		custom.value = hasOption(custom, selected) ? selected : nativeSelect.value;
		if (roomCustom) {
			replaceOptions(roomCustom, options, "Camera");
			roomCustom.value = hasOption(roomCustom, custom.value) ? custom.value : roomCustom.value;
		}
	}

	function syncMicDevices() {
		var custom = byId("mcastMicSelect");
		var roomCustom = byId("mcastRoomMicSelect");
		var nativeList = byId("audioSource") || byId("audioSource3");
		if (!custom || !nativeList) {
			return;
		}
		var inputs = nativeList.querySelectorAll("input[type='checkbox']");
		var selected = custom.value || "";
		var options = Array.prototype.map.call(inputs, function (input) {
			var label = nativeList.querySelector("label[for='" + cssEscape(input.id) + "']");
			return {
				value: input.value || input.id,
				text: label ? label.textContent.trim() : input.getAttribute("data-label") || "Microphone",
				checked: input.checked
			};
		}).filter(function (item) {
			return item.value && item.text;
		});
		replaceOptions(custom, options, "Microphone");
		var active = options.filter(function (item) { return item.checked; })[0];
		custom.value = hasOption(custom, selected) ? selected : active ? active.value : custom.value;
		if (roomCustom) {
			replaceOptions(roomCustom, options, "Microphone");
			roomCustom.value = hasOption(roomCustom, custom.value) ? custom.value : roomCustom.value;
		}
	}

	function replaceOptions(select, options, fallbackLabel) {
		var signature = options.map(function (item) {
			return item.value + ":" + item.text;
		}).join("|");
		if (select.dataset.signature === signature) {
			return;
		}
		select.dataset.signature = signature;
		select.innerHTML = "";
		if (!options.length) {
			var option = document.createElement("option");
			option.value = "";
			option.textContent = fallbackLabel + " will appear after permission";
			select.appendChild(option);
			return;
		}
		options.forEach(function (item) {
			var option = document.createElement("option");
			option.value = item.value;
			option.textContent = item.text || fallbackLabel;
			select.appendChild(option);
		});
	}

	function applyCameraSelection(value) {
		var nativeSelect = byId("videoSourceSelect") || byId("videoSource3");
		if (!nativeSelect || !value) {
			setStatus("No camera is available to switch to.", "warning");
			return;
		}
		nativeSelect.value = value;
		dispatchNativeChange(nativeSelect);
		setTemporaryStatus("Switching camera...", "busy", 1200);
		window.setTimeout(function () {
			bindLocalVideo("camera-change");
			logLocalStreamState("camera-change");
		}, 900);
	}

	function selectNativeMic(value) {
		var nativeList = byId("audioSource") || byId("audioSource3");
		if (!nativeList || !value) {
			setStatus("No microphone is available to switch to.", "warning");
			return;
		}
		var inputs = nativeList.querySelectorAll("input[type='checkbox']");
		Array.prototype.forEach.call(inputs, function (input) {
			input.checked = (input.value || input.id) === value;
			dispatchNativeChange(input);
		});
		setTemporaryStatus("Switching microphone...", "busy", 1200);
		window.setTimeout(function () {
			logLocalStreamState("mic-change");
		}, 900);
	}

	function bindLocalVideo(reason) {
		var surface = byId("mcastPreviewSurface");
		if (!surface) {
			return false;
		}
		var video = getLocalVideoElement();
		var stream = getLocalStream(video);
		if (!video && stream) {
			video = document.createElement("video");
			video.id = "mcastLocalVideo";
			video.autoplay = true;
			video.playsInline = true;
			video.muted = true;
		}
		if (!video) {
			logLocalStreamState(reason || "local-bind");
			return false;
		}
		video.setAttribute("playsinline", "");
		video.setAttribute("autoplay", "");
		video.muted = true;
		video.dataset.mcastLocal = "true";
		if (stream && video.srcObject !== stream) {
			video.srcObject = stream;
		}
		if (video.parentNode !== surface) {
			surface.appendChild(video);
		}
		if (video.srcObject) {
			root.classList.add("has-preview");
			state.previewStarted = true;
			video.play().catch(function () {});
		}
		applyTileOrientation(byId("mcastLocalTile"), video, state.roomLayoutMode);
		logLocalStreamState(reason || "local-bind");
		return !!video.srcObject;
	}

	function getLocalVideoElement() {
		var sessionVideo = window.session && window.session.videoElement;
		if (sessionVideo && sessionVideo.nodeName === "VIDEO") {
			return sessionVideo;
		}
		return byId("videosource") || byId("previewWebcam") || byId("mcastLocalVideo");
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

	function waitForLocalStream(timeout) {
		return waitUntil(function () {
			return !!getLocalStream(getLocalVideoElement());
		}, timeout);
	}

	function setAudioTracksEnabled(enabled) {
		var stream = getLocalStream(getLocalVideoElement());
		if (!stream || typeof stream.getAudioTracks !== "function") {
			return;
		}
		stream.getAudioTracks().forEach(function (track) {
			track.enabled = !!enabled;
		});
	}

	function setVideoTracksEnabled(enabled) {
		var stream = getLocalStream(getLocalVideoElement());
		if (!stream || typeof stream.getVideoTracks !== "function") {
			return;
		}
		stream.getVideoTracks().forEach(function (track) {
			track.enabled = !!enabled;
		});
	}

	function syncRoomTiles() {
		var room = byId("mcastRemoteTiles");
		var waiting = byId("mcastWaitingState");
		if (!room) {
			return;
		}
		var sources = Array.prototype.filter.call(document.querySelectorAll("#gridlayout video, #directorlayout video"), function (video) {
			return video.id !== "previewWebcam" && video.id !== "videosource" && video.srcObject;
		});
		if (!sources.length && !state.joined) {
			updateRoomGridState(1, 0);
			return;
		}
		var existing = {};
		Array.prototype.forEach.call(room.querySelectorAll("[data-source-id]"), function (tile) {
			existing[tile.dataset.sourceId] = tile;
		});
		sources.forEach(function (source, index) {
			var id = source.id || source.dataset.streamid || "stream-" + index;
			var tile = existing[id] || createTile(room, id);
			var video = tile.querySelector("video");
			if (video.srcObject !== source.srcObject) {
				video.srcObject = source.srcObject;
				video.play().catch(function () {});
			}
			applyTileOrientation(tile, source, "");
			applyTileOrientation(tile, video, "");
			var label = tile.querySelector(".mcast-entry__tile-label");
			var displayName = source.getAttribute("data-label") || source.title || "Guest";
			label.textContent = displayName;
			label.title = displayName;
			delete existing[id];
		});
		Object.keys(existing).forEach(function (id) {
			existing[id].remove();
		});
		if (waiting) {
			waiting.classList.toggle("is-visible", state.joined && sources.length === 0);
		}
		updateRoomGridState(state.joined ? sources.length + 1 : 1, sources.length);
		if (state.joined) {
			setRoomStatus(sources.length ? sources.length + " remote guest" + (sources.length === 1 ? "" : "s") + " connected" : "Connected - waiting for others");
		}
	}

	function createTile(room, id) {
		var tile = document.createElement("div");
		var video = document.createElement("video");
		var label = document.createElement("div");
		tile.className = "mcast-entry__tile";
		tile.dataset.sourceId = id;
		video.autoplay = true;
		video.playsInline = true;
		video.addEventListener("loadedmetadata", function () {
			applyTileOrientation(tile, video, "");
		});
		video.addEventListener("resize", function () {
			applyTileOrientation(tile, video, "");
		});
		label.className = "mcast-entry__tile-label";
		tile.appendChild(video);
		tile.appendChild(label);
		room.appendChild(tile);
		return tile;
	}

	function updateControlStates() {
		var muteButton = byId("mcastMuteButton");
		var cameraButton = byId("mcastCameraButton");
		var settingsButton = byId("mcastSettingsButton");
		if (muteButton) {
			var muted = isMicMuted();
			muteButton.classList.toggle("is-off", muted);
			muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
			setButtonContent(muteButton, muted ? "mic-off" : "mic", muted ? "Unmute mic" : "Mute mic");
		}
		if (cameraButton) {
			var videoOff = isCameraOff();
			cameraButton.classList.toggle("is-off", videoOff);
			cameraButton.setAttribute("aria-pressed", videoOff ? "true" : "false");
			setButtonContent(cameraButton, videoOff ? "video" : "video-off", videoOff ? "Camera on" : "Camera off");
		}
		if (settingsButton) {
			var panel = byId("mcastSettingsPanel");
			var settingsOpen = !!(panel && !panel.hidden);
			settingsButton.setAttribute("aria-expanded", settingsOpen ? "true" : "false");
			setButtonContent(settingsButton, settingsOpen ? "close" : "settings", settingsOpen ? "Close" : "Settings");
		}
		updateRoomLayoutButton();
	}

	function initRoomLayoutMode() {
		var stored = "";
		var detected = getOrientationParamState();
		try {
			stored = window.sessionStorage.getItem("mcastRoomLayoutMode") || "";
		} catch (error) {}
		if (!detected.senderMode && isValidRoomLayoutMode(stored)) {
			state.roomLayoutModeManual = true;
			setRoomLayoutMode(stored, false);
		} else {
			setRoomLayoutMode(detectInitialRoomLayoutMode(), false);
		}
		applyFootageOrientationMode(state.roomLayoutMode, { recreate: false, silent: true });
		updateViewportOrientationState();
	}

	function detectInitialRoomLayoutMode() {
		var detected = getOrientationParamState();
		if (detected.senderMode) {
			return detected.senderMode;
		}
		var candidates = [
			readParam("orientation"),
			readParam("orient"),
			readParam("roomlayout"),
			readParam("layout"),
			window.session && window.session.orientation
		].map(function (value) {
			return String(value || "").toLowerCase();
		});
		if (candidates.some(function (value) { return value.indexOf("portrait") !== -1; }) || hasParam("portrait") || hasParam("forceportrait") || hasParam("forcedportrait") || hasParam("fp")) {
			return "portrait";
		}
		if (candidates.some(function (value) { return value.indexOf("landscape") !== -1; }) || hasParam("landscape") || hasParam("forcelandscape") || hasParam("forcedlandscape") || hasParam("fl")) {
			return "landscape";
		}
		return isMobileViewport() && window.matchMedia && window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
	}

	function toggleRoomLayoutMode() {
		var mode = state.roomLayoutMode === "landscape" ? "portrait" : "landscape";
		setRoomLayoutMode(mode, true);
		applyFootageOrientationMode(mode, { recreate: true, silent: false });
	}

	function setRoomLayoutMode(mode, persist) {
		if (!isValidRoomLayoutMode(mode)) {
			mode = "landscape";
		}
		state.roomLayoutMode = mode;
		state.roomLayoutModeManual = state.roomLayoutModeManual || !!persist;
		document.body.classList.toggle("mcast-room-layout-landscape", mode === "landscape");
		document.body.classList.toggle("mcast-room-layout-portrait", mode === "portrait");
		document.body.dataset.mcastRoomLayoutMode = mode;
		if (root) {
			root.dataset.roomLayoutMode = mode;
		}
		if (persist) {
			try {
				window.sessionStorage.setItem("mcastRoomLayoutMode", mode);
			} catch (error) {}
		}
		updateTileOrientations();
		updateRoomLayoutButton();
		updateViewportOrientationState();
	}

	function applyRoomLayoutMode() {
		if (!state.roomLayoutMode || !state.roomLayoutModeManual) {
			setRoomLayoutMode(detectInitialRoomLayoutMode(), false);
			return;
		}
		setRoomLayoutMode(state.roomLayoutMode, false);
	}

	function applyFootageOrientationMode(mode, options) {
		options = options || {};
		if (!isValidRoomLayoutMode(mode) || !window.session) {
			return Promise.resolve(false);
		}
		var aspect = getAspectForMode(mode);
		window.session.orientation = mode;
		window.session.forceAspectRatio = aspect;
		if (mode === "landscape") {
			window.session.aspectRatio = 0;
		} else {
			window.session.aspectRatio = 1;
		}
		updateInternalOrientationParams(mode);
		if (typeof window.updateForceRotate === "function") {
			try {
				window.updateForceRotate();
			} catch (error) {}
		}
		if (window.session && typeof window.session.setResolution === "function") {
			try {
				window.session.setResolution();
			} catch (error) {}
		}
		if (!getLocalStream(getLocalVideoElement())) {
			updateTileOrientations();
			return Promise.resolve(true);
		}
		state.orientationSwitching = true;
		setLoading("mcastOrientationButton", true);
		if (!options.silent) {
			setTemporaryStatus("Switching to " + mode + " camera mode...", "busy", 1600);
		}
		if (options.recreate && !options.silent) {
			requestScreenOrientation(mode);
		}
		var applied = Promise.resolve(false);
		if (typeof window.updateCameraConstraints === "function") {
			applied = Promise.resolve(window.updateCameraConstraints("aspectRatio", aspect, false, false, false)).then(function () {
				return true;
			}).catch(function () {
				return false;
			});
		}
		return applied.then(function (ok) {
			if (!ok && options.recreate) {
				refreshVideoDeviceForOrientation();
			}
			window.setTimeout(function () {
				if (typeof window.updateForceRotate === "function") {
					try {
						window.updateForceRotate();
					} catch (error) {}
				}
				bindLocalVideo("orientation-" + mode);
				updateTileOrientations();
				state.orientationSwitching = false;
				setLoading("mcastOrientationButton", false);
				logLocalStreamState("orientation-" + mode);
			}, options.recreate ? 900 : 120);
			return ok;
		});
	}

	function refreshVideoDeviceForOrientation() {
		var stream = getLocalStream(getLocalVideoElement());
		var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
		var settings = track && typeof track.getSettings === "function" ? track.getSettings() : {};
		if (settings && settings.deviceId && typeof window.changeVideoDeviceById === "function") {
			try {
				window.changeVideoDeviceById(settings.deviceId);
				return true;
			} catch (error) {}
		}
		var nativeSelect = byId("videoSource3") || byId("videoSourceSelect");
		if (nativeSelect && nativeSelect.value) {
			dispatchNativeChange(nativeSelect);
			return true;
		}
		return false;
	}

	function updateInternalOrientationParams(mode) {
		if (!window.urlParams) {
			return;
		}
		try {
			["forcelandscape", "forcedlandscape", "fl", "forceportrait", "forcedportrait", "fp"].forEach(function (name) {
				if (typeof window.urlParams.delete === "function") {
					window.urlParams.delete(name);
				}
			});
			if (typeof window.urlParams.set === "function") {
				window.urlParams.set(mode === "landscape" ? "forcelandscape" : "forceportrait", "");
				window.urlParams.set("aspectratio", mode === "landscape" ? "landscape" : "portrait");
			}
		} catch (error) {}
	}

	function getOrientationParamState() {
		var landscape = hasParam("forcelandscape") || hasParam("forcedlandscape") || hasParam("fl");
		var portrait = hasParam("forceportrait") || hasParam("forcedportrait") || hasParam("fp");
		var viewerLandscape = hasParam("forceviewerlandscape");
		return {
			landscape: landscape,
			portrait: portrait,
			viewerLandscape: viewerLandscape,
			senderMode: portrait ? "portrait" : (landscape ? "landscape" : "")
		};
	}

	function getAspectForMode(mode) {
		return mode === "portrait" ? 9 / 16 : 16 / 9;
	}

	function requestScreenOrientation(mode) {
		if (!screen || !screen.orientation || typeof screen.orientation.lock !== "function" || !isMobileViewport()) {
			return;
		}
		try {
			var lock = screen.orientation.lock(mode === "landscape" ? "landscape" : "portrait");
			if (lock && typeof lock.catch === "function") {
				lock.catch(function () {});
			}
		} catch (error) {}
	}

	function updateRoomLayoutButton() {
		var button = byId("mcastOrientationButton");
		if (!button) {
			return;
		}
		var nextMode = state.roomLayoutMode === "landscape" ? "portrait" : "landscape";
		var label = state.roomLayoutMode === "landscape" ? "Portrait" : "Landscape";
		button.setAttribute("aria-pressed", state.roomLayoutMode === "landscape" ? "true" : "false");
		button.title = "Switch to " + nextMode + " layout";
		setButtonContent(button, nextMode, label);
	}

	function updateViewportOrientationState() {
		var isPortraitViewport = !!(window.matchMedia && window.matchMedia("(orientation: portrait)").matches);
		document.body.classList.toggle("mcast-viewport-portrait", isPortraitViewport);
		document.body.classList.toggle("mcast-viewport-landscape", !isPortraitViewport);
		var hint = byId("mcastOrientationHint");
		var showHint = state.joined && isMobileViewport() && state.roomLayoutMode === "landscape" && isPortraitViewport;
		if (hint) {
			hint.hidden = !showHint;
		}
	}

	function updateRoomGridState(tileCount, remoteCount) {
		var grid = byId("mcastRoomGrid");
		if (!grid) {
			return;
		}
		tileCount = Math.max(1, Number(tileCount) || 1);
		remoteCount = Math.max(0, Number(remoteCount) || 0);
		grid.dataset.tileCount = String(tileCount);
		grid.dataset.remoteCount = String(remoteCount);
		grid.classList.toggle("has-remotes", remoteCount > 0);
	}

	function readParam(name) {
		if (window.urlParams && typeof window.urlParams.get === "function") {
			return window.urlParams.get(name);
		}
		try {
			return new URLSearchParams(window.location.search).get(name);
		} catch (error) {
			return "";
		}
	}

	function hasParam(name) {
		if (window.urlParams && typeof window.urlParams.has === "function" && window.urlParams.has(name)) {
			return true;
		}
		try {
			return new URLSearchParams(window.location.search).has(name);
		} catch (error) {
			return false;
		}
	}

	function isValidRoomLayoutMode(mode) {
		return mode === "landscape" || mode === "portrait";
	}

	function isMobileViewport() {
		return !!(window.matchMedia && window.matchMedia("(max-width: 920px), (pointer: coarse)").matches);
	}

	function updateTileOrientations() {
		applyTileOrientation(byId("mcastLocalTile"), getLocalVideoElement(), state.roomLayoutMode);
		Array.prototype.forEach.call(document.querySelectorAll("#mcastRemoteTiles .mcast-entry__tile"), function (tile) {
			applyTileOrientation(tile, tile.querySelector("video"), "");
		});
	}

	function applyTileOrientation(tile, video, fallbackMode) {
		if (!tile || !video) {
			return;
		}
		var aspect = getVideoDisplayAspect(video);
		var mode = isValidRoomLayoutMode(fallbackMode) ? fallbackMode : (aspect ? (aspect < 1 ? "portrait" : "landscape") : fallbackMode);
		if (!isValidRoomLayoutMode(mode)) {
			mode = "landscape";
		}
		var tileAspect = getAspectForMode(mode);
		var mismatch = !!(aspect && Math.abs(aspect - tileAspect) > 0.35);
		tile.classList.toggle("mcast-entry__tile--portrait", mode === "portrait");
		tile.classList.toggle("mcast-entry__tile--landscape", mode === "landscape");
		tile.classList.toggle("is-orientation-mismatch", mismatch);
		tile.dataset.videoOrientation = mode;
		tile.dataset.videoAspect = aspect ? String(Math.round(aspect * 1000) / 1000) : "";
	}

	function getVideoDisplayAspect(video) {
		if (!video) {
			return 0;
		}
		var aspect = parseFloat(video.dataset && video.dataset.aspectRatio) || 0;
		var width = video.videoWidth || 0;
		var height = video.videoHeight || 0;
		if (!aspect && width && height) {
			aspect = width / height;
		}
		var rotated = parseInt((video.dataset && video.dataset.rotated) || video.rotated || "0", 10) || 0;
		if (aspect && (Math.abs(rotated) % 180 === 90)) {
			aspect = 1 / aspect;
		}
		return aspect;
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

	function toggleSettingsPanel() {
		var panel = byId("mcastSettingsPanel");
		var button = byId("mcastSettingsButton");
		if (!panel) {
			return;
		}
		var nextHidden = !panel.hidden;
		panel.hidden = nextHidden;
		if (button) {
			button.classList.toggle("is-off", !nextHidden);
		}
		syncDevices();
		updateControlStates();
	}

	function leaveRoom() {
		setRoomStatus("Leaving room...");
		setStatus("Leaving the room...", "busy");
		disconnectSessionWithoutDefaultUi();
		state.joined = false;
		state.previewStarted = false;
		document.body.classList.remove("mcast-room-active");
		root.classList.remove("is-joined");
		root.classList.remove("has-preview");
		setRoomView(false);
		setRoomStatus("Not connected");
		setStatus("You left the room. Refresh this invite to join again.", "ready");
	}

	function disconnectSessionWithoutDefaultUi() {
		try {
			if (window.session && typeof window.session.sendMessage === "function") {
				window.session.sendMessage({ videoMuted: true, bye: true });
			}
		} catch (error) {}
		try {
			if (window.session && window.session.ws) {
				window.session.ws.close();
			}
		} catch (error) {}
		try {
			if (window.session && window.session.rpcs) {
				Object.keys(window.session.rpcs).forEach(function (id) {
					if (typeof window.session.closeRPC === "function") {
						window.session.closeRPC(id, true);
					}
				});
			}
		} catch (error) {}
		try {
			if (window.session && window.session.pcs) {
				Object.keys(window.session.pcs).forEach(function (id) {
					if (typeof window.session.closePC === "function") {
						window.session.closePC(id);
					}
				});
			}
		} catch (error) {}
		stopLocalTracks();
	}

	function stopLocalTracks() {
		var preview = byId("previewWebcam");
		stopStream(preview && preview.srcObject);
		if (preview) {
			preview.srcObject = null;
		}
		if (window.session) {
			stopStream(window.session.streamSrc);
			stopStream(window.session.streamSrcClone);
			stopStream(window.session.screenStream);
			stopStream(window.session.videoElement && window.session.videoElement.srcObject);
		}
	}

	function stopStream(stream) {
		if (!stream || typeof stream.getTracks !== "function") {
			return;
		}
		stream.getTracks().forEach(function (track) {
			try {
				track.stop();
			} catch (error) {}
		});
	}

	function setRoomView(isJoined) {
		var title = byId("mcastStageTitle");
		var pill = byId("mcastConnectionPill");
		var localLabel = byId("mcastLocalTileLabel");
		if (title) {
			title.textContent = isJoined ? "MCast Studio" : "Camera preview";
		}
		if (pill) {
			pill.textContent = isJoined ? "Live connection" : "Private until you join";
		}
		if (localLabel) {
			var displayName = applyGuestName() || "You";
			localLabel.textContent = displayName;
			localLabel.title = displayName;
		}
		bindLocalVideo(isJoined ? "room-view" : "preview-view");
	}

	function setRoomStatus(message) {
		var status = byId("mcastRoomStatus");
		if (status) {
			status.textContent = message;
			status.classList.toggle("is-connected", /^connected|live/i.test(message || ""));
			status.classList.toggle("is-disconnected", /not connected|leaving|offline/i.test(message || ""));
		}
	}

	function logLocalStreamState(reason) {
		var video = getLocalVideoElement();
		var stream = getLocalStream(video);
		var videoTracks = stream && stream.getVideoTracks ? stream.getVideoTracks() : [];
		var audioTracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
		var details = {
			reason: reason || "state",
			hasLocalStream: !!stream,
			videoTracksCount: videoTracks.length,
			audioTracksCount: audioTracks.length,
			videoTracksEnabled: videoTracks.map(function (track) { return !!track.enabled; }),
			audioTracksEnabled: audioTracks.map(function (track) { return !!track.enabled; }),
			videoElementAttached: !!(video && video.parentNode === byId("mcastPreviewSurface"))
		};
		var signature = JSON.stringify(details);
		if (signature === state.lastLocalStreamDebug) {
			return;
		}
		state.lastLocalStreamDebug = signature;
		console.info("MCast local stream state", details);
	}

	function installWarningBridge() {
		var originalWarnUser = window.warnUser;
		window.warnUser = function (message) {
			var cleanMessage = stripHtml(String(message || "")).trim();
			if (cleanMessage) {
				setStatus(humanizeError(cleanMessage), "error");
			}
			if (typeof originalWarnUser === "function" && !document.body.classList.contains("mcast-custom-entry")) {
				return originalWarnUser.apply(this, arguments);
			}
			console.warn("MCast guest warning:", cleanMessage);
			return false;
		};
	}

	function showPermissionError(error) {
		var message = error && (error.message || error.name) ? (error.message || error.name) : String(error || "");
		setStatus(humanizeError(message), "error");
	}

	function humanizeError(message) {
		var lower = String(message || "").toLowerCase();
		state.lastError = message;
		if (lower.indexOf("timed out") >= 0) {
			return "The browser did not finish preparing camera or microphone access. Check permissions and try again.";
		}
		if (lower.indexOf("permission") >= 0 || lower.indexOf("denied") >= 0 || lower.indexOf("notallowed") >= 0) {
			return "Camera or microphone access was blocked. Allow access in your browser, then try preview again.";
		}
		if (lower.indexOf("notfound") >= 0 || lower.indexOf("not found") >= 0 || lower.indexOf("no microphone") >= 0 || lower.indexOf("no camera") >= 0) {
			return "No camera or microphone was found. Connect a device or select another input.";
		}
		if (lower.indexOf("overconstrained") >= 0 || lower.indexOf("constraint") >= 0) {
			return "The selected device could not match the requested settings. Pick another camera or microphone.";
		}
		if (lower.indexOf("in use") >= 0 || lower.indexOf("could not start") >= 0) {
			return "Your camera or microphone may be in use by another app. Close it, then try again.";
		}
		if (!navigator.onLine) {
			return "You appear to be offline. Reconnect to the internet, then try again.";
		}
		return message || "Something went wrong while preparing your guest session. Try again.";
	}

	function setStatus(message, tone) {
		var status = byId("mcastStatus");
		if (!status) {
			return;
		}
		status.classList.remove("is-error", "is-warning", "is-busy", "is-ready");
		status.classList.add("is-" + (tone || "ready"));
		var text = status.querySelector("[data-status-text]");
		if (text) {
			text.textContent = message;
		}
	}

	function setTemporaryStatus(message, tone, delay) {
		setStatus(message, tone || "ready");
		window.setTimeout(function () {
			if (state.joined) {
				setStatus("You are connected. Keep this tab open while you are on stream.", "ready");
			} else if (state.previewStarted) {
				setStatus("Preview is ready. Check your camera and microphone, then join.", "ready");
			}
		}, delay || 1200);
	}

	function startSlowTimer(message) {
		clearSlowTimer();
		state.slowTimer = window.setTimeout(function () {
			setStatus(message, "warning");
		}, 4500);
	}

	function clearSlowTimer() {
		if (state.slowTimer) {
			window.clearTimeout(state.slowTimer);
			state.slowTimer = 0;
		}
	}

	function setLoading(id, isLoading) {
		var button = byId(id);
		if (!button) {
			return;
		}
		button.disabled = !!isLoading;
		button.classList.toggle("is-loading", !!isLoading);
	}

	function setButtonContent(button, iconName, label) {
		if (!button || (button.dataset.iconName === iconName && button.dataset.label === label)) {
			return;
		}
		button.dataset.iconName = iconName;
		button.dataset.label = label;
		button.setAttribute("aria-label", label);
		button.innerHTML = "<span class=\"mcast-entry__spinner\" aria-hidden=\"true\"></span>" + iconSvg(iconName) + "<span class=\"mcast-entry__button-label\">" + escapeHtml(label) + "</span>";
	}

	function iconSvg(name) {
		var paths = {
			camera: "<path d=\"M15 10l4.6-2.8A1 1 0 0 1 21 8.1v7.8a1 1 0 0 1-1.4.9L15 14v-4Z\"></path><rect x=\"3\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"></rect>",
			"video-off": "<path d=\"M10.7 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 1.7-.9\"></path><path d=\"M16 10l3.6-2.2A1 1 0 0 1 21 8.7v6.6\"></path><path d=\"M3 3l18 18\"></path>",
			video: "<path d=\"M15 10l4.6-2.8A1 1 0 0 1 21 8.1v7.8a1 1 0 0 1-1.4.9L15 14v-4Z\"></path><rect x=\"3\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"></rect>",
			mic: "<path d=\"M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z\"></path><path d=\"M19 11a7 7 0 0 1-14 0\"></path><path d=\"M12 18v3\"></path>",
			"mic-off": "<path d=\"M9 9v3a3 3 0 0 0 5.1 2.1\"></path><path d=\"M15 9.3V6a3 3 0 0 0-5.1-2.1\"></path><path d=\"M19 11a7 7 0 0 1-9.1 6.7\"></path><path d=\"M5 11a7 7 0 0 0 3.2 5.9\"></path><path d=\"M12 18v3\"></path><path d=\"M3 3l18 18\"></path>",
			settings: "<path d=\"M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z\"></path><path d=\"M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1a2.1 2.1 0 0 1-3 3l-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V21a2.1 2.1 0 0 1-4.2 0v-.2a1.8 1.8 0 0 0-1.2-1.7 1.8 1.8 0 0 0-2 .4l-.1.1a2.1 2.1 0 1 1-3-3l.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1.1H2a2.1 2.1 0 0 1 0-4.2h.2a1.8 1.8 0 0 0 1.7-1.2 1.8 1.8 0 0 0-.4-2l-.1-.1a2.1 2.1 0 0 1 3-3l.1.1a1.8 1.8 0 0 0 2 .4H8.6A1.8 1.8 0 0 0 9.7 2V2a2.1 2.1 0 0 1 4.2 0v.2a1.8 1.8 0 0 0 1.2 1.7 1.8 1.8 0 0 0 2-.4l.1-.1a2.1 2.1 0 1 1 3 3l-.1.1a1.8 1.8 0 0 0-.4 2v.1A1.8 1.8 0 0 0 22 9.7h0a2.1 2.1 0 0 1 0 4.2h-.2a1.8 1.8 0 0 0-1.7 1.1Z\"></path>",
			close: "<path d=\"M18 6 6 18\"></path><path d=\"m6 6 12 12\"></path>",
			leave: "<path d=\"M10 17l5-5-5-5\"></path><path d=\"M15 12H3\"></path><path d=\"M21 19V5a2 2 0 0 0-2-2h-6\"></path>",
			join: "<path d=\"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4\"></path><path d=\"M10 17l5-5-5-5\"></path><path d=\"M15 12H3\"></path>",
			landscape: "<rect x=\"3\" y=\"6\" width=\"18\" height=\"12\" rx=\"2\"></rect><path d=\"M8 21h8\"></path><path d=\"M12 18v3\"></path>",
			portrait: "<rect x=\"7\" y=\"2\" width=\"10\" height=\"20\" rx=\"2\"></rect><path d=\"M11 18h2\"></path>"
		};
		return "<svg class=\"mcast-entry__icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">" + (paths[name] || paths.settings) + "</svg>";
	}

	function escapeHtml(value) {
		return String(value || "").replace(/[&<>"']/g, function (char) {
			return {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				"\"": "&quot;",
				"'": "&#39;"
			}[char];
		});
	}

	function markPreviewReady() {
		root.classList.add("has-preview");
		state.previewStarted = true;
	}

	function waitForPreview(timeout) {
		var preview = byId("previewWebcam");
		return waitUntil(function () {
			return preview && (preview.srcObject || preview.readyState >= 2);
		}, timeout);
	}

	function waitForReadyButton(timeout) {
		var nativeButton = byId("gowebcam");
		return waitUntil(function () {
			return !nativeButton || !nativeButton.disabled || (nativeButton.dataset.ready === "true" && nativeButton.dataset.audioready === "true");
		}, timeout);
	}

	function waitForFunction(name, timeout) {
		return waitUntil(function () {
			return typeof window[name] === "function";
		}, timeout);
	}

	function waitUntil(predicate, timeout) {
		var started = Date.now();
		return new Promise(function (resolve, reject) {
			(function tick() {
				if (predicate()) {
					resolve();
					return;
				}
				if (Date.now() - started > timeout) {
					reject(new Error("Timed out waiting for media readiness"));
					return;
				}
				window.setTimeout(tick, 120);
			})();
		});
	}

	async function reportDeviceHealth() {
		if (state.deviceNoticeShown || !navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
			return;
		}
		state.deviceNoticeShown = true;
		try {
			var devices = await navigator.mediaDevices.enumerateDevices();
			var cameras = devices.filter(function (device) { return device.kind === "videoinput"; });
			var mics = devices.filter(function (device) { return device.kind === "audioinput"; });
			var preview = byId("previewWebcam");
			var stream = preview && preview.srcObject;
			var sessionStream = window.session && window.session.streamSrc;
			var hasLiveVideo = !!(stream && stream.getVideoTracks && stream.getVideoTracks().filter(isLiveTrack).length);
			var hasLiveAudio = !!(
				(stream && stream.getAudioTracks && stream.getAudioTracks().filter(isLiveTrack).length) ||
				(sessionStream && sessionStream.getAudioTracks && sessionStream.getAudioTracks().filter(isLiveTrack).length)
			);
			if (!cameras.length) {
				state.lastError = "no-camera";
				setStatus("No camera was found. You can still join if your invite allows microphone-only access.", "warning");
			} else if (!hasLiveVideo) {
				state.lastError = "camera-unavailable";
				setStatus("Camera preview is not active. Choose another camera or allow camera access.", "warning");
			} else if (!mics.length) {
				state.lastError = "no-mic";
				setStatus("No microphone was found. Connect a microphone or ask the host if camera-only is acceptable.", "warning");
			} else if (!hasLiveAudio) {
				state.lastError = "mic-unavailable";
				setStatus("Microphone is not active. Choose another microphone or allow microphone access.", "warning");
			} else {
				state.lastError = "";
			}
		} catch (error) {
			state.lastError = "";
		}
	}

	function isLiveTrack(track) {
		return track && track.readyState !== "ended";
	}

	function hasOption(select, value) {
		return Array.prototype.some.call(select.options || [], function (option) {
			return option.value === value;
		});
	}

	function dispatchNativeChange(element) {
		element.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function stripHtml(value) {
		var holder = document.createElement("div");
		holder.innerHTML = value;
		return holder.textContent || holder.innerText || "";
	}

	function titleCase(value) {
		return String(value || "").replace(/\w\S*/g, function (word) {
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		});
	}

	function cssEscape(value) {
		if (window.CSS && typeof window.CSS.escape === "function") {
			return window.CSS.escape(value);
		}
		return String(value || "").replace(/'/g, "\\'");
	}

	function byId(id) {
		return document.getElementById(id);
	}
})();
