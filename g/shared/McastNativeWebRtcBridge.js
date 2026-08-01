(function () {
	"use strict";

	var state = {
		started: false,
		timer: 0,
		attempts: 0,
		attached: {},
		dataChannels: {},
		peers: {},
		media: {}
	};

	var mcastNativeRenegotiationAttempts = 0;

	function isRequested() {
		try {
			var params = new URLSearchParams(window.location.search || "");
			return params.has("mcastnativewebrtc") ||
				params.has("mcastnative") ||
				!!(window.MCastRoute && window.MCastRoute.nativeWebRtcRequested === true);
		} catch (error) {
			return false;
		}
	}

	function start(options) {
		if (state.started && state.timer) {
			return false;
		}

		if (!isRequested()) {
			return false;
		}

		options = options || {};
		state.started = true;
		state.attempts = 0;
		state.getLocalStream = typeof options.getLocalStream === "function" ? options.getLocalStream : null;
		state.log = typeof options.log === "function" ? options.log : log;
		state.onState = typeof options.onState === "function" ? options.onState : null;
		state.maxAttempts = Math.max(10, parseInt(options.maxAttempts, 10) || 80);
		state.intervalMs = Math.max(250, parseInt(options.intervalMs, 10) || 500);
		state.log("MCast native WebRTC media bridge armed", {});
		state.timer = window.setInterval(tick, state.intervalMs);
		tick();
		return true;
	}

	function stop() {
		if (state.timer) {
			window.clearInterval(state.timer);
			state.timer = 0;
		}
		state.started = false;
	}

	function tick() {
		state.attempts += 1;
		if (state.attempts > state.maxAttempts) {
			state.log("MCast native WebRTC media bridge timed out waiting for peer", {});
			stop();
			return;
		}

		if (!window.session || typeof state.getLocalStream !== "function") {
			return;
		}

		var stream = state.getLocalStream();
		if (!isUsableStream(stream)) {
			return;
		}

		var peers = collectPeerConnections();
		if (!peers.length && state.attempts === 1) {
			state.log("MCast native WebRTC waiting for VDO peer", {
				pcs: countObjectKeys(window.session.pcs),
				rpcs: countObjectKeys(window.session.rpcs)
			});
		}

		for (var index = 0; index < peers.length; index += 1) {
			hookPeerDataChannels(peers[index].uuid, peers[index].pc);
			attachPeerIfReady(peers[index].uuid, peers[index].pc, stream);
		}
	}

	function collectPeerConnections() {
		var peers = [];
		collectPeerConnectionsFrom(window.session && window.session.pcs, "pcs", peers);
		collectPeerConnectionsFrom(window.session && window.session.rpcs, "rpcs", peers);
		return peers;
	}

	function collectPeerConnectionsFrom(collection, name, peers) {
		if (!collection || typeof collection !== "object") {
			return;
		}

		Object.keys(collection).forEach(function (uuid) {
			var pc = collection[uuid];
			if (!isPeerConnectionLike(pc)) {
				return;
			}

			state.peers[uuid] = pc;
			peers.push({ uuid: uuid, pc: pc, collection: name });
		});
	}

	function isPeerConnectionLike(pc) {
		return !!(pc &&
			typeof pc.getSenders === "function" &&
			typeof pc.createOffer === "function" &&
			typeof pc.setLocalDescription === "function");
	}

	function countObjectKeys(value) {
		if (!value || typeof value !== "object") {
			return 0;
		}

		try {
			return Object.keys(value).length;
		} catch (error) {
			return 0;
		}
	}

	function attachPeerIfReady(uuid, pc, stream) {
		if (!uuid || !pc || state.attached[uuid] || pc.mcastNativeMediaAttached) {
			return;
		}

		if (pc.signalingState && pc.signalingState !== "stable") {
			return;
		}

		if (typeof pc.getSenders !== "function") {
			return;
		}

		var tracks = stream.getTracks().filter(isLiveTrack);
		if (!tracks.length) {
			return;
		}

		var existingSenders = pc.getSenders();
		var addedKinds = [];
		var beforeSenders = summarizeSenders(existingSenders);
		tracks.forEach(function (track) {
			if (!track || !track.kind || hasSenderForKind(existingSenders, track.kind)) {
				return;
			}

			try {
				if (typeof pc.addTransceiver === "function") {
					pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
				} else if (typeof pc.addTrack === "function") {
					pc.addTrack(track, stream);
				} else {
					return;
				}
				addedKinds.push(track.kind);
			} catch (error) {
				try {
					if (typeof pc.addTrack === "function") {
						pc.addTrack(track, stream);
						addedKinds.push(track.kind);
					}
				} catch (fallbackError) {
					state.log("MCast native WebRTC track attach failed", {
						kind: track.kind,
						name: fallbackError && fallbackError.name
					});
				}
			}
		});

		if (!addedKinds.length) {
			return;
		}

		state.attached[uuid] = true;
		pc.mcastNativeMediaAttached = true;
		state.log("MCast native WebRTC media tracks attached", {
			uuid: safeId(uuid),
			kinds: addedKinds.join(","),
			tracks: summarizeStream(stream),
			sendersBefore: beforeSenders,
			sendersAfter: summarizeSenders(pc.getSenders ? pc.getSenders() : [])
		});

		if (state.onState) {
			state.onState("media-attached", uuid, addedKinds);
		}

		renegotiate(uuid, pc);
		stop();
	}

	function hookPeerDataChannels(uuid, pc) {
		if (!uuid || !pc || pc.mcastNativeDataHooked) {
			return;
		}

		pc.mcastNativeDataHooked = true;
		if (typeof pc.addEventListener === "function") {
			pc.addEventListener("datachannel", function (event) {
				hookDataChannel(uuid, event && event.channel);
			});
		} else {
			var previous = pc.ondatachannel;
			pc.ondatachannel = function (event) {
				if (typeof previous === "function") {
					previous.call(pc, event);
				}
				hookDataChannel(uuid, event && event.channel);
			};
		}

		["dataChannel", "channel", "dc", "mcastNativeDataChannel"].forEach(function (name) {
			hookDataChannel(uuid, pc[name]);
		});
	}

	function hookDataChannel(uuid, channel) {
		if (!channel || !channel.label || channel.mcastNativeCommandHooked) {
			return;
		}

		channel.mcastNativeCommandHooked = true;
		state.dataChannels[uuid + ":" + channel.label] = channel;
		channel.addEventListener("message", function (event) {
			handleDataChannelMessage(uuid, channel, event && event.data);
		});
		channel.addEventListener("open", function () {
			state.log("MCast native WebRTC command channel open", { uuid: safeId(uuid), label: channel.label });
			var pc = state.peers[uuid];
			if (pc && state.attached[uuid]) {
				createFallbackOfferWhenStable(uuid, pc, 0);
			}
		});
		channel.addEventListener("close", function () {
			delete state.dataChannels[uuid + ":" + channel.label];
		});
		if (channel.readyState === "open") {
			var pc = state.peers[uuid];
			if (pc && state.attached[uuid]) {
				createFallbackOfferWhenStable(uuid, pc, 0);
			}
		}
	}

	function handleDataChannelMessage(uuid, channel, raw) {
		var message = parseJson(raw);
		if (!message) {
			sendCommandAck(channel, "", "", false, "invalid-json");
			return;
		}

		if (message.description && String(message.description.type || "").toLowerCase() === "answer") {
			applyNativeAnswer(uuid, message.description);
			return;
		}

		if (message.candidate) {
			applyNativeCandidate(uuid, message.candidate);
			return;
		}

		if (Array.isArray(message.candidates)) {
			message.candidates.forEach(function (candidate) {
				applyNativeCandidate(uuid, candidate);
			});
			return;
		}

		var command = String(message.command || message.Command || "").trim();
		var payload = parsePayload(message.payloadJson || message.PayloadJson || message.payload || message.Payload);
		if (!isControlMessage(message, command)) {
			return;
		}

		var result = applyControlCommand(command, payload);
		sendCommandAck(channel, message.correlationId || message.CorrelationId || "", command, result.ok, result.error || "");
		if (state.onState) {
			state.onState(result.ok ? "command-applied" : "command-failed", uuid, [command]);
		}
	}

	function isControlMessage(message, command) {
		var messageType = message.messageType !== undefined ? message.messageType : message.MessageType;
		var type = String(message.type || message.kind || "").toLowerCase();
		return !!command && (messageType === 6 || String(messageType).toLowerCase() === "control" || type === "control");
	}

	function applyControlCommand(command, payload) {
		var controls = window.MCastNativeGuestControls || {};
		try {
			switch (command) {
				case "mcast.guest.setAudioEnabled":
					return callControl(controls.setAudioEnabled, normalizeBool(payload.audioEnabled, true));
				case "mcast.guest.setVideoEnabled":
					return callControl(controls.setVideoEnabled, normalizeBool(payload.videoEnabled, true));
				case "mcast.guest.setPresence":
					return callControl(controls.setPresence, payload);
				case "mcast.guest.disconnect":
					return callControl(controls.disconnect, payload);
				case "mcast.guest.play":
				case "mcast.guest.startMedia":
					return callControl(controls.startMedia, payload);
				default:
					return { ok: false, error: "unsupported-command" };
			}
		} catch (error) {
			return { ok: false, error: error && error.name ? error.name : "command-error" };
		}
	}

	function callControl(callback, payload) {
		if (typeof callback !== "function") {
			return { ok: false, error: "control-unavailable" };
		}

		var value = callback(payload);
		return { ok: value !== false };
	}

	function parsePayload(value) {
		if (!value) {
			return {};
		}
		if (typeof value === "object") {
			return value;
		}
		return parseJson(value) || {};
	}

	function parseJson(value) {
		if (typeof value !== "string") {
			return value && typeof value === "object" ? value : null;
		}
		try {
			return JSON.parse(value);
		} catch (error) {
			return null;
		}
	}

	function normalizeBool(value, fallback) {
		if (value === true || value === false) {
			return value;
		}
		if (typeof value === "string") {
			var normalized = value.trim().toLowerCase();
			if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
				return true;
			}
			if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
				return false;
			}
		}
		return !!fallback;
	}

	function sendCommandAck(channel, correlationId, command, ok, error) {
		if (!channel || channel.readyState !== "open" || typeof channel.send !== "function") {
			return;
		}
		try {
			channel.send(JSON.stringify({
				type: "mcastCommandAck",
				correlationId: correlationId || "",
				command: command || "",
				ok: !!ok,
				error: ok ? "" : (error || "failed")
			}));
		} catch (sendError) {}
	}

	function getMediaState(uuid) {
		if (!state.media[uuid]) {
			state.media[uuid] = {
				iceCandidatesQueued: [],
				localCandidateHandlerAttached: false,
				mediaOfferInFlight: false,
				mediaOfferSent: false,
				lastOfferSignature: ""
			};
		}
		return state.media[uuid];
	}

	function getOpenNativeChannel(uuid) {
		var prefix = uuid + ":";
		var keys = Object.keys(state.dataChannels);
		for (var index = 0; index < keys.length; index += 1) {
			var key = keys[index];
			var channel = state.dataChannels[key];
			if (key.indexOf(prefix) === 0 && channel && channel.readyState === "open" && typeof channel.send === "function") {
				return channel;
			}
		}
		return null;
	}

	function sendJson(channel, payload) {
		if (!channel || channel.readyState !== "open" || typeof channel.send !== "function") {
			return false;
		}
		try {
			channel.send(JSON.stringify(payload));
			return true;
		} catch (error) {
			return false;
		}
	}

	function sendBridgeDebug(uuid, stage, reason, stream) {
		var channel = getOpenNativeChannel(uuid);
		if (!channel) {
			return;
		}
		var summary = summarizeStream(stream || (state.getLocalStream ? state.getLocalStream() : null));
		sendJson(channel, {
			type: "mcastBridgeDebug",
			mcastBridgeDebug: "1",
			stage: stage || "",
			reason: reason || "",
			tracks: "V" + summary.videoLive + "A" + summary.audioLive,
			channel: channel.readyState || "",
			signaling: state.peers[uuid] && state.peers[uuid].signalingState || "",
			uuid: uuid || ""
		});
	}

	function getRouteParams() {
		try {
			if (window.urlParams && typeof window.urlParams.get === "function") {
				return window.urlParams;
			}
		} catch (error) {}
		try {
			if (window.session && window.session.decrypted) {
				return new URLSearchParams(String(window.session.decrypted || "").replace(/^\?/, ""));
			}
		} catch (error) {}
		try {
			return new URLSearchParams(window.location.search || "");
		} catch (error) {
			return new URLSearchParams("");
		}
	}

	function readParam(params, name) {
		try {
			var value = params.get(name);
			return value === null ? "" : String(value || "").trim();
		} catch (error) {
			return "";
		}
	}

	function getGuestIdentity() {
		var params = getRouteParams();
		var streamId = readParam(params, "mcaststreamid") ||
			readParam(params, "mcastguestkey") ||
			readParam(params, "push") ||
			(window.session && window.session.streamID) ||
			"";
		var guestKey = readParam(params, "mcastguestkey") || streamId;
		return {
			streamId: streamId,
			guestKey: guestKey,
			label: readParam(params, "l") || readParam(params, "label") || "",
			sessionId: ""
		};
	}

	function buildTrackSignature(stream) {
		try {
			return stream.getTracks().map(function (track) {
				return track.kind + ":" + track.id + ":" + track.readyState + ":" + (track.enabled ? "1" : "0");
			}).sort().join("|");
		} catch (error) {
			return "";
		}
	}

	function hasMediaSections(sdp) {
		return /(?:^|\r?\n)m=video\s/i.test(sdp || "") || /(?:^|\r?\n)m=audio\s/i.test(sdp || "");
	}

	function renegotiate(uuid, pc) {
		mcastNativeRenegotiationAttempts += 1;
		state.log("MCast native WebRTC media renegotiation start", {
			uuid: safeId(uuid),
			attempt: mcastNativeRenegotiationAttempts,
			signalingState: pc && pc.signalingState || "",
			currentDescription: summarizeDescription(pc && pc.localDescription)
		});

		if (getOpenNativeChannel(uuid)) {
			sendBridgeDebug(uuid, "renegotiate", "direct-channel");
			createFallbackOfferWhenStable(uuid, pc, 0);
			return;
		}

		try {
			if (window.session && typeof window.session.createOffer === "function") {
				var result = window.session.createOffer(uuid, true);
				state.log("MCast native WebRTC renegotiation requested", {
					uuid: safeId(uuid),
					method: "session.createOffer"
				});
				if (result && typeof result.then === "function") {
					result
						.then(function () {
							state.log("MCast native WebRTC session offer completed", {
								uuid: safeId(uuid),
								description: summarizeDescription(pc && pc.localDescription)
							});
						})
						.catch(function (error) {
							state.log("MCast native WebRTC session.createOffer failed", { name: error && error.name });
							createFallbackOfferWhenStable(uuid, pc, 0);
						});
				}
				window.setTimeout(function () {
					verifyMediaOffer(uuid, pc);
				}, 1200);
				return;
			}
		} catch (error) {
			state.log("MCast native WebRTC session.createOffer failed", { name: error && error.name });
		}

		createFallbackOfferWhenStable(uuid, pc, 0);
	}

	function verifyMediaOffer(uuid, pc) {
		var description = summarizeDescription(pc && pc.localDescription);
		state.log("MCast native WebRTC media offer verification", {
			uuid: safeId(uuid),
			signalingState: pc && pc.signalingState || "",
			description: description
		});

		if (description.audio || description.video) {
			if (getOpenNativeChannel(uuid)) {
				sendBridgeDebug(uuid, "verify", "media-local");
				createFallbackOfferWhenStable(uuid, pc, 0);
			}
			return;
		}

		createFallbackOfferWhenStable(uuid, pc, 0);
	}

	function createFallbackOfferWhenStable(uuid, pc, attempt) {
		attempt = attempt || 0;
		if (pc && pc.signalingState && pc.signalingState !== "stable") {
			if (pc.signalingState === "have-local-offer" &&
				pc.localDescription &&
				hasMediaSections(pc.localDescription.sdp) &&
				getOpenNativeChannel(uuid)) {
				try {
					sendNativeMediaOffer(uuid, pc, pc.localDescription, buildTrackSignature(state.getLocalStream ? state.getLocalStream() : null));
				} catch (error) {
					state.log("MCast native WebRTC existing offer send failed", { uuid: safeId(uuid), name: error && error.name });
				}
				return;
			}

			if (attempt >= 12) {
				state.log("MCast native WebRTC fallback offer abandoned", {
					uuid: safeId(uuid),
					signalingState: pc.signalingState
				});
				return;
			}

			state.log("MCast native WebRTC fallback offer deferred", {
				uuid: safeId(uuid),
				signalingState: pc.signalingState,
				attempt: attempt + 1
			});
			window.setTimeout(function () {
				createFallbackOfferWhenStable(uuid, pc, attempt + 1);
			}, 350);
			return;
		}

		createFallbackOffer(uuid, pc);
	}

	function createFallbackOffer(uuid, pc) {
		if (!pc || typeof pc.createOffer !== "function" || typeof pc.setLocalDescription !== "function") {
			state.log("MCast native WebRTC fallback offer unavailable", { uuid: safeId(uuid) });
			return;
		}

		var mediaState = getMediaState(uuid);
		if (mediaState.mediaOfferInFlight) {
			return;
		}

		var channel = getOpenNativeChannel(uuid);
		if (!channel) {
			sendBridgeDebug(uuid, "blocked", "no-channel", stream);
			state.log("MCast native WebRTC direct offer deferred: channel unavailable", { uuid: safeId(uuid) });
			return;
		}

		var stream = state.getLocalStream ? state.getLocalStream() : null;
		if (!isUsableStream(stream)) {
			sendBridgeDebug(uuid, "blocked", "no-stream", stream);
			state.log("MCast native WebRTC direct offer deferred: stream unavailable", { uuid: safeId(uuid) });
			return;
		}

		var signature = buildTrackSignature(stream);
		if (mediaState.mediaOfferSent && mediaState.lastOfferSignature === signature) {
			sendBridgeDebug(uuid, "blocked", "same-tracks", stream);
			return;
		}

		mediaState.mediaOfferInFlight = true;
		attachLocalCandidateRelay(uuid, pc);
		pc.createOffer({
				offerToReceiveAudio: false,
				offerToReceiveVideo: false
			})
			.then(function (offer) {
				if (!offer || !hasMediaSections(offer.sdp)) {
					throw { name: "offer-without-media" };
				}
				return pc.setLocalDescription(offer).then(function () {
				return pc.localDescription || offer;
			});
		})
		.then(function (description) {
			sendNativeMediaOffer(uuid, pc, description, signature);
		})
			.catch(function (error) {
				mediaState.mediaOfferSent = false;
				mediaState.lastOfferSignature = "";
				state.log("MCast native WebRTC direct offer failed", { name: error && error.name });
			})
			.then(function () {
				mediaState.mediaOfferInFlight = false;
			});
	}

	function sendNativeMediaOffer(uuid, pc, description, signature) {
		var channel = getOpenNativeChannel(uuid);
		if (!channel || !description || !description.sdp || !hasMediaSections(description.sdp)) {
			throw { name: "native-offer-unavailable" };
		}

		var identity = getGuestIdentity();
		var payload = {
			UUID: uuid,
			uuid: uuid,
			streamID: identity.streamId,
			streamId: identity.streamId,
			viewId: identity.streamId,
			guestKey: identity.streamId,
			mcastGuestKey: identity.guestKey,
			label: identity.label,
			session: pc && (pc.session || pc.mcastSession) || "",
			description: {
				type: description.type,
				sdp: description.sdp
			}
		};

		if (!sendJson(channel, payload)) {
			throw { name: "native-channel-send-failed" };
		}

		var mediaState = getMediaState(uuid);
		mediaState.mediaOfferSent = true;
		mediaState.lastOfferSignature = signature || mediaState.lastOfferSignature || "";
		sendBridgeDebug(uuid, "offer-sent", "direct", state.getLocalStream ? state.getLocalStream() : null);
		state.log("MCast native WebRTC direct media offer sent", {
			uuid: safeId(uuid),
			description: summarizeDescription(description)
		});
	}

	function attachLocalCandidateRelay(uuid, pc) {
		var mediaState = getMediaState(uuid);
		if (!pc || mediaState.localCandidateHandlerAttached) {
			return;
		}

		mediaState.localCandidateHandlerAttached = true;
		if (typeof pc.addEventListener !== "function") {
			return;
		}

		pc.addEventListener("icecandidate", function (event) {
			if (!event || !event.candidate) {
				return;
			}

			var channel = getOpenNativeChannel(uuid);
			if (!channel) {
				return;
			}

			var identity = getGuestIdentity();
			sendJson(channel, {
				type: "candidate",
				streamID: identity.streamId,
				streamId: identity.streamId,
				viewId: identity.streamId,
				guestKey: identity.streamId,
				mcastGuestKey: identity.guestKey,
				UUID: uuid,
				uuid: uuid,
				candidate: {
					candidate: event.candidate.candidate,
					sdpMid: event.candidate.sdpMid,
					sdpMLineIndex: event.candidate.sdpMLineIndex,
					usernameFragment: event.candidate.usernameFragment
				}
			});
		});
	}

	function applyNativeAnswer(uuid, description) {
		var pc = state.peers[uuid];
		if (!pc || !description || !description.sdp || String(description.type || "").toLowerCase() !== "answer") {
			return;
		}

		try {
			if (pc.signalingState && pc.signalingState !== "have-local-offer") {
				return;
			}

			Promise.resolve(pc.setRemoteDescription(description))
				.then(function () {
					var mediaState = getMediaState(uuid);
					while (mediaState.iceCandidatesQueued.length) {
						applyNativeCandidate(uuid, mediaState.iceCandidatesQueued.shift());
					}
					sendBridgeDebug(uuid, "answer-applied", "direct");
					state.log("MCast native WebRTC answer applied", { uuid: safeId(uuid) });
				})
				.catch(function (error) {
					state.log("MCast native WebRTC answer failed", { uuid: safeId(uuid), name: error && error.name });
				});
		} catch (error) {
			state.log("MCast native WebRTC answer failed", { uuid: safeId(uuid), name: error && error.name });
		}
	}

	function applyNativeCandidate(uuid, candidate) {
		var pc = state.peers[uuid];
		if (!pc || !candidate) {
			return;
		}

		try {
			if (typeof candidate === "string") {
				candidate = { candidate: candidate };
			}
			if (candidate.candidate && /^a=candidate:/i.test(candidate.candidate)) {
				candidate = Object.assign({}, candidate, { candidate: candidate.candidate.substring(2) });
			}
			var ice = new RTCIceCandidate(candidate);
			if (!pc.remoteDescription) {
				getMediaState(uuid).iceCandidatesQueued.push(ice);
				return;
			}
			Promise.resolve(pc.addIceCandidate(ice)).catch(function (error) {
				state.log("MCast native WebRTC candidate failed", { uuid: safeId(uuid), name: error && error.name });
			});
		} catch (error) {
			state.log("MCast native WebRTC candidate failed", { uuid: safeId(uuid), name: error && error.name });
		}
	}

	function hasSenderForKind(senders, kind) {
		for (var index = 0; index < senders.length; index += 1) {
			var sender = senders[index];
			if (sender && sender.track && sender.track.kind === kind && sender.track.readyState !== "ended") {
				return true;
			}
		}
		return false;
	}

	function isUsableStream(stream) {
		return !!(stream && typeof stream.getTracks === "function" && stream.getTracks().some(isLiveTrack));
	}

	function summarizeStream(stream) {
		var tracks = stream && typeof stream.getTracks === "function" ? stream.getTracks() : [];
		var audio = tracks.filter(function (track) { return track && track.kind === "audio"; });
		var video = tracks.filter(function (track) { return track && track.kind === "video"; });
		return {
			audioTracks: audio.length,
			videoTracks: video.length,
			audioLive: audio.filter(isLiveTrack).length,
			videoLive: video.filter(isLiveTrack).length,
			audioEnabled: audio.filter(function (track) { return track && track.enabled; }).length,
			videoEnabled: video.filter(function (track) { return track && track.enabled; }).length
		};
	}

	function summarizeSenders(senders) {
		senders = senders || [];
		var audio = 0;
		var video = 0;
		for (var index = 0; index < senders.length; index += 1) {
			var track = senders[index] && senders[index].track;
			if (!track || track.readyState === "ended") {
				continue;
			}
			if (track.kind === "audio") {
				audio += 1;
			} else if (track.kind === "video") {
				video += 1;
			}
		}
		return {
			audioSenders: audio,
			videoSenders: video
		};
	}

	function summarizeDescription(description) {
		var sdp = description && typeof description.sdp === "string" ? description.sdp : "";
		return {
			type: description && description.type || "",
			mediaSections: sdp ? Math.max(0, sdp.split(/\r?\nm=/).length - 1) : 0,
			audio: /\r?\nm=audio\s/i.test(sdp),
			video: /\r?\nm=video\s/i.test(sdp),
			application: /\r?\nm=application\s/i.test(sdp)
		};
	}

	function isLiveTrack(track) {
		return !!track && track.readyState !== "ended";
	}

	function safeId(value) {
		value = String(value || "");
		return value.length > 10 ? value.substring(0, 6) + "..." + value.substring(value.length - 4) : value;
	}

	function log(message, details) {
		try {
			console.info("[MCast native WebRTC]", message, details || {});
		} catch (error) {}
	}

	window.MCastNativeWebRtcBridge = {
		isRequested: isRequested,
		start: start,
		stop: stop,
		debugSnapshot: function () {
			return {
				started: state.started,
				attempts: state.attempts,
				attachedPeers: Object.keys(state.attached).length,
				renegotiationAttempts: mcastNativeRenegotiationAttempts
			};
		}
	};
}());
