(function () {
	"use strict";

	var root;
	var state = {
		initialized: false,
		active: false,
		activationFrame: 0,
		previewStarted: false,
		joining: false,
		joined: false,
		disconnecting: false,
		experience: null,
		capabilities: { camera: true, microphone: true, screen: false, displayName: true },
		step: "loading",
		devicePoll: 0,
		tilePoll: 0,
		meterFrame: 0,
		meterContext: null,
		meterAnalyser: null,
		lastStatus: "",
		joinWithoutCamera: false,
		screenTrack: null,
		boundLocalVideo: null,
		boundLocalStream: null,
		boundLocalSurface: null
	};

	var icons = {
		mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z"/><path d="M19 10a7 7 0 0 1-14 0"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>',
		camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 10l5-3v10l-5-3v3H4V7h11v3Z"/></svg>',
		settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 1 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 3.8 14.7 1.8 1.8 0 0 0 2.15 13H2a2.1 2.1 0 0 1 0-4.2h.15A1.8 1.8 0 0 0 3.8 7.7a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 1 1 6.37 2.7l.04.04a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 9.5 1.45V1.4a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 1 1 2.97 2.97l-.04.04a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15Z"/></svg>',
		preview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>',
		leave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg>'
	};

	installResponsiveActivation();

	function init() {
		root = byId("mcastDesktopGuest");
		if (!root || !isDesktopViewport() || !activateResponsiveShell()) {
			return;
		}
		if (state.initialized) {
			startDesktopPolling();
			return;
		}
		state.initialized = true;
		configureExperience();
		disableLegacyAuxiliaryModules();
		removeLegacyBranding();
		wireDesktopUi();
		installNativeGuestControls();
		decorateDesktopButtons();
		guardDesktopLogo();
		fillDesktopRouteDetails();
		restoreGuestName();
		setStep("loading");
		setStatus(state.experience.loadingMessage);
		window.setTimeout(function () {
			if (!state.joined) {
				setStep("setup");
				setStatus(setupReadyMessage());
			}
		}, 850);
		startDesktopPolling();
		window.addEventListener("online", function () {
			if (!isActiveResponsiveShell()) { return; }
			setStatus(state.joined ? "Connection restored." : "Connection restored. You can join now.");
		});
		window.addEventListener("offline", function () {
			if (!isActiveResponsiveShell()) { return; }
			setStatus("You appear to be offline. Check your connection, then rejoin.", true);
		});
		window.addEventListener("mcast:open-settings", function () {
			if (isActiveResponsiveShell()) { openSettings(); }
		});
		window.addEventListener("mcast:invite-lease-lost", function () {
			if (isActiveResponsiveShell()) {
				finishGuestSession("Your secure guest connection ended. You are free to close this page.", false);
			}
		});
	}

	function installResponsiveActivation() {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", scheduleResponsiveActivation, { once: true });
		} else {
			scheduleResponsiveActivation();
		}
		window.addEventListener("resize", scheduleResponsiveActivation, { passive: true });
		window.addEventListener("orientationchange", scheduleResponsiveActivation, { passive: true });
		window.addEventListener("mcast:responsive-shell-activated", function (event) {
			var shell = event && event.detail && event.detail.shell;
			if (shell === "desktop") {
				state.active = true;
				startDesktopPolling();
				return;
			}
			if (!state.joined) {
				state.active = false;
				stopDesktopPolling();
				document.body.classList.remove("mcast-desktop-guest-active");
				document.documentElement.classList.remove("mcast-desktop-guest-active");
			}
		});
	}

	function scheduleResponsiveActivation() {
		if (state.activationFrame) {
			window.cancelAnimationFrame(state.activationFrame);
		}
		state.activationFrame = window.requestAnimationFrame(function () {
			state.activationFrame = window.requestAnimationFrame(function () {
				state.activationFrame = 0;
				init();
			});
		});
	}

	function activateResponsiveShell() {
		var lock = window.__mcastGuestShellLock;
		if (lock && lock !== "desktop") { return false; }
		state.active = true;
		window.__mcastActiveGuestShell = "desktop";
		document.documentElement.classList.add("mcast-responsive-shell-desktop", "mcast-desktop-guest-active");
		document.documentElement.classList.remove("mcast-responsive-shell-mobile", "mcast-mobile-guest-active");
		document.body.classList.add("mcast-desktop-guest-active");
		document.body.classList.remove("mcast-mobile-guest-active");
		window.dispatchEvent(new CustomEvent("mcast:responsive-shell-activated", { detail: { shell: "desktop" } }));
		return true;
	}

	function isActiveResponsiveShell() {
		return state.active && window.__mcastActiveGuestShell === "desktop";
	}

	function startDesktopPolling() {
		if (!state.initialized || !state.active) { return; }
		if (!state.devicePoll) {
			state.devicePoll = window.setInterval(syncDevices, 900);
		}
		if (!state.tilePoll) {
			state.tilePoll = window.setInterval(function () {
				if (!state.active) { return; }
				if (state.previewStarted || state.joined) {
					bindLocalVideo("poll");
				}
				syncRoomTiles();
				updateDesktopControls();
				startNativeWebRtcBridge();
			}, 900);
		}
	}

	function stopDesktopPolling() {
		window.clearInterval(state.devicePoll);
		window.clearInterval(state.tilePoll);
		state.devicePoll = 0;
		state.tilePoll = 0;
	}

	function configureExperience() {
		state.experience = window.MCastGuestUi && typeof window.MCastGuestUi.getExperience === "function"
			? window.MCastGuestUi.getExperience()
			: {
				kind: "guest",
				capabilities: state.capabilities,
				loadingTitle: "Preparing your guest studio",
				loadingMessage: "Preparing your secure guest backstage.",
				setupTitle: "Let’s set up your studio",
				setupMessage: "Entering the studio will not automatically start the broadcast.",
				previewLabel: "Camera preview",
				previewHint: "Start preview or enter the studio to allow camera and microphone access.",
				primaryAction: "Enter studio",
				connectedTitle: "You’re backstage",
				connectedMessage: "Your camera and microphone are connected.",
				badge: "Backstage"
			};
		state.capabilities = state.experience.capabilities || state.capabilities;
		root.dataset.experience = state.experience.kind;
		root.classList.toggle("is-audio-only", state.experience.kind === "remote_audio");
		root.classList.toggle("is-screen-only", state.experience.kind === "remote_screen");
		setText("mcastDesktopLoadingTitle", state.experience.loadingTitle);
		setText("mcastDesktopLoadingStatus", state.experience.loadingMessage);
		setText("mcastDesktopSetupTitle", state.experience.setupTitle);
		setText("mcastDesktopSetupMessage", state.experience.setupMessage);
		setText("mcastDesktopPreviewLabel", state.experience.previewLabel);
		setText("mcastDesktopPreviewHint", state.experience.previewHint);
		setButtonText("mcastDesktopJoinButton", state.experience.primaryAction);
		setHidden("mcastDesktopGuestNameField", !state.capabilities.displayName);
		setHidden("mcastDesktopCameraField", !state.capabilities.camera);
		setHidden("mcastDesktopMicField", !state.capabilities.microphone);
		setHidden("mcastDesktopSpeakerField", state.experience.kind !== "guest");
		setHidden("mcastDesktopAudioOptions", !state.capabilities.microphone);
		setHidden("mcastDesktopScreenOptions", !state.capabilities.screen);
		setHidden("mcastDesktopMeterCard", !state.capabilities.microphone);
		setHidden("mcastDesktopMicToggle", !state.capabilities.microphone);
		setHidden("mcastDesktopCameraToggle", !state.capabilities.camera);
		setHidden("mcastDesktopPreviewButton", state.capabilities.screen);
		setHidden("mcastDesktopRoomMicButton", !state.capabilities.microphone);
		setHidden("mcastDesktopRoomCameraButton", !state.capabilities.camera);
		if (!state.capabilities.displayName) {
			var input = byId("mcastDesktopGuestName");
			if (input && !input.value) { input.value = routeSourceLabel(); }
		}
		initializeProcessingOptions();
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
		});
		on("mcastDesktopMicSelect", "change", function (event) {
			selectNativeMic(event.target.value);
		});
		on("mcastDesktopSpeakerSelect", "change", function (event) { selectNativeSpeaker(event.target.value); });
		on("mcastDesktopEchoCancel", "change", applyAudioProcessing);
		on("mcastDesktopNoiseSuppress", "change", applyAudioProcessing);
		on("mcastDesktopAutoGain", "change", applyAudioProcessing);
		on("mcastDesktopScreenAudio", "change", applyScreenAudioPreference);
		on("mcastDesktopMicToggle", "click", toggleMute);
		on("mcastDesktopRoomMicButton", "click", toggleMute);
		on("mcastDesktopCameraToggle", "click", toggleCamera);
		on("mcastDesktopRoomCameraButton", "click", toggleCamera);
		on("mcastDesktopSettingsButton", "click", toggleSettings);
		on("mcastDesktopSettingsClose", "click", hideSettings);
		on("mcastDesktopLeaveButton", "click", leaveRoom);
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
			log: logDesktop,
			onRemoteStream: bindNativeReturnStream,
			onRemoteStreamRemoved: clearNativeReturnStream,
			onTerminal: function () {
				finishGuestSession("The session has ended. You are free to close this page.", true);
			},
			onState: function (stage) {
				if (stage === "media-attached") {
					setStatus("Native studio connection is starting...");
				}
			}
		});
	}

	function setStep(step) {
		state.step = step;
		root.dataset.step = step;
		var liveBadge = byId("mcastDesktopLiveBadge");
		if (liveBadge) {
			liveBadge.textContent = step === "live" ? "Live room" : step === "backstage" ? state.experience.badge : "Setup";
		}
	}

	function fillDesktopRouteDetails() {
		var meta = byId("mcastDesktopInviteMeta");
		if (!meta || !window.MCastRoute) {
			return;
		}
		var routeLabel = window.MCastRoute.remoteSourceKind || window.MCastRoute.mode || "guest";
		meta.textContent = titleCase(routeLabel.replace(/_/g, " ")) + " invite";
	}

	function setupReadyMessage() {
		if (state.experience.kind === "remote_camera") { return "Choose the devices this camera should use, then connect when ready."; }
		if (state.experience.kind === "remote_audio") { return "Choose the microphone this device should use, then connect when ready."; }
		if (state.experience.kind === "remote_screen") { return "Choose Start sharing when you are ready to select a screen."; }
		return "Ready when you are.";
	}

	async function startPreview() {
		if (state.capabilities.screen) {
			return joinScreenShare();
		}
		setButtonBusy("mcastDesktopPreviewButton", true, "Starting...");
		setStatus(state.capabilities.camera && !state.joinWithoutCamera
			? "Requesting camera and microphone access..."
			: "Requesting microphone access...");
		try {
			if (typeof window.previewWebcam !== "function") {
				await waitForFunction("previewWebcam", 4500);
			}
			if (state.joinWithoutCamera) {
				applyNoCameraSession();
			}
			await window.previewWebcam(false);
			await waitForLocalMedia(9000);
			state.previewStarted = true;
			bindLocalVideo("preview-ready");
			syncDevices();
			startAudioMeter();
			setStatus(state.experience.kind === "remote_audio"
				? "Microphone is ready. Confirm the level, then connect."
				: "Preview is ready. Confirm your setup, then continue.");
		} catch (error) {
			logDesktop("media preview error", summarizeError(error));
			setStatus(getPermissionMessage(error), true);
			showMediaRecovery(error, startPreview);
			throw error;
		} finally {
			setButtonBusy("mcastDesktopPreviewButton", false, "Preview");
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
		var leaseClaimed = false;
		setButtonBusy("mcastDesktopJoinButton", true, "Connecting...");
		setStatus("Preparing the secure connection...");
		try {
			if (!state.previewStarted) {
				await startPreview();
			}
			if (state.joinWithoutCamera) {
				applyNoCameraSession();
			}
			if (state.capabilities.displayName) { applyGuestName(); }
			await waitForReadyButton(9000);
			if (typeof window.publishWebcam !== "function") {
				await waitForFunction("publishWebcam", 4500);
			}
			bindLocalVideo("pre-publish");
			await claimInviteLease();
			leaseClaimed = true;
			await window.publishWebcam(byId("gowebcam") || false);
			await waitForLocalStream(5000);
			state.joined = true;
			window.__mcastGuestShellLock = "desktop";
			document.body.classList.add("mcast-desktop-room-active");
			root.classList.add("has-preview", "is-joined");
			setStep("backstage");
			bindLocalVideo("joined");
			setStatus(connectedNotice());
			syncRoomTiles();
			updateDesktopControls();
			startNativeWebRtcBridge();
		} catch (error) {
			logDesktop("join error", summarizeError(error));
			var tornDown = leaseClaimed ? await tearDownPublishedSession() : false;
			if (leaseClaimed && tornDown) {
				await releaseInviteLease();
			}
			if (isInviteLeaseError(error)) {
				setStatus("This invite is already in use. Try again after the current guest disconnects.", true);
				window.MCastGuestUi.showInviteLeaseError(error);
			} else {
				setStatus(getPermissionMessage(error), true);
				showMediaRecovery(error, tornDown ? reloadGuestPage : joinRoom);
			}
		} finally {
			state.joining = false;
			setButtonBusy("mcastDesktopJoinButton", false, state.experience.primaryAction);
		}
	}

	async function joinScreenShare() {
		if (state.joining || state.joined) {
			return;
		}
		state.joining = true;
		var leaseClaimed = false;
		setButtonBusy("mcastDesktopJoinButton", true, "Choose a screen...");
		setStatus("Choose a screen, window, or browser tab in the system prompt.");
		applyScreenAudioPreference();
		try {
			if (typeof window.publishScreen !== "function") {
				await waitForFunction("publishScreen", 6000);
			}
			await claimInviteLease();
			leaseClaimed = true;
			await window.publishScreen();
			if (!getScreenStream()) {
				var selectionError = new Error("Screen selection was not completed");
				selectionError.name = "NotAllowedError";
				throw selectionError;
			}
			await waitForScreenStream(4000);
			state.previewStarted = true;
			state.joined = true;
			window.__mcastGuestShellLock = "desktop";
			document.body.classList.add("mcast-desktop-room-active");
			root.classList.add("has-preview", "is-joined");
			bindLocalVideo("screen-connected");
			watchScreenShareEnded();
			setStep("backstage");
			setStatus(connectedNotice());
			syncRoomTiles();
			updateDesktopControls();
		} catch (error) {
			var tornDown = leaseClaimed ? await tearDownPublishedSession() : false;
			if (leaseClaimed && tornDown) {
				await releaseInviteLease();
			}
			if (isInviteLeaseError(error)) {
				setStatus("This invite is already in use. Try again after the current guest disconnects.", true);
				window.MCastGuestUi.showInviteLeaseError(error);
			} else {
				setStatus(getPermissionMessage(error), true);
				showMediaRecovery(error, tornDown ? reloadGuestPage : joinScreenShare);
			}
		} finally {
			state.joining = false;
			setButtonBusy("mcastDesktopJoinButton", false, state.experience.primaryAction);
		}
	}

	function bindLocalVideo(reason) {
		var surface = state.joined ? byId("mcastDesktopLocalTile") : byId("mcastDesktopPreviewSurface");
		if (!surface) {
			return false;
		}
		var video = state.capabilities.screen ? getScreenVideoElement() : getLocalVideoElement();
		var stream = state.capabilities.screen ? getScreenStream() : getLocalStream(video);
		var hasVideo = !!(stream && stream.getVideoTracks && stream.getVideoTracks().some(isLiveTrack));
		if (!video && stream && hasVideo) {
			video = document.createElement("video");
			video.id = state.capabilities.screen ? "mcastDesktopScreenVideo" : "mcastDesktopLocalVideo";
			video.autoplay = true;
			video.playsInline = true;
			video.muted = true;
		}
		if (!video) {
			if (stream && state.experience.kind === "remote_audio") {
				root.classList.add("has-preview");
				state.previewStarted = true;
				updateLocalTileLabel();
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
			syncLocalVideoPresentation(video);
			updateLocalTileLabel();
			return !!stream;
		}
		video.setAttribute("playsinline", "");
		video.setAttribute("autoplay", "");
		video.muted = true;
		video.dataset.mcastDesktopLocal = "true";
		if (state.capabilities.screen) { video.dataset.mcastScreenShare = "true"; }
		if (stream && video.srcObject !== stream) {
			video.srcObject = stream;
			logDesktop("stream acquired", summarizeStream(stream));
		}
		if (video.parentNode !== surface) {
			surface.insertBefore(video, surface.firstChild);
		}
		state.boundLocalVideo = video;
		state.boundLocalStream = stream;
		state.boundLocalSurface = surface;
		syncLocalVideoPresentation(video);
		updateLocalTileLabel();
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

	function syncLocalVideoPresentation(video) {
		if (!video || !video.style) {
			return;
		}
		var declaredTransform = String(video.dataset.transform || "").trim();
		var upstreamTransform = declaredTransform || String(video.style.transform || "");
		var transforms = [];
		var mirrored = /scaleX\(\s*-1\s*\)/i.test(upstreamTransform) ||
			(!declaredTransform && video.classList.contains("mirrorControl"));
		var flipped = /scaleY\(\s*-1\s*\)/i.test(upstreamTransform);
		if (mirrored) {
			transforms.push("scaleX(-1)");
		}
		if (flipped) {
			transforms.push("scaleY(-1)");
		}
		var rotation = parseInt(video.dataset.rotated || video.rotated || "0", 10);
		if (!rotation) {
			var rotationMatch = upstreamTransform.match(/rotate\(\s*(-?[0-9.]+)deg\s*\)/i);
			rotation = rotationMatch ? parseFloat(rotationMatch[1]) : 0;
		}
		rotation = ((rotation % 360) + 360) % 360;
		if (rotation) {
			transforms.push("rotate(" + rotation + "deg)");
		}
		video.style.setProperty("--mcast-desktop-video-transform", transforms.join(" ") || "none");
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
		if (state.capabilities.camera) { syncCameraDevices(); }
		if (state.capabilities.microphone) { syncMicDevices(); }
		if (state.experience.kind === "guest") { syncSpeakerDevices(); }
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
		setSelectValue("mcastDesktopCameraSelect", nativeSelect.value || "");
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
		setSelectValue("mcastDesktopMicSelect", active);
	}

	function syncSpeakerDevices() {
		var nativeSelect = byId("outputSource") || byId("outputSource3");
		if (!nativeSelect) {
			setHidden("mcastDesktopSpeakerField", false);
			replaceOptions(byId("mcastDesktopSpeakerSelect"), [], "System default");
			return;
		}
		var options = Array.prototype.map.call(nativeSelect.options || [], function (option) {
			return { value: option.value, text: option.textContent || option.label || "System default" };
		});
		if (!options.length) {
			setHidden("mcastDesktopSpeakerField", false);
			replaceOptions(byId("mcastDesktopSpeakerSelect"), [], "System default");
			return;
		}
		setHidden("mcastDesktopSpeakerField", false);
		replaceOptions(byId("mcastDesktopSpeakerSelect"), options, "System default");
		setSelectValue("mcastDesktopSpeakerSelect", nativeSelect.value || "");
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

	function selectNativeSpeaker(value) {
		var nativeSelect = byId("outputSource") || byId("outputSource3");
		if (!nativeSelect || !hasOption(nativeSelect, value)) {
			setStatus("This speaker is not available.", true);
			return;
		}
		nativeSelect.value = value;
		dispatchNativeChange(nativeSelect);
		setStatus("Speaker updated.");
	}

	function initializeProcessingOptions() {
		var echo = byId("mcastDesktopEchoCancel");
		var noise = byId("mcastDesktopNoiseSuppress");
		var gain = byId("mcastDesktopAutoGain");
		if (window.session) {
			if (echo && typeof window.session.echoCancellation === "boolean") { echo.checked = window.session.echoCancellation; }
			if (noise && typeof window.session.noiseSuppression === "boolean") { noise.checked = window.session.noiseSuppression; }
			if (gain && typeof window.session.autoGainControl === "boolean") { gain.checked = window.session.autoGainControl; }
		}
		applyScreenAudioPreference();
	}

	function applyAudioProcessing() {
		var settings = {
			echoCancellation: !!(byId("mcastDesktopEchoCancel") && byId("mcastDesktopEchoCancel").checked),
			noiseSuppression: !!(byId("mcastDesktopNoiseSuppress") && byId("mcastDesktopNoiseSuppress").checked),
			autoGainControl: !!(byId("mcastDesktopAutoGain") && byId("mcastDesktopAutoGain").checked)
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
			setStatus("Microphone processing updated.");
		}).catch(function () {
			setStatus("This microphone does not support one of the selected options.", true);
		});
	}

	function applyScreenAudioPreference() {
		if (!window.session) {
			return;
		}
		var includeAudio = !!(byId("mcastDesktopScreenAudio") && byId("mcastDesktopScreenAudio").checked);
		window.session.systemAudio = includeAudio ? "include" : "exclude";
		window.session.screenshareVideoOnly = !includeAudio;
	}

	function toggleMute(event) {
		var start = now();
		logDesktop("mute clicked", { muted: isMicMuted(), at: start });
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		var nextEnabled = isMicMuted();
		setAudioTracksEnabled(nextEnabled);
		if (window.session) {
			window.session.muted = !nextEnabled;
		}
		logDesktop("track enabled changed", { enabled: nextEnabled, elapsedMs: Math.round(now() - start) });
		updateDesktopControls();
		logDesktop("UI state updated", { muted: !nextEnabled, elapsedMs: Math.round(now() - start) });
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
		} else if (typeof window.toggleVideoMute === "function") {
			window.toggleVideoMute();
		}
		window.setTimeout(function () {
			bindLocalVideo("camera-toggle");
			updateDesktopControls();
		}, 160);
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
		updateLocalTileLabel(getStoredGuestName() || getSessionGuestName() || "You");
		var sources = Array.prototype.filter.call(document.querySelectorAll("video"), function (video) {
			return video.id !== "previewWebcam" &&
				video.id !== "videosource" &&
				video.id !== "mcastDesktopLocalVideo" &&
				video.dataset.mcastDesktopClone !== "true" &&
				video.srcObject &&
				!isLocalVideoSource(video);
		});
		var existing = {};
		Array.prototype.forEach.call(room.querySelectorAll("[data-source-id]"), function (tile) {
			if (tile.dataset.mcastNativeReturn === "true") {
				return;
			}
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
			label.textContent = getRemoteLabel(source);
			delete existing[id];
		});
		Object.keys(existing).forEach(function (id) {
			existing[id].remove();
		});
		var nativeReturnTileCount = room.querySelectorAll("[data-mcast-native-return='true']").length;
		var tileCount = Math.max(1, sources.length + nativeReturnTileCount + 1);
		grid.dataset.tileCount = String(tileCount);
		setText("mcastDesktopParticipantCount", tileCount + (tileCount === 1 ? " guest" : " guests"));
		if (state.joined && sources.length > 0 && state.step !== "live") {
			setStep("live");
			setStatus("Guests are connected on the studio stage.");
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
		label.textContent = "Remote guest";
		tile.appendChild(video);
		tile.appendChild(label);
		byId("mcastDesktopRemoteTiles").appendChild(tile);
		return tile;
	}

	function bindNativeReturnStream(uuid, stream) {
		var room = byId("mcastDesktopRemoteTiles");
		var grid = byId("mcastDesktopRoomGrid");
		var guestUi = window.MCastGuestUi;
		if (!room || !grid || !stream || !guestUi || typeof guestUi.stageHostReturnVideo !== "function") {
			logDesktop("host return playback unavailable", {});
			return false;
		}

		var id = "mcast-native-return-" + String(uuid || "peer").replace(/[^a-z0-9_-]+/gi, "-");
		var tile = room.querySelector("[data-source-id='" + cssEscape(id) + "']") || createRemoteTile(id);
		tile.classList.add("mcast-desktop__tile--host-return");
		tile.dataset.mcastNativeReturn = "true";
		var label = tile.querySelector(".mcast-desktop__tile-label");
		if (label) {
			label.textContent = "Host feed";
		}
		tile.dataset.mcastPlaybackState = "starting";
		guestUi.stageHostReturnVideo({
			key: "desktop:" + id,
			stream: stream,
			getCurrentVideo: function () {
				return tile.querySelector("video");
			},
			createVideo: function (current) {
				var video = current ? current.cloneNode(false) : document.createElement("video");
				video.autoplay = true;
				video.playsInline = true;
				video.muted = false;
				video.controls = false;
				video.dataset.mcastDesktopClone = "true";
				video.dataset.mcastNativeReturn = "true";
				video.dataset.label = "Host feed";
				return video;
			},
			promote: function (video, previous) {
				if (previous && previous.parentNode === tile) {
					tile.replaceChild(video, previous);
				} else {
					tile.insertBefore(video, tile.firstChild);
				}
			},
			onRetry: function () {
				tile.dataset.mcastPlaybackState = "retrying";
				setStatus("Click or tap to resume the host feed.");
				logDesktop("host return playback waiting for interaction", { uuid: String(uuid || "") });
			},
			onReady: function () {
				tile.dataset.mcastPlaybackState = "playing";
				var tileCount = Math.max(1, room.querySelectorAll("[data-source-id]").length + 1);
				grid.dataset.tileCount = String(tileCount);
				setText("mcastDesktopParticipantCount", tileCount + (tileCount === 1 ? " guest" : " guests"));
				if (state.joined && state.step !== "live") {
					setStep("live");
				}
				setStatus("Host feed connected.");
				logDesktop("native return stream playing", {
					uuid: String(uuid || ""),
					tracks: summarizeStream(stream)
				});
			}
		});
		return true;
	}

	function clearNativeReturnStream(uuid) {
		var room = byId("mcastDesktopRemoteTiles");
		var grid = byId("mcastDesktopRoomGrid");
		if (!room) {
			return;
		}
		var id = uuid ? "mcast-native-return-" + String(uuid).replace(/[^a-z0-9_-]+/gi, "-") : "";
		var tiles = room.querySelectorAll("[data-mcast-native-return='true']");
		Array.prototype.forEach.call(tiles, function (tile) {
			if (id && tile.dataset.sourceId !== id) { return; }
			if (window.MCastGuestUi && typeof window.MCastGuestUi.clearHostReturnPlayback === "function") {
				window.MCastGuestUi.clearHostReturnPlayback("desktop:" + tile.dataset.sourceId);
			}
			var video = tile.querySelector("video");
			if (video) {
				try { video.pause(); } catch (error) {}
				video.srcObject = null;
			}
			tile.remove();
		});
		if (grid) {
			var tileCount = Math.max(1, room.querySelectorAll("[data-source-id]").length + 1);
			grid.dataset.tileCount = String(tileCount);
		}
		if (state.joined && state.step === "live" && !room.querySelector("[data-mcast-native-return='true']")) {
			setStep("backstage");
			setStatus("Waiting for the host feed to reconnect...");
		}
	}

	function getRemoteLabel(source) {
		var candidates = [
			source && source.getAttribute && source.getAttribute("data-label"),
			source && source.dataset && source.dataset.label,
			source && source.dataset && source.dataset.name,
			source && source.dataset && source.dataset.displayName,
			source && source.dataset && source.dataset.nick,
			source && source.getAttribute && source.getAttribute("aria-label"),
			source && source.getAttribute && source.getAttribute("data-name"),
			source && source.getAttribute && source.getAttribute("data-display-name"),
			source && source.title
		];
		for (var i = 0; i < candidates.length; i += 1) {
			var value = String(candidates[i] || "").trim();
			if (value && value.toLowerCase() !== "guest" && value.toLowerCase() !== "remote guest") {
				return value.slice(0, 60);
			}
		}
		return "Guest";
	}

	function applyGuestName() {
		if (document.documentElement.classList.contains("mcast-route-error")) {
			return "";
		}
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
			document.title = name + " - MCast Studio v9";
		} catch (error) {}
		updateLocalTileLabel(name);
		return name;
	}

	function updateLocalTileLabel(name) {
		var label = byId("mcastDesktopLocalTile") && byId("mcastDesktopLocalTile").querySelector(".mcast-desktop__tile-label");
		if (label) {
			label.textContent = (name || getStoredGuestName() || "You").slice(0, 60);
		}
	}

	function getStoredGuestName() {
		var input = byId("mcastDesktopGuestName");
		if (input && input.value.trim()) {
			return input.value.trim();
		}
		try {
			return window.sessionStorage.getItem("mcastGuestName") || "";
		} catch (error) {
			return "";
		}
	}

	function getSessionGuestName() {
		return String((window.session && window.session.label) || (window.MCastRoute && window.MCastRoute.guestName) || "").trim().slice(0, 60);
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
		if (panel && panel.hidden) {
			openSettings();
		} else if (panel) {
			panel.hidden = true;
		}
	}

	function openSettings() {
		var panel = byId("mcastDesktopSettingsPanel");
		if (panel) {
			panel.hidden = false;
			syncDevices();
			var focusTarget = state.capabilities.camera
				? byId("mcastDesktopCameraSelect")
				: state.capabilities.microphone
					? byId("mcastDesktopMicSelect")
					: byId("mcastDesktopScreenAudio");
			if (focusTarget) {
				focusTarget.focus();
			}
		}
	}

	function hideSettings() {
		var panel = byId("mcastDesktopSettingsPanel");
		if (panel) {
			panel.hidden = true;
		}
	}

	function joinWithoutCamera() {
		state.joinWithoutCamera = true;
		applyNoCameraSession();
		setVideoTracksEnabled(false);
		joinRoom();
	}

	function showMediaRecovery(error, retryAction) {
		hideSettings();
		if (!window.MCastGuestUi || typeof window.MCastGuestUi.showMediaError !== "function") {
			return;
		}
		var capability = state.capabilities.screen
			? "screen"
			: state.capabilities.camera && state.capabilities.microphone && !state.joinWithoutCamera
				? "camera and microphone"
				: state.capabilities.microphone ? "microphone" : "camera";
		var actions = [
			{ label: "Close", value: false, variant: "secondary" },
			{ label: "Open settings", value: "settings", variant: "secondary", onSelect: openSettings },
			{ label: "Try again", value: "retry", variant: "primary", onSelect: function () { retryAction(); } }
		];
		if (state.experience.kind === "guest" && state.capabilities.microphone && !state.joinWithoutCamera) {
			actions.splice(2, 0, { label: "Join without camera", value: "audio-only", variant: "secondary", onSelect: joinWithoutCamera });
		}
		window.MCastGuestUi.showMediaError(error, capability, { actions: actions });
	}

	function applyNoCameraSession() {
		if (!window.session) {
			return;
		}
		window.session.videoDevice = 0;
		window.session.videoMuted = true;
	}

	function leaveRoom() {
		finishGuestSession("You are disconnected and free to close this page.", true);
	}

	function finishGuestSession(message, shouldReleaseLease) {
		if (state.disconnecting || state.step === "goodbye") {
			return;
		}
		state.disconnecting = true;
		state.joined = false;
		window.__mcastGuestShellLock = "desktop";
		stopDesktopPolling();
		state.previewStarted = false;
		state.screenTrack = null;
		root.classList.remove("is-joined", "has-preview");
		document.body.classList.remove("mcast-desktop-room-active");
		clearNativeReturnStream("");
		hideSettings();
		setText("mcastDesktopGoodbyeMessage", message || "You are disconnected and free to close this page.");
		setStep("goodbye");
		if (window.MCastNativeWebRtcBridge && typeof window.MCastNativeWebRtcBridge.stop === "function") {
			window.MCastNativeWebRtcBridge.stop({ dispose: true });
		}
		Promise.resolve(tearDownPublishedSession()).then(function (tornDown) {
			if (shouldReleaseLease && tornDown) {
				return releaseInviteLease();
			}
			return false;
		});
	}

	function tearDownPublishedSession() {
		if (window.MCastNativeWebRtcBridge && typeof window.MCastNativeWebRtcBridge.stop === "function") {
			window.MCastNativeWebRtcBridge.stop({ dispose: true });
		}
		var activeSession = window.session;
		if (!activeSession) {
			return Promise.resolve(true);
		}
		if (typeof activeSession.hangup !== "function") {
			return Promise.resolve(false);
		}
		var retainedUi = captureOwnedGuestUi();
		try {
			activeSession.hangup(false, false);
			restoreOwnedGuestUi(retainedUi);
			return Promise.resolve(true);
		} catch (error) {
			restoreOwnedGuestUi(retainedUi);
			logDesktop("session teardown failed", { name: error && error.name });
			return Promise.resolve(false);
		}
	}

	function captureOwnedGuestUi() {
		return ["mcastDesktopGuest", "mcastMobileGuest", "mcastGuestUiRoot"].map(byId).filter(Boolean);
	}

	function restoreOwnedGuestUi(elements) {
		if (!document.body) {
			return;
		}
		elements.forEach(function (element) {
			if (!element.isConnected) {
				document.body.appendChild(element);
			}
		});
	}

	function reloadGuestPage() {
		window.location.reload();
	}

	function watchScreenShareEnded() {
		var stream = getScreenStream();
		var tracks = stream && stream.getVideoTracks ? stream.getVideoTracks() : [];
		var track = tracks[0];
		if (!track || state.screenTrack === track) {
			return;
		}
		state.screenTrack = track;
		track.addEventListener("ended", function () {
			if (!state.joined) { return; }
			finishGuestSession("Screen sharing has stopped. You are free to close this page.", true);
		});
	}

	function claimInviteLease() {
		if (!window.MCastGuestUi || typeof window.MCastGuestUi.claimInviteLease !== "function") {
			return Promise.reject(new Error("Guest connection service is unavailable"));
		}
		return window.MCastGuestUi.claimInviteLease();
	}

	function releaseInviteLease() {
		if (!window.MCastGuestUi || typeof window.MCastGuestUi.releaseInviteLease !== "function") {
			return Promise.resolve(false);
		}
		return window.MCastGuestUi.releaseInviteLease();
	}

	function isInviteLeaseError(error) {
		return !!(window.MCastGuestUi && typeof window.MCastGuestUi.isInviteLeaseError === "function" &&
			window.MCastGuestUi.isInviteLeaseError(error));
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
				updateDesktopControls();
				setStatus(enabled ? "Host enabled your microphone." : "Host muted your microphone.");
				return true;
			},
			setVideoEnabled: function (enabled) {
				enabled = !!enabled;
				setVideoTracksEnabled(enabled);
				if (window.session) {
					window.session.videoMuted = !enabled;
				}
				bindLocalVideo("native-camera-command");
				updateDesktopControls();
				setStatus(enabled ? "Host enabled your camera." : "Host disabled your camera.");
				return true;
			},
			setPresence: function (payload) {
				var presence = String(payload && (payload.presenceState || payload.participantState) || "").toLowerCase();
				if (presence === "onscreen") {
					setStep("live");
					setStatus("The host moved you on screen.");
				} else if (presence === "removed") {
					leaveRoom();
				} else {
					setStep("backstage");
					setStatus("You are backstage.");
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

	function setStatus(message, isError) {
		message = String(message || "");
		state.lastStatus = message;
		var loading = byId("mcastDesktopLoadingStatus");
		if (loading && state.step === "loading") {
			loading.textContent = message;
			return;
		}
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

	function setButtonBusy(id, busy, label) {
		var button = byId(id);
		if (!button) {
			return;
		}
		button.disabled = !!busy;
		if (button.classList.contains("mcast-desktop__icon-button") || button.classList.contains("mcast-desktop__round-control")) {
			setButtonText(id, label);
		} else {
			button.textContent = label;
		}
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
		return byId("videosource") || byId("previewWebcam") || byId("mcastDesktopLocalVideo");
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
		return byId("screensharesource") || byId("mcastDesktopScreenVideo");
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

	function isLocalVideoSource(video) {
		if (!video) {
			return false;
		}
		if (video.closest && video.closest("#mcastDesktopLocalTile, #mcastDesktopPreviewSurface")) {
			return true;
		}
		var stream = video.srcObject;
		var localStream = getLocalStream(getLocalVideoElement());
		if (stream && localStream && (stream === localStream || stream.id === localStream.id)) {
			return true;
		}
		var sessionVideo = window.session && window.session.videoElement;
		if (sessionVideo && video === sessionVideo) {
			return true;
		}
		return false;
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
		return state.capabilities.camera && !state.joinWithoutCamera ? waitForPreview(timeout) : waitForLocalStream(timeout);
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
		var button = byId(id);
		if (!button) {
			return;
		}
		var icon = button.dataset.icon || "";
		if (icon) {
			button.dataset.label = text;
			button.innerHTML = icon + "<span>" + escapeHtml(text) + "</span>";
			button.setAttribute("aria-label", text);
		} else {
			button.textContent = text;
		}
	}

	function decorateDesktopButtons() {
		setIconButton("mcastDesktopMicToggle", icons.mic, "Mute");
		setIconButton("mcastDesktopCameraToggle", icons.camera, "Camera");
		setIconButton("mcastDesktopPreviewButton", icons.preview, "Preview");
		setIconButton("mcastDesktopRoomMicButton", icons.mic, "Mic");
		setIconButton("mcastDesktopRoomCameraButton", icons.camera, "Camera");
		setIconButton("mcastDesktopSettingsButton", icons.settings, "Settings");
		setIconButton("mcastDesktopLeaveButton", icons.leave, "Leave");
	}

	function guardDesktopLogo() {
		var logo = document.querySelector(".mcast-desktop__logo");
		if (!logo) {
			return;
		}
		logo.addEventListener("error", function () {
			logo.classList.add("is-logo-missing");
			logo.removeAttribute("src");
		});
		if (logo.complete && !logo.naturalWidth) {
			logo.classList.add("is-logo-missing");
		}
	}

	function setIconButton(id, icon, label) {
		var button = byId(id);
		if (!button) {
			return;
		}
		button.dataset.icon = icon;
		setButtonText(id, label);
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

	function toggleClass(id, className, enabled) {
		var element = byId(id);
		if (element) {
			element.classList.toggle(className, !!enabled);
		}
	}

	function setHidden(id, hidden) {
		var element = byId(id);
		if (element) { element.hidden = !!hidden; }
	}

	function getPermissionMessage(error) {
		var capability = state.capabilities.screen
			? "screen"
			: state.capabilities.camera && state.capabilities.microphone && !state.joinWithoutCamera
				? "camera and microphone"
				: state.capabilities.microphone ? "microphone" : "camera";
		if (window.MCastGuestUi && typeof window.MCastGuestUi.safeErrorMessage === "function") {
			return window.MCastGuestUi.safeErrorMessage(error, capability);
		}
		return "The selected media could not start. Check browser permission and try again.";
	}

	function summarizeError(error) {
		return {
			name: error && error.name,
			message: error && error.message,
			constraint: error && error.constraint
		};
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

	function byId(id) {
		return document.getElementById(id);
	}
}());
