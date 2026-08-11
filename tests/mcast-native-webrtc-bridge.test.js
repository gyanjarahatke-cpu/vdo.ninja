/* eslint-env node */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bridgeScript = fs.readFileSync(
	path.join(__dirname, "..", "g", "shared", "McastNativeWebRtcBridge.js"),
	"utf8"
);

function createTrack(kind, id) {
	const listeners = {};
	return {
		kind,
		id,
		enabled: true,
		readyState: "live",
		addEventListener(type, handler) {
			listeners[type] = listeners[type] || [];
			listeners[type].push(handler);
		},
		emit(type) {
			if (type === "ended") {
				this.readyState = "ended";
			}
			(listeners[type] || []).forEach((handler) => handler({ target: this }));
		}
	};
}

function createStream() {
	const video = createTrack("video", "video-track");
	const audio = createTrack("audio", "audio-track");
	const tracks = [video, audio];
	return {
		id: "local-stream",
		getTracks() {
			return tracks.slice();
		},
		getVideoTracks() {
			return [video];
		},
		getAudioTracks() {
			return [audio];
		}
	};
}

function createChannel() {
	const listeners = {};
	return {
		label: "sendChannel",
		readyState: "open",
		sent: [],
		addEventListener(type, handler) {
			listeners[type] = listeners[type] || [];
			listeners[type].push(handler);
		},
		send(payload) {
			this.sent.push(JSON.parse(payload));
		},
		emit(type, data) {
			(listeners[type] || []).forEach((handler) => handler(data));
		}
	};
}

function createSender(track, replacements, transceiver) {
	const sender = {
		track,
		streams: [],
		replaceTrack(nextTrack) {
			replacements.push({ from: this.track && this.track.id, to: nextTrack && nextTrack.id });
			this.track = nextTrack;
			if (transceiver) {
				transceiver.track = nextTrack;
			}
			return Promise.resolve();
		},
		setStreams(...streams) {
			this.streams = streams;
		}
	};
	return sender;
}

function createPeer(channel, options) {
	options = options || {};
	const listeners = {};
	const senders = [];
	const transceivers = [];
	const replacements = [];
	const iceCandidates = [];
	const receivers = [];
	function directionFor(kind) {
		const transceiver = transceivers.find((candidate) => candidate.track && candidate.track.kind === kind);
		return transceiver ? transceiver.direction : "sendonly";
	}
	function pushTransceiver(track, direction) {
		const transceiver = {
			sender: null,
			receiver: { track },
			track,
			direction: direction || "sendrecv"
		};
		transceiver.sender = createSender(track, replacements, transceiver);
		senders.push(transceiver.sender);
		transceivers.push(transceiver);
		return transceiver;
	}
	if (options.existingMediaSenders) {
		pushTransceiver(createTrack("video", "placeholder-video"), "sendonly");
		pushTransceiver(createTrack("audio", "placeholder-audio"), "sendonly");
	}
	return {
		signalingState: "stable",
		connectionState: "connected",
		iceConnectionState: "connected",
		localDescription: null,
		remoteDescription: null,
		sendChannel: channel,
		transceivers,
		replacements,
		iceCandidates,
		addEventListener(type, handler) {
			listeners[type] = listeners[type] || [];
			listeners[type].push(handler);
		},
		getSenders() {
			return senders.slice();
		},
		getTransceivers() {
			return transceivers.slice();
		},
		getReceivers() {
			return receivers.slice();
		},
		addTransceiver(track, options) {
			return pushTransceiver(track, options && options.direction || "sendrecv");
		},
		addTrack(track) {
			const sender = createSender(track, replacements, null);
			senders.push(sender);
			return sender;
		},
		createOffer() {
			return Promise.resolve({
				type: "offer",
				sdp: [
					"v=0",
					"o=- 1 1 IN IP4 127.0.0.1",
					"s=-",
					"t=0 0",
					"m=video 9 UDP/TLS/RTP/SAVPF 96",
					`a=${directionFor("video")}`,
					"m=audio 9 UDP/TLS/RTP/SAVPF 111",
					`a=${directionFor("audio")}`,
					""
				].join("\r\n")
			});
		},
		setLocalDescription(description) {
			this.localDescription = description;
			this.signalingState = "have-local-offer";
			return Promise.resolve();
		},
		setRemoteDescription(description) {
			this.remoteDescription = description;
			this.signalingState = "stable";
			return Promise.resolve();
		},
		addIceCandidate(candidate) {
			iceCandidates.push(candidate);
			return Promise.resolve();
		},
		emit(type, data) {
			if (type === "track" && data && data.track && !receivers.some((receiver) => receiver.track === data.track)) {
				receivers.push({ track: data.track });
			}
			(listeners[type] || []).forEach((handler) => handler(data));
		},
		setConnectionState(connectionState, iceConnectionState) {
			this.connectionState = connectionState;
			this.iceConnectionState = iceConnectionState || connectionState;
			this.emit("connectionstatechange", { target: this });
			this.emit("iceconnectionstatechange", { target: this });
		}
	};
}

