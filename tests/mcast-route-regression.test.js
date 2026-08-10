/* eslint-env node */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const routeScript = fs.readFileSync(path.join(root, "mcast-route.js"), "utf8");
const guestLoader = fs.readFileSync(path.join(root, "mcast-guest.html"), "utf8");
const guestEngine = fs.readFileSync(path.join(root, "g", "index.html"), "utf8");
const engineStartup = fs.readFileSync(path.join(root, "main.js"), "utf8");
const sharedUi = fs.readFileSync(path.join(root, "g", "shared", "McastGuestUi.js"), "utf8");
const sharedCss = fs.readFileSync(path.join(root, "g", "shared", "McastGuestUi.css"), "utf8");
const desktopShell = fs.readFileSync(path.join(root, "g", "desktop", "DesktopRoomShell.js"), "utf8");
const mobileShell = fs.readFileSync(path.join(root, "g", "mobile", "MobileRoomShell.js"), "utf8");
const mainCss = fs.readFileSync(path.join(root, "main.css"), "utf8");
const notFound = fs.readFileSync(path.join(root, "404.html"), "utf8");

function createStorage() {
	const store = new Map();
	return {
		getItem(key) { return store.has(key) ? store.get(key) : null; },
		setItem(key, value) { store.set(key, String(value)); },
		removeItem(key) { store.delete(key); },
		keys() { return Array.from(store.keys()); }
	};
}

function createClassList() {
	const values = new Set();
	return {
		add(...items) { items.forEach((item) => values.add(item)); },
		contains(item) { return values.has(item); },
		values
	};
}

function runRoute({ pathname, search = "", payload = null, resolvedCallQuery = "" }) {
	const requests = [];
	const historyUpdates = [];
	const routeErrors = [];
	const configuredRoutes = [];
	const classList = createClassList();
	const localStorage = createStorage();
	const sessionStorage = createStorage();
	const session = {};
	const elements = new Map();
	const document = {
		title: "",
		readyState: "complete",
		documentElement: { classList, dataset: {} },
		body: { appendChild(element) { if (element.id) { elements.set(element.id, element); } } },
		head: { appendChild(element) { if (element.id) { elements.set(element.id, element); } } },
		querySelector() { return null; },
		getElementById(id) { return elements.get(id) || null; },
		addEventListener() {},
		createElement(tagName) {
			return {
				tagName: String(tagName || "").toUpperCase(),
				id: "",
				style: {},
				className: "",
				textContent: "",
				appendChild() {},
				addEventListener() {},
				setAttribute() {}
			};
		}
	};
	const window = {
		location: {
			pathname,
			search,
			hash: "",
			origin: "https://co.mcaststudio.com"
		},
		history: {
			replaceState(_state, _title, nextUrl) { historyUpdates.push(nextUrl); }
		},
		localStorage,
		sessionStorage,
		session,
		crypto: {
			getRandomValues(values) {
				for (let index = 0; index < values.length; index++) { values[index] = index + 1; }
				return values;
			}
		},
		MCastGuestUi: {
			isOwnedRoute() { return true; },
			configureRoute(route) { configuredRoutes.push(route); },
			showRouteError(message) { routeErrors.push(message); }
		}
	};
	if (payload) { window.__MCastResolvedGuestRoute = payload; }
	window.window = window;
	window.document = document;
	window.console = { warn() {}, error() {}, log() {} };

	function XMLHttpRequestMock() {
		this.status = 200;
		this.responseText = JSON.stringify({ query: resolvedCallQuery });
		this.open = (method, url, async) => {
			this.method = method;
			this.url = url;
			requests.push({ method, url, async });
		};
		this.setRequestHeader = () => {};
		this.send = () => {};
	}

	const context = {
		window,
		document,
		session,
		URLSearchParams,
		XMLHttpRequest: XMLHttpRequestMock,
		Uint8Array,
		console: window.console,
		setTimeout,
		clearTimeout
	};
	context.globalThis = context;
	context.self = window;
	vm.createContext(context);
	vm.runInContext(routeScript, context, { filename: "mcast-route.js" });

	return {
		requests,
		historyUpdates,
		routeErrors,
		configuredRoutes,
		classes: classList.values,
		localStorage,
		sessionStorage,
		session,
		route: window.MCastRoute,
		preloadedPayload: window.__MCastResolvedGuestRoute
	};
}

