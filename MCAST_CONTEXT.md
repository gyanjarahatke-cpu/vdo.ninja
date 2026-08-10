# MCast VDO Fork Context

This fork is deployed for MCast Studio guest and remote-source sessions at `https://co.mcaststudio.com/` through the single Firebase Hosting production path.

Upstream sync policy:
- This repository is a GitHub fork of `steveseguin/vdo.ninja`, but upstream changes must not be auto-merged or auto-deployed.
- Keep GitHub Actions free of scheduled upstream-sync jobs. Pull upstream only when the MCast team intentionally decides to update the fork.
- Local checkout should normally have only `origin`; add an `upstream` remote temporarily only for an intentional sync/review.

Routes:
- `/` is intentionally a redirect-only page to the MCast Studio website.
- `/s/<code>` is the only public guest, remote camera, remote audio, and remote screen invitation path. The encrypted invite payload selects the experience.
- `/g/index.html` is the private guest engine document loaded by the centralized branded route loader; it is not a direct invitation contract.
- `/vcall/` is the room/director/source-capture route used by the desktop app and internal browser windows.

Token handling:
- MCast desktop creates short guest and remote-source links whose visible URL contains only a route-specific path and opaque short code.
- The centralized `mcast-guest.html` loader resolves the code from the same origin through `/api/vdoShortInviteResolve`, validates the route, and injects the decoded query into the private engine document before `mcast-route.js` runs.
- MCast desktop creates protected room/director/source links as `/vcall/?r=CODE`; `mcast-route.js` resolves `CODE` via `https://mcast-studio.web.app/api/vdoRoomTicketResolve`.
- Public guest and remote-source paths must not accept direct `?t=`, raw media-room query strings, or route state recovered from browser storage.
- `/vcall/` must not accept direct `?t=` or raw room query strings. Protected tokens are decrypted and validated only in Firebase Functions with the `VDO_TOKEN_PASSPHRASE` secret.
- The decoded query is assigned to `session.decrypted` before `lib.js` runs, so the upstream VDO parser and startup flow still own room joining.

Guest flow:
- Guest and remote-source routes use the authoritative MCast desktop/mobile shells for setup, permissions, settings, status, warnings, recovery, and in-room controls.
- The upstream engine DOM remains private and quarantined; it must never become visible or provide user-facing warnings, dialogs, settings, or errors.
- Camera, microphone, speaker, processing, and screen-audio settings are collected by MCast UI. Browser permission requests occur only after an explicit user action.

Source/host flow:
- Keep director links and browser-source capture links on `/vcall/`.
- Do not route clean output, source capture, host/director, or return-audio windows through `/g/`.
- Desktop director links use `mcastbridge`; this route forces `showdirector`, `mutespeaker`, `autostart`, and `quality=0`.
- Desktop source receiver links use `mcastsource` and/or `cbguestkey`; this route forces clean output/viewer flags, mute/autostart, and `quality=0` so the desktop app can capture full-quality guest media from the single director WebView bridge.
