# MCast VDO Fork Context

This fork is deployed for MCast Studio guest calls at `https://vn.gjhlab.com/`.

Routes:
- `/` is intentionally a redirect-only page to `https://gjhlab.com/`.
- `/g/` is the human guest invitation route.
- `/vcall/` is the room/director/source-capture route used by the desktop app and internal browser windows.

Token handling:
- MCast desktop links use `?t=v1...`.
- `mcast-route.js` decodes the token with the same CryptoJS/OpenSSL AES-CBC passphrase used in the desktop app.
- The decoded query is assigned to `session.decrypted` before `lib.js` runs, so the upstream VDO parser and startup flow still own room joining.
- This token is link packing and casual tamper resistance, not strong secrecy, because the decode passphrase is present in client-side JavaScript.

Guest flow:
- `/g/` adds `webcam`, `autostart`, `nosettings`, and `mcastguest` defaults.
- Guest UI option cards are hidden with route-specific CSS so guests go through the direct camera-join path.

Source/host flow:
- Keep director links and browser-source capture links on `/vcall/`.
- Do not route clean output, source capture, host/director, or return-audio windows through `/g/`.