function paramsFromSession(result) {
	assert.ok(result.session.decrypted, "route must provide the validated query to the private engine");
	return new URLSearchParams(result.session.decrypted.replace(/^\?/, ""));
}

function assertNoAutostart(params, label) {
	["autostart", "autojoin", "aj", "as", "mcastautojoin", "mcastrequestedautostart"].forEach((key) => {
		assert.strictEqual(params.has(key), false, `${label} must not request media without an explicit user action`);
	});
}

const guestQuery = [
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

const guest = runRoute({
	pathname: "/s/ABC12345",
	payload: { code: "ABC12345", query: guestQuery }
});
const guestParams = paramsFromSession(guest);
assert.strictEqual(guest.requests.length, 0, "the private engine must consume only the loader-validated payload");
assert.deepStrictEqual(guest.historyUpdates, [], "the opaque branded invite URL must remain visible");
assert.strictEqual(guestParams.get("room"), "secureRoom");
assert.strictEqual(guestParams.get("push"), "guestKey");
assert.strictEqual(guestParams.get("l"), "Guest One");
assertNoAutostart(guestParams, "guest route");
assert.strictEqual(guestParams.get("chatbutton"), "off");
assert.ok(guestParams.has("nofileshare"));
assert.strictEqual(guestParams.get("mcastdisableauxui"), "1");
["chat", "chatlite", "fileshare", "broadcasttransfer"].forEach((key) => assert.strictEqual(guestParams.has(key), false));
assert.strictEqual(guest.route.route, "guest");
assert.strictEqual(guest.route.mode, "meeting");
assert.strictEqual(guest.route.guestName, "Guest One");
assert.ok(guest.classes.has("mcast-route-guest"));
assert.strictEqual(guest.configuredRoutes.length, 1, "the shared MCast UI must receive authoritative route metadata");
assert.strictEqual(guest.preloadedPayload, undefined, "decoded guest route data must be consumed once and removed");
assert.deepStrictEqual(guest.sessionStorage.keys(), [], "route credentials must never be persisted in browser session storage");

const missingPayload = runRoute({
	pathname: "/s/ABC12345",
	search: "?room=rawRoom&push=rawGuest&autostart"
});
assert.strictEqual(missingPayload.session.decrypted, undefined, "raw public query parameters must not enter the engine");
assert.strictEqual(missingPayload.routeErrors.length, 1, "missing loader authorization must fail through branded UI");

const directToken = runRoute({ pathname: "/s/ABC12345", search: "?t=v1.secret" });
assert.strictEqual(directToken.session.decrypted, undefined, "direct public tokens must not be accepted");
assert.strictEqual(directToken.requests.length, 0, "the engine must not expose a direct-token resolver");

const remoteCases = [
	{
		path: "/s/CAMERA1",
		code: "CAMERA1",
		kind: "remote_camera",
		query: "room=remoteRoom&push=cameraFeed&mcastmode=stream_guest&mcastremote=remote_camera&autostart",
		assertParams(params) {
			assert.ok(params.has("webcam"));
			assert.strictEqual(params.has("miconly"), false);
			assert.strictEqual(params.has("screenshare"), false);
		}
	},
	{
		path: "/s/AUDIO001",
		code: "AUDIO001",
		kind: "remote_audio",
		query: "room=remoteRoom&push=audioFeed&mcastmode=stream_guest&mcastremote=remote_audio&autostart",
		assertParams(params) {
			assert.ok(params.has("webcam"));
			assert.ok(params.has("miconly"));
			assert.strictEqual(params.has("screenshare"), false);
		}
	},
	{
		path: "/s/SCREEN01",
		code: "SCREEN01",
		kind: "remote_screen",
		query: "room=remoteRoom&push=screenFeed&screenshareid=screenFeed&mcastmode=stream_guest&mcastremote=remote_screen&autostart",
		assertParams(params) {
			assert.ok(params.has("screenshare"));
			assert.strictEqual(params.get("push"), "screenFeed");
			assert.strictEqual(params.has("webcam"), false);
		}
	}
];

remoteCases.forEach((testCase) => {
	const result = runRoute({
		pathname: testCase.path,
		payload: { code: testCase.code, query: testCase.query }
	});
	const params = paramsFromSession(result);
	assert.strictEqual(result.route.remoteSourceKind, testCase.kind);
	assert.ok(result.classes.has(`mcast-remote-${testCase.kind.replace(/^remote_/, "")}`));
	assertNoAutostart(params, `${testCase.kind} route`);
	testCase.assertParams(params);
});

const unsupportedRemote = runRoute({
	pathname: "/s/CAMERA1",
	payload: {
		code: "CAMERA1",
		query: "room=remoteRoom&push=unknownFeed&mcastmode=stream_guest&mcastremote=remote_unknown"
	}
});
assert.strictEqual(unsupportedRemote.session.decrypted, undefined, "unsupported remote source kinds must fail closed");
assert.strictEqual(unsupportedRemote.routeErrors.length, 1);

const remoteOnAuthoritativePath = runRoute({
	pathname: "/s/REMOTE01",
	payload: {
		code: "REMOTE01",
		query: "room=remoteRoom&push=cameraFeed&mcastmode=stream_guest&mcastremote=remote_camera"
	}
});
assert.strictEqual(remoteOnAuthoritativePath.route.remoteSourceKind, "remote_camera", "all remote source experiences must use the authoritative short-link path");
assert.strictEqual(paramsFromSession(remoteOnAuthoritativePath).get("push"), "cameraFeed");

const call = runRoute({
	pathname: "/vcall/",
	search: "?r=ROOM1234",
	resolvedCallQuery: "room=secureRoom&mcastbridge&mcastmode=meeting&mcastrole=source"
});
const callParams = paramsFromSession(call);
assert.strictEqual(call.requests.length, 1);
assert.match(call.requests[0].url, /vdoRoomTicketResolve\?code=ROOM1234$/);
assert.strictEqual(call.requests[0].async, false, "the protected internal engine bootstrap remains synchronous");
assert.deepStrictEqual(call.historyUpdates, ["/vcall/"], "internal room ticket must be removed from the visible URL");
assert.ok(callParams.has("showdirector"));
assert.ok(callParams.has("mutespeaker"));
assert.ok(callParams.has("autostart"));
assert.strictEqual(callParams.get("quality"), "0");

assert.ok(guestLoader.includes('var resolverUrl = "/api/vdoShortInviteResolve"'));
assert.ok(guestLoader.includes('fetch(resolverUrl + "?code="'));
assert.ok(guestLoader.includes('credentials: "same-origin"'));
assert.ok(guestLoader.includes('fetch("/g/index.html"'));
assert.ok(guestLoader.includes("__MCastResolvedGuestRoute"));
assert.ok(
	guestLoader.includes("replace(/</g,") && guestLoader.includes("\\\\u003c"),
	"loader bootstrap must neutralize script-breaking payload text"
);
assert.ok(!guestLoader.includes("vdoTokenResolve"));
assert.ok(!guestLoader.includes("sessionStorage"));
assert.ok(!guestLoader.includes("history.replaceState"));
assert.ok(!guestLoader.includes("window.location.replace"));
assert.ok(!guestLoader.includes("g|m|c|s|p|i|rv|ra|rs"), "the loader must not retain legacy route aliases");
assert.ok(!routeScript.includes('params.get("t")'));
assert.ok(!routeScript.includes("mcastResolvedGuestRoute"));
assert.ok(!routeScript.includes("vdoTokenResolve"));
assert.ok(!routeScript.includes("g|m|c|s|p|i|rv|ra|rs"), "the engine must not retain legacy route aliases");
assert.ok(
	engineStartup.includes('if (!document.documentElement.classList.contains("mcast-route")) {\n\t\t\t\tdocument.title = session.label;') &&
		engineStartup.includes('if (session.label && !document.documentElement.classList.contains("mcast-route")) {'),
	"the private engine must not replace the branded browser title with a participant label"
);

const ensureRootBaseStart = guestLoader.indexOf("function ensureRootBase(html) {");
const ensureRootBaseEnd = guestLoader.indexOf("\n\n\t\t\t\tfunction showFailure", ensureRootBaseStart);
assert.notStrictEqual(ensureRootBaseStart, -1);
assert.notStrictEqual(ensureRootBaseEnd, -1);
const ensureRootBaseContext = {};
vm.createContext(ensureRootBaseContext);
vm.runInContext(guestLoader.slice(ensureRootBaseStart, ensureRootBaseEnd), ensureRootBaseContext, {
	filename: "mcast-guest.ensureRootBase.js"
});
const preparedWithoutBase = ensureRootBaseContext.ensureRootBase("<!doctype html><html><head><title>Guest</title></head><body></body></html>");
assert.match(preparedWithoutBase, /<head><base href="\/">/);
assert.strictEqual((preparedWithoutBase.match(/<base href="\/">/g) || []).length, 1);
const preparedWithBase = ensureRootBaseContext.ensureRootBase("<!doctype html><html><head><base href=\".\/g\/\"><title>Guest</title></head><body></body></html>");
assert.match(preparedWithBase, /<base href="\/">/);
assert.strictEqual((preparedWithBase.match(/<base href="\/">/g) || []).length, 1);

["s", "m", "c", "p", "i", "w"].forEach((routeDirectory) => {
	assert.strictEqual(fs.existsSync(path.join(root, routeDirectory, "index.html")), false, `${routeDirectory} must not own a parallel loader`);
	assert.strictEqual(fs.existsSync(path.join(root, routeDirectory, "404.html")), false, `${routeDirectory} must not own a parallel not-found loader`);
});
assert.ok(!notFound.includes("mcast-guest.html"), "root not-found page must not behave as another invite loader");

const sharedUiIndex = guestEngine.indexOf("./g/shared/McastGuestUi.js");
const adapterIndex = guestEngine.indexOf("./thirdparty/adapter.js");
const routeIndex = guestEngine.indexOf("./mcast-route.js");
const engineSessionIndex = guestEngine.indexOf("./lib.js");
const engineStartupIndex = guestEngine.indexOf("./main.js");
assert.ok(
	sharedUiIndex >= 0 && adapterIndex > sharedUiIndex && routeIndex > adapterIndex && engineSessionIndex > routeIndex && engineStartupIndex > engineSessionIndex,
	"startup order must validate the resolved route before the engine parses its query"
);
assert.strictEqual((guestEngine.match(/\.\/g\/shared\/McastGuestUi\.js/g) || []).length, 1);
assert.ok(guestEngine.includes('./main.js?ver=1066'), "the private engine must request the current managed runtime revision");
assert.ok(guestEngine.includes('./g/shared/McastGuestUi.js?v=9'));
assert.ok(guestEngine.includes('./g/shared/McastGuestUi.css?v=3'));
assert.ok(guestEngine.includes('./g/desktop/DesktopRoomShell.css?v=15'));
assert.ok(guestEngine.includes('./g/desktop/DesktopRoomShell.js?v=22'));
assert.ok(guestEngine.includes('./g/mobile/MobileRoomShell.css?v=12'));
assert.ok(guestEngine.includes('./g/mobile/MobileRoomShell.js?v=19'));
assert.strictEqual((guestEngine.match(/data-mcast-notice-rail/g) || []).length, 5, "every active shell header must own a notice rail");
assert.strictEqual((guestEngine.match(/data-mcast-footer-rail/g) || []).length, 5, "every active shell must own a non-overlapping footer rail");
assert.ok(!/mcastDesktopBackstageMessage|mcast-mobile__backstage-card|mcastMobileBackstageStatus/.test(guestEngine), "content-area notices must stay removed");
assert.ok(!/document\.write|Internet Explorer|\balert\s*\(/i.test(guestEngine), "private engine startup must not own browser warnings or rewrite the document");
assert.match(guestEngine, /<html[^>]+mcast-owned-guest-ui/);
assert.match(guestEngine, /<body[^>]+mcast-owned-guest-ui/);
assert.ok(!/<body[^>]+class="[^"]*\bhidden\b/i.test(guestEngine), "MCast loading UI must remain visible while the private engine starts");
assert.ok(sharedUi.includes("installLegacyUiQuarantine"));
assert.ok(sharedUi.includes("quarantineLegacyNodes(document.body, false)"));
assert.ok(sharedUi.includes("isActiveLegacyUi"));
assert.ok(sharedUi.includes("installLegacyBrowserDialogGuard"));
assert.ok(sharedUi.includes("captureEngineMessage"));
assert.ok(sharedUi.includes("showMediaError"));
assert.ok(sharedUi.includes("mcast:open-settings"));
assert.ok(sharedUi.includes("resolveNoticeRail"));
assert.ok(sharedUi.includes("resolveFooterRail"));
assert.ok(sharedUi.includes("mountDialogHost"));
assert.ok(sharedUi.includes("clearNotices"));
assert.ok(sharedUi.includes("clampNumber(options.duration, 1800, 30000, 10000)"), "header notices must use the ten-second lifecycle");
assert.ok(sharedUi.includes("lockRouteErrorTitle"), "route failures must keep an MCast-owned browser title");
assert.ok(!sharedUi.includes("g|m|c|s|p|i|rv|ra|rs"), "shared UI must not retain legacy route aliases");
assert.ok(sharedCss.includes('[data-mcast-upstream-ui="quarantined"]'));
assert.ok(sharedCss.includes("body > *:not(#mcastDesktopGuest):not(#mcastMobileGuest):not(#mcastGuestUiRoot)"));
assert.ok(sharedCss.includes("html:not(.mcast-route-error) .mcast-guest-ui__dialog"), "action-required messages must use the footer tray");
assert.ok(sharedCss.includes('[data-mcast-footer-rail] > .mcast-guest-ui__backdrop'), "action-required messages must dock inside the active footer rail");
assert.ok(sharedCss.includes("pointer-events: none"), "message chrome must not block the content surface");
assert.ok(desktopShell.includes("syncLocalVideoPresentation"), "desktop media surfaces must discard upstream positioning transforms");
assert.ok(!mainCss.includes("MCast native guest route"), "discarded parallel guest restyle must stay removed");
assert.ok(!mainCss.includes("body.mcast-native-guest"), "main engine stylesheet must not own the MCast guest shell");

[desktopShell, mobileShell].forEach((shell) => {
	assert.ok(shell.includes("MCastGuestUi"), "each responsive shell must use the shared branded UI authority");
	assert.ok(shell.includes('addEventListener("mcast:open-settings"'));
	assert.ok(shell.includes("state.boundLocalVideo === video"));
	assert.ok(shell.includes("state.boundLocalStream === stream"));
	assert.ok(shell.includes("state.boundLocalSurface === surface"));
	assert.ok(
		!/setStatus\s*\(\s*error\.message|textContent\s*=\s*error\.message|innerHTML\s*=\s*error\.message/.test(shell),
		"raw media errors must not be rendered by a shell"
	);
	assert.ok(!/VDO\.Ninja|Video\s*Ninja/i.test(shell), "custom shell copy must remain MCast-owned");
});
assert.ok(
	desktopShell.includes("if (state.previewStarted || state.joined)"),
	"desktop polling must not touch the private engine video before the user starts media"
);

console.log("MCast short-route and branded-UI regression passed");
