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
	return {
		kind,
		id,
		enabled: true,
		readyState: "live"
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
		localDescription: null,
		remoteDescription: null,
		sendChannel: channel,
		transceivers,
		replacements,
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
		addIceCandidate() {
			return Promise.resolve();
		},
		emit(type, data) {
			(listeners[type] || []).forEach((handler) => handler(data));
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
		setInterval() {
			return 1;
		},
		clearInterval() {},
		setTimeout(callback) {
			callback();
			return 1;
		},
		clearTimeout() {},
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
	return { channel, peer, remoteStreams, session: context.window.session };
}

runBridge()
	.then(async ({ peer, remoteStreams, session }) => {
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
		console.log("MCast native WebRTC bridge regression passed");
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