function createTimers() {
	let nextId = 1;
	const timeouts = new Map();
	const intervals = new Map();
	return {
		setTimeout(callback, delay) {
			const id = nextId++;
			timeouts.set(id, { callback, delay: Number(delay) || 0 });
			return id;
		},
		clearTimeout(id) {
			timeouts.delete(id);
		},
		setInterval(callback) {
			const id = nextId++;
			intervals.set(id, callback);
			return id;
		},
		clearInterval(id) {
			intervals.delete(id);
		},
		runIntervals() {
			[...intervals.values()].forEach((callback) => callback());
		},
		runTimeouts(maxDelay = Infinity) {
			const ready = [...timeouts.entries()].filter(([, timer]) => timer.delay <= maxDelay);
			ready.forEach(([id, timer]) => {
				timeouts.delete(id);
				timer.callback();
			});
		},
		pendingTimeouts() {
			return timeouts.size;
		}
	};
}

async function flushPromises() {
	for (let index = 0; index < 10; index += 1) {
		await Promise.resolve();
	}
}

async function runBridge(peerOptions) {
	const channel = createChannel();
	const peer = createPeer(channel, peerOptions);
	const stream = createStream();
	const remoteStreams = [];
	const removedStreams = [];
	const terminalEvents = [];
	const states = [];
	const timers = createTimers();
	const context = {
		URLSearchParams,
		JSON,
		Promise,
		RTCIceCandidate: function RTCIceCandidate(candidate) {
			return candidate;
		},
		console: {
			info() {},
			warn() {},
			error() {}
		},
		setInterval: timers.setInterval,
		clearInterval: timers.clearInterval,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		window: {
			location: {
				pathname: "/g/",
				search: "?room=test-room&push=guest123&mcastguestkey=guest123&mcaststreamid=guest123&mcastnativewebrtc=1&mcastguestmedia=1&l=Tester"
			},
			session: {
				streamID: "guest123",
				sentMessages: [],
				pcs: {
					peerA: peer
				},
				rpcs: {},
				sendMessage(payload, uuid) {
					this.sentMessages.push({ payload, uuid });
				}
			},
			MCastRoute: {
				route: "guest",
				nativeWebRtcRequested: true
			}
		}
	};
	context.window.window = context.window;
	context.window.console = context.console;
	context.window.URLSearchParams = URLSearchParams;
	context.window.JSON = JSON;
	context.window.RTCIceCandidate = context.RTCIceCandidate;
	context.window.setInterval = context.setInterval;
	context.window.clearInterval = context.clearInterval;
	context.window.setTimeout = context.setTimeout;
	context.window.clearTimeout = context.clearTimeout;
	context.globalThis = context.window;
	context.self = context.window;
	vm.createContext(context);
	vm.runInContext(bridgeScript, context, { filename: "McastNativeWebRtcBridge.js" });

	assert.ok(context.window.MCastNativeWebRtcBridge, "bridge should install on window");
	const started = context.window.MCastNativeWebRtcBridge.start({
		getLocalStream() {
			return stream;
		},
		log() {},
		onRemoteStream(uuid, remoteStream, kind) {
			remoteStreams.push({ uuid, remoteStream, kind });
		},
		onRemoteStreamRemoved(uuid, reason) {
			removedStreams.push({ uuid, reason });
		},
		onTerminal(uuid, reason) {
			terminalEvents.push({ uuid, reason });
		},
		onState(stage, uuid, details) {
			states.push({ stage, uuid, details });
		}
	});
	assert.strictEqual(started, true, "bridge should start for native guest route");

	await flushPromises();
	const returnTrack = createTrack("video", "return-video-track");
	const returnStream = {
		id: "native-return-stream",
		getTracks() {
			return [returnTrack];
		},
		getVideoTracks() {
			return [returnTrack];
		},
		getAudioTracks() {
			return [];
		}
	};
	peer.emit("track", { track: returnTrack, streams: [returnStream] });
	return {
		bridge: context.window.MCastNativeWebRtcBridge,
		channel,
		peer,
		remoteStreams,
		removedStreams,
		terminalEvents,
		states,
		session: context.window.session,
		timers
	};
}

