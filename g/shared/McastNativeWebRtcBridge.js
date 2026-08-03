(function () {
	"use strict";

	var state = {
		started: false,
		timer: 0,
		attempts: 0,
		attached: {},
		attaching: {},
		dataChannels: {},
		peers: {},
		media: {},
		returnStreams: {},
		returnElements: {}
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
		state.onRemoteStream = typeof options.onRemoteStream === "function" ? options.onRemoteStream : null;
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
			hookPeerReturnTracks(peers[index].uuid, peers[index].pc);
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
		if (!uuid || !pc || state.attached[uuid] || state.attaching[uuid] || pc.mcastNativeMediaAttached) {
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
		var boundKinds = [];
		var pending = [];
		var beforeSenders = summarizeSenders(existingSenders);
		tracks.forEach(function (track) {
			var binding;
			if (!track || !track.kind) {
				return;
			}

			try {
				binding = bindLocalTrackToPeer(pc, existingSenders, track, stream);
				if (!binding || !binding.kind) {
					return;
				}
				boundKinds.push(binding.kind + ":" + binding.action);
				if (binding.promise && typeof binding.promise.then === "function") {
					pending.push(binding.promise);
				}
			} catch (error) {
				state.log("MCast native WebRTC track attach failed", {
					kind: track.kind,
					name: error && error.name
				});
			}
		});

		if (!boundKinds.length) {
			return;
		}

		state.attaching[uuid] = true;
		Promise.all(pending)
			.then(function () {
				state.attached[uuid] = true;
				pc.mcastNativeMediaAttached = true;
				delete state.attaching[uuid];
				state.log("MCast native WebRTC media tracks attached", {
					uuid: safeId(uuid),
					kinds: boundKinds.join(","),
					tracks: summarizeStream(stream),
					sendersBefore: beforeSenders,
					sendersAfter: summarizeSenders(pc.getSenders ? pc.getSenders() : [])
				});

				if (state.onState) {
					state.onState("media-attached", uuid, boundKinds);
				}

				renegotiate(uuid, pc);
				stop();
			})
			.catch(function (error) {
				delete state.attaching[uuid];
				state.log("MCast native WebRTC track attach failed", {
					uuid: safeId(uuid),
					name: error && error.name
				});
			});
	}

	function hookPeerReturnTracks(uuid, pc) {
		if (!uuid || !pc || pc.mcastNativeReturnHooked) {
			return;
		}

		pc.mcastNativeReturnHooked = true;
		var handler = function (event) {
			handleReturnTrack(uuid, event);
		};
		if (typeof pc.addEventListener === "function") {
			pc.addEventListener("track", handler);
			return;
		}

		var previous = pc.ontrack;
		pc.ontrack = function (event) {
			if (typeof previous === "function") {
				previous.call(pc, event);
			}
			handler(event);
		};
	}

	function handleReturnTrack(uuid, event) {
		var track = event && event.track;
		if (!isLiveTrack(track)) {
			return;
		}

		var stream = resolveReturnStream(uuid, event, track);
		if (!stream) {
			return;
		}

		state.returnStreams[uuid] = stream;
		state.log("MCast native WebRTC return stream received", {
			uuid: safeId(uuid),
			kind: track.kind || "",
			tracks: summarizeStream(stream)
		});
		if (state.onRemoteStream) {
			state.onRemoteStream(uuid, stream, track.kind || "");
		} else {
			ensureDefaultReturnPlayback(uuid, stream);
		}
		if (state.onState) {
			state.onState("return-stream", uuid, [track.kind || "media"]);
		}
	}

	function resolveReturnStream(uuid, event, track) {
		var streams = event && event.streams;
		if (streams && streams.length && streams[0]) {
			return streams[0];
		}

		var stream = state.returnStreams[uuid];
		var MediaStreamCtor = window.MediaStream || (typeof MediaStream === "function" ? MediaStream : null);
		if (!stream && MediaStreamCtor) {
			stream = new MediaStreamCtor();
			state.returnStreams[uuid] = stream;
		}
		if (!stream || typeof stream.addTrack !== "function") {
			return null;
		}

		var exists = false;
		var tracks = typeof stream.getTracks === "function" ? stream.getTracks() : [];
		for (var index = 0; index < tracks.length; index += 1) {
			if (tracks[index] === track || (tracks[index] && track && tracks[index].id === track.id)) {
				exists = true;
				break;
			}
		}
		if (!exists) {
			stream.addTrack(track);
		}
		return stream;
	}

	function ensureDefaultReturnPlayback(uuid, stream) {
		if (!stream || typeof document === "undefined" || !document.body) {
			return;
		}

		var videoTracks = stream.getVideoTracks ? stream.getVideoTracks().filter(isLiveTrack) : [];
		var tagName = videoTracks.length ? "video" : "audio";
		var element = state.returnElements[uuid];
		if (!element || element.localName !== tagName) {
			if (element && element.parentNode) {
				element.parentNode.removeChild(element);
			}
			element = document.createElement(tagName);
			element.autoplay = true;
			element.playsInline = true;
			element.controls = false;
			element.dataset.mcastNativeReturn = "true";
			element.dataset.label = "Host feed";
			element.style.position = "fixed";
			element.style.left = "-10000px";
			element.style.top = "0";
			element.style.width = "1px";
			element.style.height = "1px";
			element.style.opacity = "0";
			document.body.appendChild(element);
			state.returnElements[uuid] = element;
		}

		element.muted = false;
		if (element.srcObject !== stream) {
			element.srcObject = stream;
		}
		if (typeof element.play === "function") {
			element.play().catch(function () {});
		}
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

		["sendChannel", "dataChannel", "channel", "dc", "mcastNativeDataChannel"].forEach(function (name) {
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
				iceCandidatesQueued: []
			};
		}
		return state.media[uuid];
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
			var IceCandidateCtor = window.RTCIceCandidate || (typeof RTCIceCandidate === "function" ? RTCIceCandidate : null);
			var ice = IceCandidateCtor ? new IceCandidateCtor(candidate) : candidate;
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

	function renegotiate(uuid, pc) {
		mcastNativeRenegotiationAttempts += 1;
		state.log("MCast native WebRTC media renegotiation start", {
			uuid: safeId(uuid),
			attempt: mcastNativeRenegotiationAttempts,
			signalingState: pc && pc.signalingState || "",
			currentDescription: summarizeDescription(pc && pc.localDescription)
		});

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

		if ((description.audio || description.video) && description.returnMedia) {
			return;
		}

		createFallbackOfferWhenStable(uuid, pc, 0);
	}

	function createFallbackOfferWhenStable(uuid, pc, attempt) {
		attempt = attempt || 0;
		if (pc && pc.signalingState && pc.signalingState !== "stable") {
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

		pc.createOffer()
			.then(function (offer) {
				return pc.setLocalDescription(offer).then(function () {
					return pc.localDescription || offer;
				});
			})
			.then(function (description) {
				if (!window.session) {
					return;
				}

				var payload = {
					UUID: uuid,
					streamID: window.session.streamID || "",
					mcastGuestKey: readRouteParameter("mcastguestkey") || window.session.streamID || "",
					session: pc.session || pc.mcastSession || "",
					description: {
						type: description.type,
						sdp: description.sdp
					}
				};

				if (typeof window.session.sendMessage === "function") {
					window.session.sendMessage(payload, uuid);
				} else if (typeof window.session.sendRequest === "function") {
					window.session.sendRequest(payload, uuid);
				}
				state.log("MCast native WebRTC fallback offer sent", {
					uuid: safeId(uuid),
					description: summarizeDescription(description)
				});
			})
			.catch(function (error) {
				state.log("MCast native WebRTC fallback offer failed", { name: error && error.name });
			});
	}

	function bindLocalTrackToPeer(pc, existingSenders, track, stream) {
		var sender = findReusableSenderForKind(pc, existingSenders, track.kind);
		var transceiver = sender ? findTransceiverForSender(pc, sender, track.kind) : null;
		if (transceiver) {
			forceTransceiverSendrecv(transceiver);
		}

		if (sender && isLiveTrack(sender.track)) {
			setSenderStreams(sender, stream);
			if (sender.track === track) {
				return { kind: track.kind, action: "existing" };
			}
			if (typeof sender.replaceTrack === "function") {
				return {
					kind: track.kind,
					action: "replace",
					promise: normalizePromise(sender.replaceTrack(track))
				};
			}
		}

		if (sender && typeof sender.replaceTrack === "function") {
			setSenderStreams(sender, stream);
			return {
				kind: track.kind,
				action: "replace",
				promise: normalizePromise(sender.replaceTrack(track))
			};
		}

		if (typeof pc.addTransceiver === "function") {
			var addedTransceiver = pc.addTransceiver(track, { direction: "sendrecv", streams: [stream] });
			forceTransceiverSendrecv(addedTransceiver);
			if (addedTransceiver && addedTransceiver.sender) {
				existingSenders.push(addedTransceiver.sender);
			}
			return { kind: track.kind, action: "add-transceiver" };
		}

		if (typeof pc.addTrack === "function") {
			var addedSender = pc.addTrack(track, stream);
			if (addedSender) {
				existingSenders.push(addedSender);
			}
			return { kind: track.kind, action: "add-track" };
		}

		return null;
	}

	function findReusableSenderForKind(pc, senders, kind) {
		var transceivers = getTransceivers(pc);
		var index;
		for (index = 0; index < senders.length; index += 1) {
			if (senderMatchesKind(senders[index], kind)) {
				return senders[index];
			}
		}
		for (index = 0; index < transceivers.length; index += 1) {
			if (transceiverMatchesKind(transceivers[index], kind)) {
				return transceivers[index].sender || null;
			}
		}
		return null;
	}

	function getTransceivers(pc) {
		try {
			return pc && typeof pc.getTransceivers === "function" ? pc.getTransceivers() : [];
		} catch (error) {
			return [];
		}
	}

	function senderMatchesKind(sender, kind) {
		return !!(sender && sender.track && sender.track.kind === kind && sender.track.readyState !== "ended");
	}

	function transceiverMatchesKind(transceiver, kind) {
		var senderTrack = transceiver && transceiver.sender && transceiver.sender.track;
		var receiverTrack = transceiver && transceiver.receiver && transceiver.receiver.track;
		return !!((senderTrack && senderTrack.kind === kind) || (receiverTrack && receiverTrack.kind === kind));
	}

	function findTransceiverForSender(pc, sender, kind) {
		var transceivers = getTransceivers(pc);
		for (var index = 0; index < transceivers.length; index += 1) {
			var transceiver = transceivers[index];
			if (transceiver && transceiver.sender === sender) {
				return transceiver;
			}
			if (transceiver && transceiver.sender && transceiver.sender.track === sender.track && transceiverMatchesKind(transceiver, kind)) {
				return transceiver;
			}
		}
		return null;
	}

	function forceTransceiverSendrecv(transceiver) {
		if (!transceiver || transceiver.stopped === true) {
			return;
		}
		try {
			if (transceiver.direction !== "sendrecv") {
				transceiver.direction = "sendrecv";
			}
		} catch (error) {}
	}

	function setSenderStreams(sender, stream) {
		try {
			if (sender && typeof sender.setStreams === "function") {
				sender.setStreams(stream);
			}
		} catch (error) {}
	}

	function normalizePromise(value) {
		return value && typeof value.then === "function" ? value : Promise.resolve(value);
	}

	function isUsableStream(stream) {
		return !!(stream && typeof stream.getTracks === "function" && stream.getTracks().some(isLiveTrack));
	}

	function readRouteParameter(name) {
		try {
			var params = new URLSearchParams(window.location.search || "");
			return params.get(name) || "";
		} catch (error) {
			return "";
		}
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
			application: /\r?\nm=application\s/i.test(sdp),
			returnMedia: /\r?\na=(sendrecv|recvonly)\r?\n/i.test(sdp)
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
