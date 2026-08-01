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

function createPeer(channel) {
	const listeners = {};
	const senders = [];
	return {
		signalingState: "stable",
		localDescription: null,
		remoteDescription: null,
		sendChannel: channel,
		addEventListener(type, handler) {
			listeners[type] = listeners[type] || [];
			listeners[type].push(handler);
		},
		getSenders() {
			return senders.slice();
		},
		addTransceiver(track) {
			senders.push({ track });
			return { sender: { track }, direction: "sendonly" };
		},
		addTrack(track) {
			senders.push({ track });
			return { track };
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
					"a=sendonly",
					"m=audio 9 UDP/TLS/RTP/SAVPF 111",
					"a=sendonly",
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
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function runBridge() {
	const channel = createChannel();
	const peer = createPeer(channel);
	const stream = createStream();
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
		log() {}
	});
	assert.strictEqual(started, true, "bridge should start for native guest route");

	await flushPromises();
	return { channel, session: context.window.session };
}

runBridge()
	.then(({ session }) => {
		const sent = session.sentMessages.find((message) => message.payload.description && message.payload.description.type === "offer");
		assert.ok(sent, "bridge should send a media SDP offer through VDO signaling");
		const offer = sent.payload;
		assert.strictEqual(offer.streamID, "guest123", "offer should preserve stream id");
		assert.match(offer.description.sdp, /\r\nm=video\s/i, "offer should include video media section");
		assert.match(offer.description.sdp, /\r\nm=audio\s/i, "offer should include audio media section");
		console.log("MCast native WebRTC bridge regression passed");
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
