# MCast VDO Fork Context

This fork is deployed for MCast Studio guest calls at `https://vn.gjhlab.com/`.

Upstream sync policy:
- This repository is a GitHub fork of `steveseguin/vdo.ninja`, but upstream changes must not be auto-merged or auto-deployed.
- Keep GitHub Actions free of scheduled upstream-sync jobs. Pull upstream only when the MCast team intentionally decides to update the fork.
- Local checkout should normally have only `origin`; add an `upstream` remote temporarily only for an intentional sync/review.

Routes:
- `/` is intentionally a redirect-only page to `https://gjhlab.com/`.
- `/g/` is the human guest invitation route.
- `/vcall/` is the room/director/source-capture route used by the desktop app and internal browser windows.

Token handling:
- MCast desktop links use `?t=v1...`.
- MCast desktop can also create short guest links as `/g/?s=CODE`; `mcast-route.js` resolves `CODE` via `https://mcast-studio.web.app/api/vdoShortInviteResolve` and then uses the returned encrypted `t` token.
- `mcast-route.js` decodes the token with the same CryptoJS/OpenSSL AES-CBC passphrase used in the desktop app.
- The decoded query is assigned to `session.decrypted` before `lib.js` runs, so the upstream VDO parser and startup flow still own room joining.
- This token is link packing and casual tamper resistance, not strong secrecy, because the decode passphrase is present in client-side JavaScript.

Guest flow:
- `/g/` adds `webcam`, `autostart`, `nosettings`, and `mcastguest` defaults.
- Guest UI option cards are hidden with route-specific CSS so guests go through the direct camera-join path.

Source/host flow:
- Keep director links and browser-source capture links on `/vcall/`.
- Do not route clean output, source capture, host/director, or return-audio windows through `/g/`.
- Desktop director links use `mcastbridge`; this route forces `showdirector`, `mutespeaker`, `autostart`, and `quality=0`.
- Desktop source receiver links use `mcastsource` and/or `cbguestkey`; this route forces clean output/viewer flags, mute/autostart, and `quality=0` so the desktop app can capture full-quality guest media from the single director WebView bridge.
