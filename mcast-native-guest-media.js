(function () {
	"use strict";

	if (window.MCastNativeGuestMediaBridge) {
		return;
	}

	var bridgeVersion = 1;
	var observedPeers = [];
	var observedPeerSet = typeof WeakSet === "function" ? new WeakSet() : null;
	var peerState = typeof WeakMap === "function" ? new WeakMap() : null;
	var originalPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
	var pollTimer = 0;

	function log(message, detail) {
		try {
			if (window.DebugLog && window.console && window.console.log) {
				window.console.log("[MCast native guest media] " + message, detail || "");
			}
		} catch (error) {}
	}

	function getState(peer) {
		if (!peerState) {
			if (!peer.__mcastNativeGuestMediaState) {
				peer.__mcastNativeGuestMediaState = createState();
			}
			return peer.__mcastNativeGuestMediaState;
		}

		var state = peerState.get(peer);
		if (!state) {
			state = createState();
			peerState.set(peer, state);
		}
		return state;
	}

	function createState() {
		return {
			channels: [],
			iceCandidatesQueued: [],
			iceHandlerAttached: false,
			localCandidateHandlerAttached: false,
			lastOfferSignature: "",
			mediaOfferInFlight: false,
			mediaOfferSent: false,
			renegotiateTimer: 0,
			waitingForAnswer: false
		};
	}

	function getRouteParams() {
		var query = "";
		try {
			if (window.MCastRoute && window.MCastRoute.query) {
				query = window.MCastRoute.query;
			} else if (window.session && window.session.decrypted) {
				query = String(window.session.decrypted).replace(/^\?/, "");
			} else {
				query = (window.location.search || "").replace(/^\?/, "");
			}
		} catch (error) {
			query = (window.location.search || "").replace(/^\?/, "");
		}
		return new URLSearchParams(query);
	}

	function routeFlag(params, name) {
		if (!params.has(name)) {
			return false;
		}
		var value = String(params.get(name) || "").trim().toLowerCase();
		return value === "" || value === "1" || value === "true" || value === "yes" || value === "on";
	}

	function isNativeGuestMediaRoute() {
		try {
			var route = window.MCastRoute || {};
			var params = getRouteParams();
			return (route.route === "guest" || /\/(?:g|m|c|s|w|p|i|rv|ra|rs)(?:\/|$)/i.test(window.location.pathname || "")) &&
				(routeFlag(params, "mcastnativewebrtc") || routeFlag(params, "mcastguestmedia"));
		} catch (error) {
			return false;
		}
	}

	function readParam(params, name) {
		var value = params.get(name);
		return value === null ? "" : String(value || "").trim();
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
			room: readParam(params, "room") || readParam(params, "r") || "",
			streamId: streamId,
			guestKey: guestKey,
			label: readParam(params, "l") || readParam(params, "label") || ""
		};
	}

	function getLocalStream() {
		var candidates = [];
		try {
			if (window.session) {
				candidates.push(window.session.streamSrc);
				candidates.push(window.session.streamSrcClone);
				if (window.session.videoElement) {
					candidates.push(window.session.videoElement.srcObject);
				}
			}
		} catch (error) {}
		["videosource", "previewWebcam", "mcastDesktopLocalVideo", "mcastMobileLocalVideo"].forEach(function (id) {
			try {
				var element = document.getElementById(id);
				if (element) {
					candidates.push(element.srcObject);
				}
			} catch (error) {}
		});
		for (var index = 0; index < candidates.length; index++) {
			var stream = candidates[index];
			if (stream && typeof stream.getTracks === "function" && stream.getTracks().length) {
				return stream;
			}
		}
		return null;
	}

	function observeExistingSessionPeers() {
		if (!window.session || !window.session.pcs) {
			return;
		}
		for (var uuid in window.session.pcs) {
			if (Object.prototype.hasOwnProperty.call(window.session.pcs, uuid)) {
				observePeerConnection(window.session.pcs[uuid]);
			}
		}
	}

	function findPublisherUuid(peer) {
		if (!window.session || !window.session.pcs) {
			return "";
		}
		for (var uuid in window.session.pcs) {
			if (Object.prototype.hasOwnProperty.call(window.session.pcs, uuid) && window.session.pcs[uuid] === peer) {
				return uuid;
			}
		}
		return "";
	}

	function isNativeControlChannel(channel) {
		if (!channel) {
			return false;
		}
		var label = String(channel.label || "").toLowerCase();
		if (!label) {
			return true;
		}
		if (label === "sendchannel" || label.indexOf("sendchannel_") === 0) {
			return true;
		}
		return label.indexOf("mcast") >= 0 || label.indexOf("native") >= 0;
	}

	function observePeerConnection(peer) {
		if (!peer || typeof peer !== "object") {
			return peer;
		}
		if (observedPeerSet) {
			if (observedPeerSet.has(peer)) {
				return peer;
			}
			observedPeerSet.add(peer);
		} else if (peer.__mcastNativeGuestMediaObserved) {
			return peer;
		}
		peer.__mcastNativeGuestMediaObserved = true;
		observedPeers.push(peer);

		try {
			var originalCreateDataChannel = peer.createDataChannel;
			if (typeof originalCreateDataChannel === "function" && !peer.__mcastNativeGuestMediaCreateDataChannelWrapped) {
				peer.__mcastNativeGuestMediaCreateDataChannelWrapped = true;
				peer.createDataChannel = function () {
					var channel = originalCreateDataChannel.apply(this, arguments);
					observeDataChannel(peer, channel);
					return channel;
				};
			}
		} catch (error) {}

		try {
			if (typeof peer.addEventListener === "function") {
				peer.addEventListener("datachannel", function (event) {
					observeDataChannel(peer, event && event.channel);
				});
				peer.addEventListener("connectionstatechange", function () {
					scheduleRenegotiation(peer, "connection-state");
				});
				peer.addEventListener("iceconnectionstatechange", function () {
					scheduleRenegotiation(peer, "ice-state");
				});
				peer.addEventListener("signalingstatechange", function () {
					scheduleRenegotiation(peer, "signaling-state");
				});
			}
		} catch (error) {}

		scheduleRenegotiation(peer, "observe");
		return peer;
	}

	function observeDataChannel(peer, channel) {
		if (!peer || !channel) {
			return;
		}
		var state = getState(peer);
		if (state.channels.indexOf(channel) < 0) {
			state.channels.push(channel);
		}
		if (!isNativeControlChannel(channel)) {
			return;
		}
		try {
			if (typeof channel.addEventListener === "function") {
				channel.addEventListener("open", function () {
					scheduleRenegotiation(peer, "channel-open");
				});
				channel.addEventListener("message", function (event) {
					handleNativeMessage(peer, channel, event && event.data);
				});
			}
		} catch (error) {}
		if (channel.readyState === "open") {
			scheduleRenegotiation(peer, "channel-ready");
		}
	}

	function getOpenNativeChannel(peer) {
		var state = getState(peer);
		for (var index = 0; index < state.channels.length; index++) {
			var channel = state.channels[index];
			if (channel && channel.readyState === "open" && isNativeControlChannel(channel)) {
				return channel;
			}
		}
		try {
			if (peer.sendChannel && peer.sendChannel.readyState === "open" && isNativeControlChannel(peer.sendChannel)) {
				observeDataChannel(peer, peer.sendChannel);
				return peer.sendChannel;
			}
		} catch (error) {}
		return null;
	}

	function sendJson(channel, payload) {
		try {
			if (channel && channel.readyState === "open") {
				channel.send(JSON.stringify(payload));
				return true;
			}
		} catch (error) {}
		return false;
	}

	function sendAck(channel, command, correlationId, ok) {
		sendJson(channel, {
			type: "mcastCommandAck",
			mcastCommandAck: command || true,
			command: command || "",
			correlationId: correlationId || "",
			ok: ok !== false
		});
	}

	function attachLocalCandidateRelay(peer, channel) {
		var state = getState(peer);
		if (state.localCandidateHandlerAttached) {
			return;
		}
		state.localCandidateHandlerAttached = true;
		try {
			if (typeof peer.addEventListener === "function") {
				peer.addEventListener("icecandidate", function (event) {
					if (!isNativeGuestMediaRoute()) {
						return;
					}
					var identity = getGuestIdentity();
					if (!identity.streamId || !event || !event.candidate) {
						return;
					}
					var liveChannel = getOpenNativeChannel(peer) || channel;
					sendJson(liveChannel, {
						type: "candidate",
						streamID: identity.streamId,
						streamId: identity.streamId,
						viewId: identity.streamId,
						guestKey: identity.streamId,
						mcastGuestKey: identity.guestKey,
						UUID: findPublisherUuid(peer),
						uuid: findPublisherUuid(peer),
						candidate: {
							candidate: event.candidate.candidate,
							sdpMid: event.candidate.sdpMid,
							sdpMLineIndex: event.candidate.sdpMLineIndex,
							usernameFragment: event.candidate.usernameFragment
						}
					});
				});
			}
		} catch (error) {}
	}

	function buildTrackSignature(stream) {
		try {
			return stream.getTracks().map(function (track) {
				return track.kind + ":" + track.id + ":" + track.readyState;
			}).sort().join("|");
		} catch (error) {
			return "";
		}
	}

	function hasMediaSections(sdp) {
		return /(?:^|\r?\n)m=video\s/i.test(sdp || "") || /(?:^|\r?\n)m=audio\s/i.test(sdp || "");
	}

	function scheduleRenegotiation(peer, reason) {
		if (!isNativeGuestMediaRoute() || !peer) {
			return;
		}
		var state = getState(peer);
		if (state.renegotiateTimer) {
			window.clearTimeout(state.renegotiateTimer);
		}
		state.renegotiateTimer = window.setTimeout(function () {
			state.renegotiateTimer = 0;
			renegotiateNativeMedia(peer, reason || "scheduled");
		}, 150);
	}

	async function addOrReplaceTracks(peer, stream) {
		var changed = false;
		var senders = typeof peer.getSenders === "function" ? peer.getSenders() : [];
		var tracks = stream.getTracks();
		for (var index = 0; index < tracks.length; index++) {
			var track = tracks[index];
			if (!track || track.readyState === "ended") {
				continue;
			}
			var existing = null;
			for (var senderIndex = 0; senderIndex < senders.length; senderIndex++) {
				if (senders[senderIndex] && senders[senderIndex].track && senders[senderIndex].track.kind === track.kind) {
					existing = senders[senderIndex];
					break;
				}
			}
			if (existing && existing.track && existing.track.id === track.id) {
				continue;
			}
			if (existing && typeof existing.replaceTrack === "function") {
				await existing.replaceTrack(track);
				changed = true;
			} else if (typeof peer.addTrack === "function") {
				peer.addTrack(track, stream);
				changed = true;
			}
		}
		return changed;
	}

	async function renegotiateNativeMedia(peer, reason) {
		if (!isNativeGuestMediaRoute() || !findPublisherUuid(peer)) {
			return;
		}
		var channel = getOpenNativeChannel(peer);
		if (!channel) {
			return;
		}
		var state = getState(peer);
		if (state.mediaOfferInFlight) {
			return;
		}
		if (peer.signalingState && peer.signalingState !== "stable") {
			return;
		}

		var stream = getLocalStream();
		if (!stream) {
			scheduleRenegotiation(peer, "waiting-for-local-stream");
			return;
		}

		var signature = buildTrackSignature(stream);
		if (state.mediaOfferSent && state.lastOfferSignature === signature) {
			return;
		}

		state.mediaOfferInFlight = true;
		try {
			var changed = await addOrReplaceTracks(peer, stream);
			if (!changed && state.mediaOfferSent && state.lastOfferSignature === signature) {
				return;
			}
			if (peer.signalingState && peer.signalingState !== "stable") {
				return;
			}
			attachLocalCandidateRelay(peer, channel);
			var offer = await peer.createOffer({
				offerToReceiveAudio: false,
				offerToReceiveVideo: false
			});
			if (!offer || !hasMediaSections(offer.sdp)) {
				state.mediaOfferSent = false;
				state.lastOfferSignature = "";
				scheduleRenegotiation(peer, "offer-without-media");
				return;
			}
			await peer.setLocalDescription(offer);
			var identity = getGuestIdentity();
			sendJson(channel, {
				streamID: identity.streamId,
				streamId: identity.streamId,
				viewId: identity.streamId,
				guestKey: identity.streamId,
				mcastGuestKey: identity.guestKey,
				UUID: findPublisherUuid(peer),
				uuid: findPublisherUuid(peer),
				label: identity.label,
				description: {
					type: peer.localDescription.type,
					sdp: peer.localDescription.sdp
				}
			});
			state.waitingForAnswer = true;
			state.mediaOfferSent = true;
			state.lastOfferSignature = signature;
			log("sent media offer", { reason: reason, stream: identity.streamId });
		} catch (error) {
			log("media renegotiation failed", error);
			state.mediaOfferSent = false;
		} finally {
			state.mediaOfferInFlight = false;
		}
	}

	async function applyNativeAnswer(peer, description) {
		if (!description || !description.sdp || String(description.type || "").toLowerCase() !== "answer") {
			return;
		}
		var state = getState(peer);
		try {
			if (peer.signalingState && peer.signalingState !== "have-local-offer") {
				return;
			}
			await peer.setRemoteDescription(description);
			state.waitingForAnswer = false;
			while (state.iceCandidatesQueued.length) {
				var candidate = state.iceCandidatesQueued.shift();
				await peer.addIceCandidate(candidate);
			}
			log("applied native media answer");
		} catch (error) {
			log("native answer failed", error);
		}
	}

	async function applyNativeCandidate(peer, candidate) {
		if (!candidate) {
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
			if (!peer.remoteDescription) {
				getState(peer).iceCandidatesQueued.push(ice);
				return;
			}
			await peer.addIceCandidate(ice);
		} catch (error) {
			log("native candidate failed", error);
		}
	}

	function parseCommandPayload(value) {
		if (!value) {
			return {};
		}
		if (typeof value === "object") {
			return value;
		}
		try {
			return JSON.parse(String(value));
		} catch (error) {
			return {};
		}
	}

	function applyTrackEnabled(kind, enabled) {
		var stream = getLocalStream();
		if (!stream) {
			return false;
		}
		var tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
		for (var index = 0; index < tracks.length; index++) {
			tracks[index].enabled = !!enabled;
		}
		return true;
	}

	function handleNativeCommand(peer, channel, message) {
		var command = String(message.command || message.mcastCommand || "").trim();
		if (!command) {
			return;
		}
		var payload = parseCommandPayload(message.payloadJson || message.payload || {});
		var ok = true;
		try {
			if (command === "mcast.guest.setAudioEnabled") {
				ok = applyTrackEnabled("audio", payload.audioEnabled !== false);
			} else if (command === "mcast.guest.setVideoEnabled") {
				ok = applyTrackEnabled("video", payload.videoEnabled !== false);
			} else if (command === "mcast.guest.disconnect") {
				if (typeof window.hangup === "function") {
					window.hangup();
				}
			}
			if (command === "mcast.guest.startMedia" ||
				command === "mcast.guest.setAudioEnabled" ||
				command === "mcast.guest.setVideoEnabled" ||
				command === "mcast.guest.setPresence") {
				getState(peer).mediaOfferSent = false;
				scheduleRenegotiation(peer, command);
			}
		} catch (error) {
			ok = false;
		}
		sendAck(channel, command, message.correlationId, ok);
	}

	function handleNativeMessage(peer, channel, data) {
		if (!isNativeGuestMediaRoute() || !data || typeof data !== "string") {
			return;
		}
		var message = null;
		try {
			message = JSON.parse(data);
		} catch (error) {
			return;
		}
		if (!message || typeof message !== "object") {
			return;
		}
		if (message.description && String(message.description.type || "").toLowerCase() === "answer") {
			applyNativeAnswer(peer, message.description);
			return;
		}
		if (message.candidate) {
			applyNativeCandidate(peer, message.candidate);
			return;
		}
		if (message.command || message.mcastCommand) {
			handleNativeCommand(peer, channel, message);
		}
	}

	function patchPeerConnectionConstructor(name) {
		var Original = window[name];
		if (!Original || Original.__mcastNativeGuestMediaPatched) {
			return;
		}

		function PatchedPeerConnection() {
			var peer = Reflect.construct(Original, arguments, Original);
			return observePeerConnection(peer);
		}
		try {
			Object.setPrototypeOf(PatchedPeerConnection, Original);
		} catch (error) {}
		PatchedPeerConnection.prototype = Original.prototype;
		PatchedPeerConnection.__mcastNativeGuestMediaPatched = true;
		window[name] = PatchedPeerConnection;
	}

	if (originalPeerConnection) {
		patchPeerConnectionConstructor("RTCPeerConnection");
		if (window.webkitRTCPeerConnection && window.webkitRTCPeerConnection !== window.RTCPeerConnection) {
			patchPeerConnectionConstructor("webkitRTCPeerConnection");
		}
	}

	pollTimer = window.setInterval(function () {
		if (!isNativeGuestMediaRoute()) {
			return;
		}
		observeExistingSessionPeers();
		for (var index = 0; index < observedPeers.length; index++) {
			scheduleRenegotiation(observedPeers[index], "poll");
		}
	}, 750);

	window.MCastNativeGuestMediaBridge = {
		version: bridgeVersion,
		snapshot: function () {
			return {
				enabled: isNativeGuestMediaRoute(),
				peers: observedPeers.length,
				stream: !!getLocalStream(),
				polling: !!pollTimer
			};
		}
	};
})();
