(function () {
	"use strict";

	var root;
	var state = {
		step: "permission",
		previewStarted: false,
		joining: false,
		joined: false,
		experience: null,
		capabilities: { camera: true, microphone: true, screen: false, displayName: true },
		devicePoll: 0,
		videoPoll: 0,
		meterFrame: 0,
		meterContext: null,
		meterAnalyser: null,
		meterSource: null,
		correctionTimer: 0,
		lastCorrectionLog: "",
		screenTrack: null,
		nativeReturnConnected: false,
		boundLocalVideo: null,
		boundLocalStream: null,
		boundLocalSurface: null
	};

	var icons = {
		mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z"/><path d="M19 10a7 7 0 0 1-14 0"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>',
		camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 10l5-3v10l-5-3v3H4V7h11v3Z"/></svg>',
		settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 1 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 3.8 14.7 1.8 1.8 0 0 0 2.15 13H2a2.1 2.1 0 0 1 0-4.2h.15A1.8 1.8 0 0 0 3.8 7.7a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 1 1 6.37 2.7l.04.04a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 9.5 1.45V1.4a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 1 1 2.97 2.97l-.04.04a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15Z"/></svg>',
		more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/><path d="M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/><path d="M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>',
		leave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg>'
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

	function init() {
		root = byId("mcastMobileGuest");
		if (!root || !isMobileGuestViewport()) {
			return;
		}
		document.body.classList.add("mcast-mobile-guest-active");
		document.documentElement.classList.add("mcast-mobile-guest-active");
		clearForcedBodyRotation();
		configureExperience();
		disableLegacyAuxiliaryModules();
		removeLegacyBranding();
		decorateButtons();
		installNativeGuestControls();
		wireUi();
		restoreGuestName();
		fillRoomName();
		setStep("permission");
		state.devicePoll = window.setInterval(function () {
			disableLegacyAuxiliaryModules();
			removeLegacyBranding();
			syncDevices();
			updateControls();
		}, 900);
		state.videoPoll = window.setInterval(function () {
			if (state.previewStarted || state.joined) {
				bindLocalVideo(state.joined ? "poll-room" : "poll-setup");
			}
		}, 1000);
		window.addEventListener("resize", scheduleVideoCorrection, { passive: true });
		window.addEventListener("orientationchange", scheduleVideoCorrection, { passive: true });
		window.addEventListener("online", function () {
			showStatus(state.joined ? "Connection restored." : "Connection restored. You can continue.");
		});
		window.addEventListener("offline", function () {
			showStatus("You appear to be offline. Check your connection and try again.", true);
		});
		window.addEventListener("mcast:open-settings", openSettings);
		logMobile("mobile app initialized", getViewportDebug());
	}

	function configureExperience() {
		state.experience = window.MCastGuestUi && typeof window.MCastGuestUi.getExperience === "function"
			? window.MCastGuestUi.getExperience()
			: {
				kind: "guest",
				capabilities: state.capabilities,
				permissionTitle: "Set up your camera and microphone",
				permissionMessage: "You’ll be able to check your video and audio in the next step.",
				permissionAction: "Allow camera and microphone",
				setupTitle: "Let’s set up your studio",
				setupMessage: "Entering the studio will not automatically start the broadcast.",
				previewLabel: "Camera preview",
				primaryAction: "Enter studio",
				connectedTitle: "You’re backstage",
				connectedMessage: "The host can bring you on screen when ready."
			};
		state.capabilities = state.experience.capabilities || state.capabilities;
		root.dataset.experience = state.experience.kind;
		root.classList.toggle("is-audio-only", state.experience.kind === "remote_audio");
		root.classList.toggle("is-screen-only", state.experience.kind === "remote_screen");
		var settingsPanel = byId("mcastMobileSettingsPanel");
		if (settingsPanel && settingsPanel.parentNode !== root) { root.appendChild(settingsPanel); }
		setText("mcastMobilePermissionTitle", state.experience.permissionTitle);
		setText("mcastMobilePermissionMessage", state.experience.permissionMessage);
		setText("mcastMobilePermissionLead", "To continue");
		setText("mcastMobileSetupTitle", state.experience.setupTitle);
		setText("mcastMobileSetupMessage", state.experience.setupMessage);
		setText("mcastMobilePreviewLabel", state.experience.previewLabel);
		setText("mcastMobileInfo", state.experience.kind === "guest"
			? "You will enter as a guest. The host can bring you on screen at any time."
			: state.experience.connectedMessage);
		setButtonText("mcastMobileAllowButton", state.experience.permissionAction);
		setButtonText("mcastMobileEnterButton", state.experience.primaryAction);
		setHidden("mcastMobileGuestNameField", !state.capabilities.displayName);
		setHidden("mcastMobileCameraField", !state.capabilities.camera);
		setHidden("mcastMobileMicField", !state.capabilities.microphone);
		setHidden("mcastMobileSpeakerField", state.experience.kind !== "guest");
		setHidden("mcastMobileAudioOptions", !state.capabilities.microphone);
		setHidden("mcastMobileScreenOptions", !state.capabilities.screen);
		setHidden("mcastMobileMicPanel", !state.capabilities.microphone);
		setHidden("mcastMobileSetupMicButton", !state.capabilities.microphone);
		setHidden("mcastMobileSetupCameraButton", !state.capabilities.camera);
		setHidden("mcastMobileRoomMicButton", !state.capabilities.microphone);
		setHidden("mcastMobileRoomCameraButton", !state.capabilities.camera);
		setHidden("mcastMobileTerms", state.experience.kind !== "guest");
		if (!state.capabilities.displayName) {
			var input = byId("mcastMobileGuestName");
			if (input && !input.value) { input.value = routeSourceLabel(); }
		}
		initializeProcessingOptions();
	}

	function clearForcedBodyRotation() {
		if (!document.body) {
			return;
		}
		document.body.style.transform = "";
		document.body.style.position = "";
		document.body.style.top = "";
		document.body.style.left = "";
		document.body.style.height = "";
		document.body.style.width = "";
		document.body.style.transformOrigin = "";
		document.body.dataset.rotated = "";
	}

	function isMobileGuestViewport() {
		return !!(window.matchMedia && window.matchMedia("(max-width: 920px), (hover: none), (pointer: coarse)").matches);
	}

	function wireUi() {
		on("mcastMobileAllowButton", "click", function () {
			if (state.capabilities.screen) {
				joinRoom();
			} else {
				startPreview().catch(function () {});
			}
		});
		on("mcastMobileEnterButton", "click", joinRoom);
		on("mcastMobileGuestName", "input", applyGuestName);
		on("mcastMobileSetupMicButton", "click", toggleMute);
		on("mcastMobileRoomMicButton", "click", toggleMute);
		on("mcastMobileSetupCameraButton", "click", toggleCamera);
		on("mcastMobileRoomCameraButton", "click", toggleCamera);
		on("mcastMobileSetupSettingsButton", "click", toggleSettings);
		on("mcastMobileMoreButton", "click", toggleSettings);
		on("mcastMobileSettingsClose", "click", closeSettings);
		on("mcastMobileLeaveButton", "click", leaveRoom);
		on("mcastMobileCameraSelect", "change", function (event) {
			applyCameraSelection(event.target.value);
		});
		on("mcastMobileMicSelect", "change", function (event) {
			selectNativeMic(event.target.value);
		});
		on("mcastMobileSpeakerSelect", "change", function (event) { selectNativeSpeaker(event.target.value); });
		on("mcastMobileEchoCancel", "change", applyAudioProcessing);
		on("mcastMobileNoiseSuppress", "change", applyAudioProcessing);
		on("mcastMobileAutoGain", "change", applyAudioProcessing);
		on("mcastMobileScreenAudio", "change", applyScreenAudioPreference);
	}

	function on(id, type, handler) {
		var element = byId(id);
		if (element) {
			element.addEventListener(type, handler);
		}
	}

	function startNativeWebRtcBridge() {
		if (!window.MCastNativeWebRtcBridge ||
			typeof window.MCastNativeWebRtcBridge.start !== "function" ||
			!window.MCastNativeWebRtcBridge.isRequested()) {
			return;
		}

		window.MCastNativeWebRtcBridge.start({
			getLocalStream: function () {
				return getLocalStream(getLocalVideoElement());
			},
			log: logMobile,
			onRemoteStream: bindNativeReturnStream,
			onState: function (stage) {
				if (stage === "media-attached") {
					showStatus("Native studio connection is starting.");
				}
			}
		});
	}

	function setStep(step) {
		state.step = step;
		root.dataset.step = step;
		document.body.classList.toggle("mcast-mobile-room-active", step === "backstage");
	}

	async function startPreview() {
		if (state.capabilities.screen) {
			return joinScreenShare();
		}
		if (state.previewStarted) {
			setStep("setup");
			bindLocalVideo("preview-existing");
			return;
		}
		setButtonBusy("mcastMobileAllowButton", true, state.capabilities.camera ? "Opening devices..." : "Opening microphone...");
		setStatus(state.capabilities.camera
			? "Requesting camera and microphone access..."
			: "Requesting microphone access...");
		try {
			if (typeof window.previewWebcam !== "function") {
				await waitForFunction("previewWebcam", 4500);
			}
			await window.previewWebcam(false);
			await waitForLocalMedia(9000);
			state.previewStarted = true;
			root.classList.add("has-preview");
			setStep("setup");
			setStatus("");
			bindLocalVideo("permission-granted");
			syncDevices();
			startAudioMeter();
			showStatus(state.experience.kind === "remote_audio" ? "Microphone is ready." : "Camera and microphone are ready.");
		} catch (error) {
			setStatus(getPermissionMessage(error), true);
			logMobile("getUserMedia error", { name: error && error.name });
			showMediaRecovery(error, startPreview);
			throw error;
		} finally {
			setButtonBusy("mcastMobileAllowButton", false, state.experience.permissionAction);
		}
	}

	async function joinRoom() {
		if (state.capabilities.screen) {
			return joinScreenShare();
		}
		if (state.joining || (state.capabilities.displayName && !validateName())) {
			return;
		}
		state.joining = true;
		setButtonBusy("mcastMobileEnterButton", true, "Connecting...");
		setStatus("Preparing the secure connection...");
		try {
			if (!state.previewStarted) {
				await startPreview();
			}
			if (state.capabilities.displayName) { applyGuestName(); }
			bindLocalVideo("pre-publish");
			if (typeof window.publishWebcam !== "function") {
				await waitForFunction("publishWebcam", 4500);
			}
			await waitForReadyButton(9000);
			await window.publishWebcam(byId("gowebcam") || false);
			await waitForLocalStream(6000);
			state.joined = true;
			setStep("backstage");
			bindLocalVideo("joined");
			updateControls();
			startNativeWebRtcBridge();
			showToast(connectedNotice());
			logMobile("joined backstage", summarizeStream(getLocalStream(getLocalVideoElement())));
		} catch (error) {
			setStatus(getPermissionMessage(error), true);
			logMobile("join error", { name: error && error.name });
			showMediaRecovery(error, joinRoom);
		} finally {
			state.joining = false;
			setButtonBusy("mcastMobileEnterButton", false, state.experience.primaryAction);
		}
	}

	async function joinScreenShare() {
		if (state.joining || state.joined) {
			return;
		}
		state.joining = true;
		setButtonBusy("mcastMobileAllowButton", true, "Choose a screen...");
		setButtonBusy("mcastMobileEnterButton", true, "Choose a screen...");
		setStatus("Choose a screen, window, or browser tab in the system prompt.");
		applyScreenAudioPreference();
		try {
			if (typeof window.publishScreen !== "function") {
				await waitForFunction("publishScreen", 6000);
			}
			await window.publishScreen();
			if (!getScreenStream()) {
				var selectionError = new Error("Screen selection was not completed");
				selectionError.name = "NotAllowedError";
				throw selectionError;
			}
			await waitForScreenStream(4000);
			state.previewStarted = true;
			state.joined = true;
			root.classList.add("has-preview", "is-joined");
			bindLocalVideo("screen-connected");
			watchScreenShareEnded();
			setStep("backstage");
			showToast(connectedNotice());
		} catch (error) {
			setStatus(getPermissionMessage(error), true);
			showMediaRecovery(error, joinScreenShare);
		} finally {
			state.joining = false;
			setButtonBusy("mcastMobileAllowButton", false, state.experience.permissionAction);
			setButtonBusy("mcastMobileEnterButton", false, state.experience.primaryAction);
		}
	}

	function bindLocalVideo(reason) {
		var surface = state.joined ? byId("mcastMobileSelfPreview") : byId("mcastMobileSetupPreview");
		if (!surface) {
			return false;
		}
		var video = state.capabilities.screen ? getScreenVideoElement() : getLocalVideoElement();
		var stream = state.capabilities.screen ? getScreenStream() : getLocalStream(video);
		var hasVideo = !!(stream && stream.getVideoTracks && stream.getVideoTracks().some(isLiveTrack));
		if (!video && stream && hasVideo) {
			video = document.createElement("video");
			video.id = state.capabilities.screen ? "mcastMobileScreenVideo" : "mcastMobileLocalVideo";
			video.autoplay = true;
			video.playsInline = true;
			video.muted = true;
			video.srcObject = stream;
		}
		if (!video) {
			if (stream && state.experience.kind === "remote_audio") {
				root.classList.add("has-preview");
				state.previewStarted = true;
				return true;
			}
			return false;
		}
		if (
			state.boundLocalVideo === video &&
			state.boundLocalStream === stream &&
			state.boundLocalSurface === surface &&
			video.parentNode === surface &&
			video.srcObject === stream
		) {
			setSelfName();
			ensureNameLabelOnTop(surface);
			return !!stream;
		}
		video.setAttribute("playsinline", "");
		video.setAttribute("autoplay", "");
		video.muted = true;
		video.dataset.mcastMobileLocal = "true";
		if (state.capabilities.screen) { video.dataset.mcastScreenShare = "true"; }
		if (stream && video.srcObject !== stream) {
			video.srcObject = stream;
			logMobile("stream acquired", summarizeStream(stream));
		}
		if (!video.dataset.mcastMobileListeners) {
			video.dataset.mcastMobileListeners = "true";
			video.addEventListener("loadedmetadata", function () {
				logMobile("video loadedmetadata", getVideoDebug(video));
				scheduleVideoCorrection();
				video.play().catch(function () {});
			});
			video.addEventListener("playing", function () {
				logMobile("video playing", getVideoDebug(video));
			});
			video.addEventListener("resize", scheduleVideoCorrection);
		}
		if (video.parentNode !== surface) {
			surface.insertBefore(video, surface.firstChild);
		}
		state.boundLocalVideo = video;
		state.boundLocalStream = stream;
		state.boundLocalSurface = surface;
		if (video.srcObject) {
			root.classList.add("has-preview");
			state.previewStarted = true;
			video.play().catch(function () {});
		}
		setSelfName();
		ensureNameLabelOnTop(surface);
		scheduleVideoCorrection();
		logMobile("local video bound", {
			reason: reason || "",
			hasStream: !!video.srcObject,
			videoTracks: stream && stream.getVideoTracks ? stream.getVideoTracks().length : 0,
			audioTracks: stream && stream.getAudioTracks ? stream.getAudioTracks().length : 0
		});
		return !!video.srcObject;
	}

	function bindNativeReturnStream(uuid, stream) {
		var stage = root && root.querySelector(".mcast-mobile__stage-card");
		if (!stage || !stream) {
			return false;
		}

		var video = byId("mcastMobileNativeReturnVideo");
		if (!video) {
			video = document.createElement("video");
			video.id = "mcastMobileNativeReturnVideo";
			video.autoplay = true;
			video.playsInline = true;
			video.controls = false;
			video.dataset.mcastNativeReturn = "true";
			video.dataset.label = "Host feed";
		}
		video.setAttribute("playsinline", "");
		video.setAttribute("autoplay", "");
		video.muted = false;
		if (video.srcObject !== stream) {
			video.srcObject = stream;
		}
		if (video.parentNode !== stage) {
			stage.insertBefore(video, stage.firstChild);
		}
		root.classList.add("has-native-return");
		video.play().catch(function () {});
		if (!state.nativeReturnConnected) {
			state.nativeReturnConnected = true;
			showToast("Host feed connected.");
		}
		logMobile("native return stream bound", {
			uuid: String(uuid || ""),
			tracks: summarizeStream(stream)
		});
		return true;
	}

	function ensureNameLabelOnTop(surface) {
		var label = byId("mcastMobileSelfName");
		if (surface && label && label.parentNode === surface) {
			surface.appendChild(label);
		}
	}

	function scheduleVideoCorrection() {
		if (state.correctionTimer) {
			window.cancelAnimationFrame(state.correctionTimer);
		}
		state.correctionTimer = window.requestAnimationFrame(function () {
			state.correctionTimer = 0;
			applyVideoCorrection();
		});
	}

	function applyVideoCorrection() {
		var video = getLocalVideoElement();
		if (!video || !root || !isMobileGuestViewport()) {
			return;
		}
		if (state.capabilities.screen) {
			video.classList.remove("mcast-mobile-video-corrected", "mcast-mobile-video-mirrored");
			video.style.removeProperty("--mcast-mobile-corrected-width");
			video.style.removeProperty("--mcast-mobile-corrected-height");
			return;
		}
		var viewportPortrait = window.innerWidth <= window.innerHeight;
		var streamLandscape = (video.videoWidth || 0) > (video.videoHeight || 0);
		var shouldCorrect = viewportPortrait && streamLandscape && !!video.videoWidth && !!video.videoHeight;
		var mirrored = shouldMirrorVideo(video);
		video.classList.toggle("mcast-mobile-video-corrected", shouldCorrect);
		video.classList.toggle("mcast-mobile-video-mirrored", mirrored);
		if (shouldCorrect) {
			var surface = video.parentElement;
			var rect = surface ? surface.getBoundingClientRect() : null;
			if (rect && rect.width && rect.height) {
				video.style.setProperty("--mcast-mobile-corrected-width", Math.ceil(rect.height) + "px");
				video.style.setProperty("--mcast-mobile-corrected-height", Math.ceil(rect.width) + "px");
			}
		} else {
			video.style.removeProperty("--mcast-mobile-corrected-width");
			video.style.removeProperty("--mcast-mobile-corrected-height");
		}
		var signature = [
			window.innerWidth + "x" + window.innerHeight,
			video.videoWidth + "x" + video.videoHeight,
			shouldCorrect ? "corrected" : "normal",
			mirrored ? "mirrored" : "not-mirrored"
		].join("|");
		if (signature !== state.lastCorrectionLog) {
			state.lastCorrectionLog = signature;
			logMobile("video orientation state", Object.assign(getViewportDebug(), {
				videoWidth: video.videoWidth || 0,
				videoHeight: video.videoHeight || 0,
				correctiveRotation: shouldCorrect
			}));
		}
	}

	function shouldMirrorVideo(video) {
		if (!video) {
			return false;
		}
		var transform = (video.style && video.style.transform) || "";
		return video.classList.contains("mirrorControl") ||
			video.classList.contains("mirrored") ||
			transform.indexOf("scaleX(-1)") !== -1;
	}

	function startAudioMeter() {
		var stream = getLocalStream(getLocalVideoElement());
		var fill = byId("mcastMobileMicMeter") && byId("mcastMobileMicMeter").querySelector("i");
		if (!stream || !fill || state.meterAnalyser) {
			return;
		}
		var audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
		if (!audioTracks.length) {
			setText("mcastMobileMicStatus", "No microphone detected");
			return;
		}
		try {
			state.meterContext = new (window.AudioContext || window.webkitAudioContext)();
			state.meterSource = state.meterContext.createMediaStreamSource(new MediaStream(audioTracks));
			state.meterAnalyser = state.meterContext.createAnalyser();
			state.meterAnalyser.fftSize = 256;
			state.meterSource.connect(state.meterAnalyser);
			updateAudioMeter();
		} catch (error) {
			setText("mcastMobileMicStatus", "Mic connected");
			logMobile("audio meter unavailable", { name: error && error.name });
		}
	}

	function updateAudioMeter() {
		var meter = byId("mcastMobileMicMeter");
		var fill = meter && meter.querySelector("i");
		if (!fill || !state.meterAnalyser) {
			return;
		}
		var data = new Uint8Array(state.meterAnalyser.frequencyBinCount);
		state.meterAnalyser.getByteFrequencyData(data);
		var sum = 0;
		for (var i = 0; i < data.length; i += 1) {
			sum += data[i];
		}
		var avg = sum / Math.max(1, data.length);
		var pct = Math.max(10, Math.min(100, Math.round(avg * 1.25)));
		fill.style.height = pct + "%";
		setText("mcastMobileMicStatus", pct > 18 ? "Mic is working" : "Speak to test mic");
		state.meterFrame = window.requestAnimationFrame(updateAudioMeter);
	}

	function syncDevices() {
		if (state.capabilities.camera) { syncCameraDevices(); }
		if (state.capabilities.microphone) { syncMicDevices(); }
		if (state.experience.kind === "guest") { syncSpeakerDevices(); }
	}

	function syncCameraDevices() {
		var nativeSelect = byId("videoSourceSelect") || byId("videoSource3");
		if (!nativeSelect) {
			return;
		}
		var options = Array.prototype.map.call(nativeSelect.options || [], function (option) {
			return { value: option.value, text: option.textContent || option.label || "Camera" };
		});
		var select = byId("mcastMobileCameraSelect");
		replaceOptions(select, options, "Camera");
		if (select && hasOption(select, nativeSelect.value || "")) {
			select.value = nativeSelect.value || "";
		}
	}

	function syncMicDevices() {
		var nativeList = byId("audioSource") || byId("audioSource3");
		if (!nativeList) {
			return;
		}
		var active = "";
		var options = Array.prototype.map.call(nativeList.querySelectorAll("input[type='checkbox']"), function (input) {
			if (input.checked) {
				active = input.value || input.id;
			}
			var label = nativeList.querySelector("label[for='" + cssEscape(input.id) + "']");
			return {
				value: input.value || input.id,
				text: label ? label.textContent.trim() : input.getAttribute("data-label") || "Microphone"
			};
		}).filter(function (item) { return item.value; });
		var select = byId("mcastMobileMicSelect");
		replaceOptions(select, options, "Microphone");
		if (select && hasOption(select, active)) {
			select.value = active;
		}
	}

	function syncSpeakerDevices() {
		var nativeSelect = byId("outputSource") || byId("outputSource3");
		if (!nativeSelect) {
			setHidden("mcastMobileSpeakerField", false);
			setHidden("mcastMobileSpeakerSelect", false);
			replaceOptions(byId("mcastMobileSpeakerSelect"), [], "System default");
			return;
		}
		var options = Array.prototype.map.call(nativeSelect.options || [], function (option) {
			return { value: option.value, text: option.textContent || option.label || "System default" };
		});
		if (!options.length) {
			setHidden("mcastMobileSpeakerField", false);
			setHidden("mcastMobileSpeakerSelect", false);
			replaceOptions(byId("mcastMobileSpeakerSelect"), [], "System default");
			return;
		}
		setHidden("mcastMobileSpeakerField", false);
		setHidden("mcastMobileSpeakerSelect", false);
		var select = byId("mcastMobileSpeakerSelect");
		replaceOptions(select, options, "System default");
		if (select && hasOption(select, nativeSelect.value || "")) {
			select.value = nativeSelect.value || "";
		}
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
			showStatus("No camera is available to switch to.", true);
			return;
		}
		nativeSelect.value = value;
		dispatchNativeChange(nativeSelect);
		showStatus("Switching camera...");
		window.setTimeout(function () {
			bindLocalVideo("camera-change");
			updateControls();
		}, 900);
	}

	function selectNativeMic(value) {
		var nativeList = byId("audioSource") || byId("audioSource3");
		if (!nativeList || !value) {
			showStatus("No microphone is available to switch to.", true);
			return;
		}
		Array.prototype.forEach.call(nativeList.querySelectorAll("input[type='checkbox']"), function (input) {
			input.checked = (input.value || input.id) === value;
			dispatchNativeChange(input);
		});
		showStatus("Switching microphone...");
		window.setTimeout(startAudioMeter, 250);
	}

	function selectNativeSpeaker(value) {
		var nativeSelect = byId("outputSource") || byId("outputSource3");
		if (!nativeSelect || !hasOption(nativeSelect, value)) {
			showStatus("This speaker is not available.", true);
			return;
		}
		nativeSelect.value = value;
		dispatchNativeChange(nativeSelect);
		showStatus("Speaker updated.");
	}

	function initializeProcessingOptions() {
		var echo = byId("mcastMobileEchoCancel");
		var noise = byId("mcastMobileNoiseSuppress");
		var gain = byId("mcastMobileAutoGain");
		if (window.session) {
			if (echo && typeof window.session.echoCancellation === "boolean") { echo.checked = window.session.echoCancellation; }
			if (noise && typeof window.session.noiseSuppression === "boolean") { noise.checked = window.session.noiseSuppression; }
			if (gain && typeof window.session.autoGainControl === "boolean") { gain.checked = window.session.autoGainControl; }
		}
		applyScreenAudioPreference();
	}

	function applyAudioProcessing() {
		var settings = {
			echoCancellation: !!(byId("mcastMobileEchoCancel") && byId("mcastMobileEchoCancel").checked),
			noiseSuppression: !!(byId("mcastMobileNoiseSuppress") && byId("mcastMobileNoiseSuppress").checked),
			autoGainControl: !!(byId("mcastMobileAutoGain") && byId("mcastMobileAutoGain").checked)
		};
		if (window.session) {
			window.session.echoCancellation = settings.echoCancellation;
			window.session.noiseSuppression = settings.noiseSuppression;
			window.session.autoGainControl = settings.autoGainControl;
		}
		var stream = getLocalStream(getLocalVideoElement());
		var tracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
		if (!tracks.length || typeof tracks[0].applyConstraints !== "function") {
			return;
		}
		tracks[0].applyConstraints(settings).then(function () {
			showStatus("Microphone processing updated.");
		}).catch(function () {
			showStatus("This microphone does not support one of the selected options.", true);
		});
	}

	function applyScreenAudioPreference() {
		if (!window.session) { return; }
		var includeAudio = !!(byId("mcastMobileScreenAudio") && byId("mcastMobileScreenAudio").checked);
		window.session.systemAudio = includeAudio ? "include" : "exclude";
		window.session.screenshareVideoOnly = !includeAudio;
	}

	function toggleMute(event) {
		var start = now();
		logMobile("mute clicked", { muted: isMicMuted(), at: start });
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		var nextEnabled = isMicMuted();
		setAudioTracksEnabled(nextEnabled);
		if (window.session) {
			window.session.muted = !nextEnabled;
		}
		logMobile("track enabled changed", { enabled: nextEnabled, elapsedMs: Math.round(now() - start) });
		updateControls();
		logMobile("UI state updated", { muted: !nextEnabled, elapsedMs: Math.round(now() - start) });
		syncNativeMuteStateInBackground(!nextEnabled);
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
			logMobile("camera track enabled/disabled", { enabled: nextEnabled });
		} else if (typeof window.toggleVideoMute === "function") {
			window.toggleVideoMute();
		} else {
			startPreview().catch(function () {});
		}
		window.setTimeout(function () {
			bindLocalVideo("camera-toggle");
			updateControls();
		}, 160);
	}

	function updateControls() {
		var muted = isMicMuted();
		var cameraOff = isCameraOff();
		setIconButton("mcastMobileSetupMicButton", icons.mic, muted ? "Unmute" : "Mute");
		setIconButton("mcastMobileRoomMicButton", icons.mic, muted ? "Unmute" : "Mic");
		setIconButton("mcastMobileSetupCameraButton", icons.camera, cameraOff ? "Start cam" : "Stop cam");
		setIconButton("mcastMobileRoomCameraButton", icons.camera, cameraOff ? "Cam on" : "Camera");
		["mcastMobileSetupMicButton", "mcastMobileRoomMicButton"].forEach(function (id) {
			toggleClass(id, "is-off", muted);
		});
		["mcastMobileSetupCameraButton", "mcastMobileRoomCameraButton"].forEach(function (id) {
			toggleClass(id, "is-off", cameraOff);
		});
		toggleClass("mcastMobileSelfPreview", "is-camera-off", cameraOff);
	}

	function toggleSettings() {
		var panel = byId("mcastMobileSettingsPanel");
		if (!panel) {
			showToast("Settings are available before entering the studio.");
			return;
		}
		if (panel.hidden) { openSettings(); } else { closeSettings(); }
	}

	function openSettings() {
		var panel = byId("mcastMobileSettingsPanel");
		if (!panel) { return; }
		panel.hidden = false;
		syncDevices();
		var focusTarget = state.capabilities.camera
			? byId("mcastMobileCameraSelect")
			: state.capabilities.microphone
				? byId("mcastMobileMicSelect")
				: byId("mcastMobileScreenAudio");
		if (focusTarget) { focusTarget.focus(); }
	}

	function closeSettings() {
		var panel = byId("mcastMobileSettingsPanel");
		if (panel) { panel.hidden = true; }
	}

	function showMediaRecovery(error, retryAction) {
		closeSettings();
		if (!window.MCastGuestUi || typeof window.MCastGuestUi.showMediaError !== "function") {
			return;
		}
		var capability = state.capabilities.screen
			? "screen"
			: state.capabilities.camera && state.capabilities.microphone
				? "camera and microphone"
				: state.capabilities.microphone ? "microphone" : "camera";
		window.MCastGuestUi.showMediaError(error, capability, {
			actions: [
				{ label: "Close", value: false, variant: "secondary" },
				{ label: "Open settings", value: "settings", variant: "secondary", onSelect: openSettings },
				{ label: "Try again", value: "retry", variant: "primary", onSelect: function () { retryAction(); } }
			]
		});
	}

	function leaveRoom() {
		showToast(state.capabilities.screen ? "Screen sharing stopped." : "You disconnected.");
		state.joined = false;
		state.previewStarted = false;
		state.screenTrack = null;
		root.classList.remove("is-joined");
		setStep(state.capabilities.screen ? "permission" : "setup");
		if (typeof window.hangup === "function") {
			window.hangup();
		}
		updateControls();
	}

	function watchScreenShareEnded() {
		var stream = getScreenStream();
		var tracks = stream && stream.getVideoTracks ? stream.getVideoTracks() : [];
		var track = tracks[0];
		if (!track || state.screenTrack === track) { return; }
		state.screenTrack = track;
		track.addEventListener("ended", function () {
			if (!state.joined) { return; }
			state.joined = false;
			state.previewStarted = false;
			state.screenTrack = null;
			root.classList.remove("has-preview", "is-joined");
			setStep("permission");
			setStatus("Screen sharing stopped. Choose what to share to reconnect.");
			showToast("Screen sharing stopped.");
		});
	}

	function installNativeGuestControls() {
		window.MCastNativeGuestControls = {
			setAudioEnabled: function (enabled) {
				enabled = !!enabled;
				setAudioTracksEnabled(enabled);
				if (window.session) {
					window.session.muted = !enabled;
				}
				syncNativeMuteStateInBackground(!enabled);
				updateControls();
				showToast(enabled ? "Host enabled your microphone." : "Host muted your microphone.");
				return true;
			},
			setVideoEnabled: function (enabled) {
				enabled = !!enabled;
				setVideoTracksEnabled(enabled);
				if (window.session) {
					window.session.videoMuted = !enabled;
				}
				bindLocalVideo("native-camera-command");
				updateControls();
				showToast(enabled ? "Host enabled your camera." : "Host disabled your camera.");
				return true;
			},
			setPresence: function (payload) {
				var presence = String(payload && (payload.presenceState || payload.participantState) || "").toLowerCase();
				if (presence === "onscreen") {
					setStep("backstage");
					showToast("The host moved you on screen.");
				} else if (presence === "removed") {
					leaveRoom();
				} else {
					setStep("backstage");
					showToast("You are backstage.");
				}
				return true;
			},
			startMedia: function () {
				if (!state.joined) {
					joinRoom();
				} else {
					startNativeWebRtcBridge();
				}
				return true;
			},
			disconnect: function () {
				leaveRoom();
				return true;
			}
		};
	}

	function applyGuestName() {
		if (document.documentElement.classList.contains("mcast-route-error")) {
			return "";
		}
		var input = byId("mcastMobileGuestName");
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
			document.title = name + " - MCast Studio v9";
		} catch (error) {}
		setSelfName();
		return name;
	}

	function restoreGuestName() {
		var input = byId("mcastMobileGuestName");
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
		setStatus("Enter your display name before entering the studio.", true);
		var input = byId("mcastMobileGuestName");
		if (input) {
			input.focus();
		}
		return false;
	}

	function setSelfName() {
		var name = applyGuestNameFromStorage() || "You";
		setText("mcastMobileSelfName", name);
	}

	function applyGuestNameFromStorage() {
		var input = byId("mcastMobileGuestName");
		if (input && input.value.trim()) {
			return input.value.trim().slice(0, 60);
		}
		try {
			return (window.sessionStorage.getItem("mcastGuestName") || "").slice(0, 60);
		} catch (error) {
			return "";
		}
	}

	function fillRoomName() {
		var label = "Guest room";
		if (window.MCastRoute && (window.MCastRoute.remoteSourceKind || window.MCastRoute.mode)) {
			label = titleCase(String(window.MCastRoute.remoteSourceKind || window.MCastRoute.mode).replace(/_/g, " "));
		} else if (window.urlParams && window.urlParams.get && window.urlParams.get("room")) {
			label = "Room " + String(window.urlParams.get("room")).slice(0, 18);
		}
		setText("mcastMobileRoomName", label);
	}

	function decorateButtons() {
		setIconButton("mcastMobileSetupMicButton", icons.mic, "Mute");
		setIconButton("mcastMobileSetupCameraButton", icons.camera, "Stop cam");
		setIconButton("mcastMobileSetupSettingsButton", icons.settings, "Settings");
		setIconButton("mcastMobileRoomMicButton", icons.mic, "Mic");
		setIconButton("mcastMobileRoomCameraButton", icons.camera, "Camera");
		setIconButton("mcastMobileMoreButton", icons.more, "More");
		setIconButton("mcastMobileLeaveButton", icons.leave, "Leave");
	}

	function setIconButton(id, icon, label) {
		var button = byId(id);
		if (!button) {
			return;
		}
		if (button.dataset.label === label && button.dataset.iconReady === "true") {
			return;
		}
		button.dataset.label = label;
		button.dataset.iconReady = "true";
		button.innerHTML = icon + "<span>" + escapeHtml(label) + "</span>";
		button.setAttribute("aria-label", label);
	}

	function setButtonBusy(id, busy, label) {
		var button = byId(id);
		if (!button) {
			return;
		}
		button.disabled = !!busy;
		button.classList.toggle("is-loading", !!busy);
		if (label) {
			button.textContent = label;
		}
	}

	function showStatus(message, isError) {
		showToast(message || "", isError);
	}

	function setStatus(message, isError) {
		showToast(message || "", isError);
	}

	function showToast(message, isError) {
		if (!window.MCastGuestUi) {
			return;
		}
		if (!message && typeof window.MCastGuestUi.clearNotices === "function") {
			window.MCastGuestUi.clearNotices();
			return;
		}
		if (typeof window.MCastGuestUi.showToast === "function") {
			window.MCastGuestUi.showToast(message, { kind: isError ? "error" : "info", duration: 10000 });
		}
	}

	function connectedNotice() {
		return state.experience.connectedTitle + ". " + state.experience.connectedMessage;
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
		if (state.capabilities.screen) {
			return getScreenVideoElement();
		}
		var sessionVideo = window.session && window.session.videoElement;
		if (sessionVideo && sessionVideo.nodeName === "VIDEO") {
			return sessionVideo;
		}
		return byId("videosource") || byId("previewWebcam") || byId("mcastMobileLocalVideo");
	}

	function getLocalStream(video) {
		if (state.capabilities.screen) {
			return getScreenStream();
		}
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

	function getScreenVideoElement() {
		var sessionScreen = window.session && window.session.screenShareElement;
		if (sessionScreen && sessionScreen.nodeName === "VIDEO") {
			return sessionScreen;
		}
		return byId("screensharesource") || byId("mcastMobileScreenVideo");
	}

	function getScreenStream() {
		var video = getScreenVideoElement();
		var candidates = [
			window.session && window.session.screenStream,
			video && video.srcObject,
			window.session && window.session.screenShareElement && window.session.screenShareElement.srcObject
		];
		for (var index = 0; index < candidates.length; index += 1) {
			if (isUsableStream(candidates[index])) { return candidates[index]; }
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

	function syncNativeMuteStateInBackground(muted) {
		window.setTimeout(function () {
			try {
				if (window.session) {
					window.session.muted = !!muted;
				}
			} catch (error) {}
		}, 0);
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

	function waitForLocalMedia(timeout) {
		return state.capabilities.camera ? waitForPreview(timeout) : waitForLocalStream(timeout);
	}

	function waitForScreenStream(timeout) {
		return waitUntil(function () { return !!getScreenStream(); }, timeout);
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

	function toggleClass(id, className, enabled) {
		var element = byId(id);
		if (element) {
			element.classList.toggle(className, !!enabled);
		}
	}

	function setText(id, text) {
		var element = byId(id);
		if (element) {
			element.textContent = text;
		}
	}

	function setButtonText(id, text) {
		var button = byId(id);
		if (button) { button.textContent = text; }
	}

	function setHidden(id, hidden) {
		var element = byId(id);
		if (element) { element.hidden = !!hidden; }
	}

	function getPermissionMessage(error) {
		var capability = state.capabilities.screen
			? "screen"
			: state.capabilities.camera && state.capabilities.microphone
				? "camera and microphone"
				: state.capabilities.microphone ? "microphone" : "camera";
		if (window.MCastGuestUi && typeof window.MCastGuestUi.safeErrorMessage === "function") {
			return window.MCastGuestUi.safeErrorMessage(error, capability);
		}
		return "The selected media could not start. Check browser permission and try again.";
	}

	function summarizeStream(stream) {
		return {
			hasStream: !!stream,
			videoTracks: stream && stream.getVideoTracks ? stream.getVideoTracks().length : 0,
			audioTracks: stream && stream.getAudioTracks ? stream.getAudioTracks().length : 0,
			trackEnabled: stream && stream.getTracks ? stream.getTracks().map(function (track) {
				return track.kind + ":" + track.enabled + ":" + track.readyState;
			}) : []
		};
	}

	function getVideoDebug(video) {
		return Object.assign(getViewportDebug(), {
			videoWidth: video && video.videoWidth || 0,
			videoHeight: video && video.videoHeight || 0,
			attached: !!(video && video.srcObject)
		});
	}

	function getViewportDebug() {
		var orientation = "";
		try {
			orientation = window.screen && window.screen.orientation && window.screen.orientation.type || "";
		} catch (error) {}
		return {
			viewport: window.innerWidth + "x" + window.innerHeight,
			viewportLandscape: window.innerWidth > window.innerHeight,
			mediaPortrait: !!(window.matchMedia && window.matchMedia("(orientation: portrait)").matches),
			screenOrientation: orientation
		};
	}

	function logMobile(message, details) {
		try {
			console.info("[MCast mobile guest]", message, details || {});
		} catch (error) {}
	}

	function now() {
		return window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now();
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

	function routeSourceLabel() {
		if (window.MCastRoute && window.MCastRoute.guestName) {
			return window.MCastRoute.guestName;
		}
		if (state.experience.kind === "remote_camera") { return "Remote camera"; }
		if (state.experience.kind === "remote_audio") { return "Remote microphone"; }
		if (state.experience.kind === "remote_screen") { return "Remote screen"; }
		return "Guest";
	}

	function escapeHtml(value) {
		return String(value || "").replace(/[&<>"']/g, function (character) {
			return {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;"
			}[character];
		});
	}

	function byId(id) {
		return document.getElementById(id);
	}
}());
