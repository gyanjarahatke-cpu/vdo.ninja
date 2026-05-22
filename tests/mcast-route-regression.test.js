/* eslint-env node */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const routeScript = fs.readFileSync(path.join(__dirname, "..", "mcast-route.js"), "utf8");
const guestLoader = fs.readFileSync(path.join(__dirname, "..", "mcast-guest.html"), "utf8");

function createStorage() {
	const store = new Map();
	return {
		getItem(key) {
			return store.has(key) ? store.get(key) : null;
		},
		setItem(key, value) {
			store.set(key, String(value));
		},
		removeItem(key) {
			store.delete(key);
		}
	};
}

function runRoute({ pathname, search, resolvedQuery }) {
	const requests = [];
	const historyUpdates = [];
	const classList = new Set();
	const sessionStorage = createStorage();
	const localStorage = createStorage();
	const context = {
		URLSearchParams,
		JSON,
		Math,
		Date,
		Uint8Array,
		console: {
			warn() {},
			error() {},
			log() {}
		},
		session: {},
		document: {
			title: "",
			documentElement: {
				classList: {
					add(value) {
						classList.add(value);
					}
				}
			},
			body: {
				appendChild() {}
			},
			createElement() {
				return {
					id: "",
					style: {},
					className: "",
				 textContent: "",
					appendChild() {}
				};
			}
		},
		window: {
			location: {
				pathname,
				search,
				hash: "",
				origin: "https://vn.mcaststudio.com"
			},
			history: {
				replaceState(_state, _title, nextUrl) {
					historyUpdates.push(nextUrl);
				}
			},
			sessionStorage,
			localStorage,
			crypto: {
				getRandomValues(values) {
					for (let index = 0; index < values.length; index++) {
						values[index] = index + 1;
					}
					return values;
				}
			}
		},
		XMLHttpRequest: function XMLHttpRequestMock() {
			this.headers = {};
			this.status = 200;
			this.open = (method, url) => {
				this.method = method;
				this.url = url;
				requests.push({ method, url });
			};
			this.setRequestHeader = (key, value) => {
				this.headers[key] = value;
			};
			this.send = () => {
				this.responseText = JSON.stringify({ query: resolvedQuery });
			};
		}
	};
	context.window.window = context.window;
	context.window.document = context.document;
	context.window.console = context.console;
	context.window.XMLHttpRequest = context.XMLHttpRequest;
	context.window.URLSearchParams = URLSearchParams;
	context.window.JSON = JSON;
	context.window.Uint8Array = Uint8Array;
	context.window.MCastRoute = undefined;
	context.globalThis = context.window;
	context.self = context.window;
	vm.createContext(context);
	vm.runInContext(routeScript, context, { filename: "mcast-route.js" });

	return {
		requests,
		historyUpdates,
		classList,
		session: context.session,
		route: context.window.MCastRoute,
		storedRoute: sessionStorage.getItem("mcastResolvedGuestRoute")
	};
}

const resolvedQuery = [
	"room=secureRoom",
	"push=guestKey",
	"webcam",
	"autostart",
	"mcastmode=meeting",
	"mcastrole=participant",
	"mcaststate=backstage",
	"mcastrouting=low_bitrate",
	"label=Guest%20One",
	"chat=1",
	"chatlite=1",
	"fileshare",
	"broadcasttransfer=1"
].join("&");

const result = runRoute({
	pathname: "/s/ABC123",
	search: "",
	resolvedQuery
});

assert.strictEqual(result.requests.length, 1, "short invite should resolve once");
assert.match(result.requests[0].url, /vdoShortInviteResolve\?code=ABC123$/, "short code should be sent to resolver");
assert.deepStrictEqual(result.historyUpdates, [], "short branded path must remain visible");
assert.ok(result.session.decrypted, "route must pass params internally via session.decrypted");

const internalParams = new URLSearchParams(result.session.decrypted.replace(/^\?/, ""));
assert.strictEqual(internalParams.get("room"), "secureRoom", "room param should reach VideoNinja engine");
assert.strictEqual(internalParams.get("push"), "guestKey", "push param should reach VideoNinja engine");
assert.strictEqual(internalParams.get("l"), "Guest One", "guest label should be normalized internally");
assert.ok(internalParams.has("webcam"), "webcam flag should be preserved");
assert.strictEqual(internalParams.has("autostart"), false, "guest flow must not auto-request permissions");
assert.strictEqual(internalParams.get("mcastrequestedautostart"), "1", "autostart intent should be preserved safely");
assert.strictEqual(internalParams.get("chatbutton"), "off", "chat must be disabled internally");
assert.ok(internalParams.has("nofileshare"), "file sharing must be disabled internally");
assert.strictEqual(internalParams.get("mcastdisableauxui"), "1", "guest aux UI disable flag should be passed internally");
assert.strictEqual(internalParams.has("chat"), false, "chat enable param must be stripped");
assert.strictEqual(internalParams.has("chatlite"), false, "chat-lite enable param must be stripped");
assert.strictEqual(internalParams.has("fileshare"), false, "file-share enable param must be stripped");
assert.strictEqual(internalParams.has("broadcasttransfer"), false, "transfer enable param must be stripped");

assert.strictEqual(result.route.route, "guest", "MCast route metadata should mark guest flow");
assert.strictEqual(result.route.mode, "meeting", "MCast mode metadata should survive");
assert.ok(result.classList.has("mcast-route-guest"), "guest route class should be applied");
assert.ok(result.storedRoute, "resolved route should be stored for refresh recovery");

assert.ok(/fetch\("\/g\/index\.html"/.test(guestLoader), "short URL loader should fetch the guest engine document");
assert.ok(/document\.write\(prepared\)/.test(guestLoader), "short URL loader should inject the guest engine document");
assert.ok(!/window\.location\.replace\(target\.href/.test(guestLoader), "short URL loader must not redirect away from branded URL");

console.log("MCast route regression passed");