runBridge()
	.then(async ({ channel, peer, remoteStreams, removedStreams, terminalEvents, session, timers }) => {
		const sent = session.sentMessages.find((message) => message.payload.description && message.payload.description.type === "offer");
		assert.ok(sent, "bridge should send a media SDP offer through VDO signaling");
		const offer = sent.payload;
		assert.strictEqual(offer.streamID, "guest123", "offer should preserve stream id");
		assert.strictEqual(offer.mcastGuestKey, "guest123", "fallback offer should preserve guest key");
		assert.ok(peer.transceivers.every((transceiver) => transceiver.direction === "sendrecv"), "bridge should request bidirectional media transceivers");
		assert.match(offer.description.sdp, /\r\nm=video\s/i, "offer should include video media section");
		assert.match(offer.description.sdp, /\r\nm=audio\s/i, "offer should include audio media section");
		assert.match(offer.description.sdp, /\r\na=sendrecv\r\n/i, "offer should allow native return media");
		assert.strictEqual(remoteStreams.length, 1, "bridge should surface native return streams");
		assert.strictEqual(remoteStreams[0].uuid, "peerA", "return stream should preserve peer uuid");
		assert.strictEqual(remoteStreams[0].kind, "video", "return stream should report track kind");
		channel.emit("message", {
			data: JSON.stringify({
				candidate: {
					candidate: "a=candidate:1 1 udp 1 127.0.0.1 9 typ host",
					sdpMid: "0",
					sdpMLineIndex: 0
				}
			})
		});
		channel.emit("message", {
			data: JSON.stringify({
				description: {
					type: "answer",
					sdp: "v=0\r\ns=-\r\n"
				}
			})
		});
		await flushPromises();
		assert.strictEqual(peer.remoteDescription.type, "answer", "bridge should apply native media answers received on the data channel");
		assert.strictEqual(peer.iceCandidates.length, 1, "bridge should apply queued native ICE candidates after the answer");
		assert.strictEqual(peer.iceCandidates[0].candidate, "candidate:1 1 udp 1 127.0.0.1 9 typ host", "bridge should normalize native ICE candidates");

		const replacementPeer = createPeer(createChannel());
		session.pcs.peerA = replacementPeer;
		timers.runIntervals();
		await flushPromises();
		assert.strictEqual(removedStreams.length, 0, "peer replacement must retain the last host frame until replacement media arrives");
		const churnTrack = createTrack("video", "peer-churn-return");
		const churnStream = {
			id: "peer-churn-stream",
			getTracks() { return [churnTrack]; },
			getVideoTracks() { return [churnTrack]; },
			getAudioTracks() { return []; }
		};
		replacementPeer.emit("track", { track: churnTrack, streams: [churnStream] });
		timers.runTimeouts(8000);
		assert.strictEqual(removedStreams.length, 0, "atomic replacement media must cancel retained-frame cleanup");
		assert.strictEqual(terminalEvents.length, 0, "peer replacement must not end the guest session");

		delete session.pcs.peerA;
		timers.runIntervals();
		timers.runIntervals();
		timers.runIntervals();
		assert.strictEqual(removedStreams.length, 0, "brief peer removal must not blank the retained host frame");
		const reconnectedPeer = createPeer(createChannel());
		session.pcs.peerA = reconnectedPeer;
		timers.runIntervals();
		const reconnectTrack = createTrack("video", "peer-reconnect-return");
		const reconnectStream = {
			id: "peer-reconnect-stream",
			getTracks() { return [reconnectTrack]; },
			getVideoTracks() { return [reconnectTrack]; },
			getAudioTracks() { return []; }
		};
		reconnectedPeer.emit("track", { track: reconnectTrack, streams: [reconnectStream] });
		timers.runTimeouts(8000);
		assert.strictEqual(removedStreams.length, 0, "reconnected return media must replace the retained frame without a blank interval");
		assert.strictEqual(terminalEvents.length, 0, "a peer that reconnects inside the grace period must stay live");

		const replaced = await runBridge({ existingMediaSenders: true });
		const replacedOffer = replaced.session.sentMessages.find((message) => message.payload.description && message.payload.description.type === "offer");
		assert.ok(replacedOffer, "bridge should renegotiate when VDO already created media senders");
		assert.strictEqual(replaced.peer.transceivers.length, 2, "bridge should reuse existing media transceivers");
		assert.deepStrictEqual(
			replaced.peer.replacements.map((replacement) => replacement.to).sort(),
			["audio-track", "video-track"],
			"bridge should replace existing VDO sender tracks with local camera and microphone tracks"
		);
		assert.ok(replaced.peer.transceivers.every((transceiver) => transceiver.direction === "sendrecv"), "reused VDO transceivers should request bidirectional media");

		assert.strictEqual(replaced.bridge.debugSnapshot().started, true, "bridge polling must remain active after initial attach");
		replaced.peer.setConnectionState("disconnected", "disconnected");
		assert.strictEqual(replaced.terminalEvents.length, 0, "transient disconnected state must not end the guest session");
		replaced.peer.setConnectionState("connecting", "checking");
		replaced.peer.setConnectionState("connected", "connected");
		replaced.timers.runTimeouts();
		assert.strictEqual(replaced.terminalEvents.length, 0, "a recovered peer must remain active");

		const replacementTrack = createTrack("video", "return-video-replacement");
		const replacementStream = {
			id: "native-return-replacement",
			getTracks() { return [replacementTrack]; },
			getVideoTracks() { return [replacementTrack]; },
			getAudioTracks() { return []; }
		};
		const firstReturnTrack = replaced.remoteStreams[0].remoteStream.getVideoTracks()[0];
		firstReturnTrack.emit("ended");
		replaced.peer.emit("track", { track: replacementTrack, streams: [replacementStream] });
		replaced.timers.runTimeouts(2500);
		assert.strictEqual(replaced.terminalEvents.length, 0, "a return-track replacement inside the grace period must not end the session");
		assert.strictEqual(replaced.remoteStreams.at(-1).remoteStream, replacementStream, "replacement host feed must be surfaced");

		replacementTrack.emit("ended");
		replaced.timers.runTimeouts(2500);
		assert.strictEqual(replaced.terminalEvents.length, 0, "an ended host-feed track must not end an otherwise live peer");
		assert.ok(
			replaced.removedStreams.some((event) => event.reason === "return-track-ended"),
			"an unreplaced ended host-feed track must remove stale playback after its grace period"
		);

		const failed = await runBridge();
		failed.peer.setConnectionState("failed", "failed");
		assert.deepStrictEqual(
			failed.terminalEvents.map((event) => event.reason),
			["peer-failed"],
			"failed peer state must immediately report an authoritative terminal session"
		);
		failed.timers.runIntervals();
		failed.timers.runIntervals();
		assert.strictEqual(failed.terminalEvents.length, 1, "a terminal peer retained by the engine must notify only once");

		const alternate = await runBridge();
		const healthyAlternatePeer = createPeer(createChannel());
		alternate.session.rpcs.peerA = healthyAlternatePeer;
		alternate.peer.setConnectionState("failed", "failed");
		alternate.timers.runIntervals();
		await flushPromises();
		assert.strictEqual(alternate.terminalEvents.length, 0, "a healthy alternate peer for the same participant must win over a failed peer");
		console.log("MCast native WebRTC bridge regression passed");
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
