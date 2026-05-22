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
		deviceNoticeShown: false
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
		movePreviewVideo();
		fillRouteDetails();
		setStatus("Ready when you are. Preview starts only after you allow it.", "ready");
		restoreGuestName();
		state.devicePoll = window.setInterval(syncDevices, 900);
		state.tilePoll = window.setInterval(syncRoomTiles, 1400);
		window.addEventListener("online", function () {
			setStatus(state.joined ? "Connection restored. Rejoining if needed." : "Connection restored. You can join now.", "ready");
		});
		window.addEventListener("offline", function () {
			setStatus("You appear to be offline. Check your connection, then rejoin.", "error");
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
				if (typeof window.toggleMute === "function") {
					window.toggleMute(false, event);
				}
				window.setTimeout(updateControlStates, 120);
			});
		}
		if (cameraButton) {
			cameraButton.addEventListener("click", function () {
				if (typeof window.toggleVideoMute === "function") {
					window.toggleVideoMute();
				}
				window.setTimeout(updateControlStates, 120);
			});
		}
		if (settingsButton) {
			settingsButton.addEventListener("click", toggleSettingsPanel);
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
			if (typeof window.previewWebcam !== "function") {
				await waitForFunction("previewWebcam", 4500);
			}
			await window.previewWebcam(false);
			await waitForPreview(9000);
			state.previewStarted = true;
			markPreviewReady();
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
			applyGuestName();
			await waitForReadyButton(9000);
			var nativeButton = byId("gowebcam");
			if (typeof window.publishWebcam !== "function") {
				await waitForFunction("publishWebcam", 4500);
			}
			setStatus("Joining the MCast room...", "busy");
			await window.publishWebcam(nativeButton || false);
			state.joined = true;
			document.body.classList.add("mcast-room-active");
			root.classList.add("is-joined");
			setRoomView(true);
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
		label.className = "mcast-entry__tile-label";
		tile.appendChild(video);
		tile.appendChild(label);
		room.appendChild(tile);
		return tile;
	}

	function updateControlStates() {
		var muteButton = byId("mcastMuteButton");
		var cameraButton = byId("mcastCameraButton");
		if (muteButton && window.session) {
			var muted = !!window.session.muted;
			muteButton.classList.toggle("is-off", muted);
			muteButton.textContent = muted ? "Unmute mic" : "Mute mic";
		}
		if (cameraButton && window.session) {
			var videoOff = !!window.session.videoMuted;
			cameraButton.classList.toggle("is-off", videoOff);
			cameraButton.textContent = videoOff ? "Camera on" : "Camera off";
		}
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
			button.textContent = nextHidden ? "Settings" : "Close settings";
		}
		syncDevices();
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
			title.textContent = isJoined ? "MCast room" : "Camera preview";
		}
		if (pill) {
			pill.textContent = isJoined ? "Live connection" : "Private until you join";
		}
		if (localLabel) {
			var displayName = applyGuestName() || "You";
			localLabel.textContent = displayName;
			localLabel.title = displayName;
		}
	}

	function setRoomStatus(message) {
		var status = byId("mcastRoomStatus");
		if (status) {
			status.textContent = message;
		}
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
