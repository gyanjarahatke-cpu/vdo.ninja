"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const port = Number.parseInt(process.env.MCAST_LOCAL_PORT || "8089", 10);
const host = "127.0.0.1";
const inviteQueries = new Map([
	["BROWG001", "room=browser-guest&push=browser-guest&webcam&mcastmode=meeting&mcastrole=participant&mcaststate=backstage&mcastrouting=low_bitrate&label=Browser%20Guest&autostart&mcastautojoin"],
	["BROWCAM1", "room=browser-remote&push=browser-camera&mcastmode=stream_guest&mcastremote=remote_camera&autostart&mcastautojoin"],
	["BROWAUD1", "room=browser-remote&push=browser-audio&mcastmode=stream_guest&mcastremote=remote_audio&autostart&mcastautojoin"],
	["BROWSCN1", "room=browser-remote&push=browser-screen&screenshareid=browser-screen&mcastmode=stream_guest&mcastremote=remote_screen&autostart&mcastautojoin"]
]);
const inviteLeases = new Map();

const contentTypes = new Map([
	[".css", "text/css; charset=utf-8"],
	[".html", "text/html; charset=utf-8"],
	[".ico", "image/x-icon"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".mjs", "text/javascript; charset=utf-8"],
	[".png", "image/png"],
	[".svg", "image/svg+xml"],
	[".webp", "image/webp"]
]);

const server = http.createServer(async (request, response) => {
	try {
		const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
		if (requestUrl.pathname === "/api/vdoShortInviteResolve") {
			const code = requestUrl.searchParams.get("code") || "";
			const query = inviteQueries.get(code);
			if (!query) {
				writeJson(response, 404, { error: "not-found" });
				return;
			}
			writeJson(response, 200, { query, route: "guest" });
			return;
		}
		if (/^\/api\/vdoShortInvite(?:Claim|Heartbeat|Release)$/.test(requestUrl.pathname)) {
			if (request.method !== "POST") {
				writeJson(response, 405, { error: "method-not-allowed" });
				return;
			}
			const body = await readJson(request);
			const code = String(body.code || "");
			if (!inviteQueries.has(code)) {
				writeJson(response, 404, { error: "route-not-found" });
				return;
			}
			const now = Date.now();
			const active = inviteLeases.get(code);
			if (requestUrl.pathname.endsWith("Claim")) {
				if (active && active.expiresAt > now) {
					writeJson(response, 409, { error: "invite-in-use" });
					return;
				}
				const token = crypto.randomBytes(32).toString("base64url");
				const lease = { token, expiresAt: now + 120_000 };
				inviteLeases.set(code, lease);
				writeJson(response, 201, {
					leaseToken: token,
					expiresAt: new Date(lease.expiresAt).toISOString(),
					heartbeatAfterMs: 30_000
				});
				return;
			}
			if (!active || active.token !== body.leaseToken || active.expiresAt <= now) {
				writeJson(response, 409, { error: "invite-lease-lost" });
				return;
			}
			if (requestUrl.pathname.endsWith("Heartbeat")) {
				active.expiresAt = now + 120_000;
				writeJson(response, 200, {
					expiresAt: new Date(active.expiresAt).toISOString(),
					heartbeatAfterMs: 30_000
				});
				return;
			}
			inviteLeases.delete(code);
			response.writeHead(204, { "Cache-Control": "no-store" });
			response.end();
			return;
		}

		const isInvite = /^\/s\/[A-Za-z0-9]{6,32}\/?$/.test(requestUrl.pathname);
		const relativePath = isInvite
			? "mcast-guest.html"
			: requestUrl.pathname === "/" ? "404.html" : decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
		const filePath = path.resolve(root, relativePath);
		if (filePath !== root && !filePath.startsWith(root + path.sep)) {
			writeText(response, 403, "Not available");
			return;
		}
		const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
		const resolvedFile = stat && stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
		if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
			writeText(response, 404, "Not found");
			return;
		}
		response.writeHead(200, {
			"Content-Type": contentTypes.get(path.extname(resolvedFile).toLowerCase()) || "application/octet-stream",
			"Cache-Control": "no-store"
		});
		fs.createReadStream(resolvedFile).pipe(response);
	} catch (_error) {
		writeText(response, 500, "Could not load this page");
	}
});

server.listen(port, host, () => {
	process.stdout.write(`MCast local guest server listening on http://${host}:${port}\n`);
});

function writeJson(response, status, payload) {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	response.end(JSON.stringify(payload));
}

function writeText(response, status, text) {
	response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
	response.end(text);
}

function readJson(request) {
	return new Promise((resolve, reject) => {
		let raw = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			raw += chunk;
			if (raw.length > 4096) {
				reject(new Error("request-too-large"));
				request.destroy();
			}
		});
		request.on("end", () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}
