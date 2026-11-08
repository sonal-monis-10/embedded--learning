# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Demo visitors (primary).** Strangers at an event, stall or showcase. They see the device, scan the pairing QR shown on its own OLED with their phone camera, type a name, and play with it for a few minutes. They have never seen the app, get no explanation, and leave when it stops being fun or clear. One visitor controls a device at a time; the next visitor gets a fresh QR on the OLED when the turn ends.
- **The maker (Sonal).** Builds and flashes the firmware (devices register themselves on first boot), and does maintenance with curl when needed (delete a device, release it, run the cleanup). There is no admin web page.

## Product Purpose

A personal embedded/IoT learning and hobby project: an ESP32 with a 1.3" SH1106 OLED (128×64, monochrome) that a phone controls over the internet. Success is that it works end to end and the owner understands every part of it, from the framebuffer to the broker; showing it to visitors is how it gets played with, not a business.

## Positioning

A small physical screen that reacts to the phone in your hand: tilt it and robot eyes on the OLED follow; pick a song and its lyrics animate on the device in time with the music. No account, no install: scan, type a name, play.

## Operating Context

- Visitors stand next to the device and look back and forth between their phone and the OLED; the device is the show, the phone is the controller.
- In Eyes mode the phone is held and tilted while the app is open, so the app is used one-handed.
- Pairing: a free device's OLED shows its device ID, a QR and the code in text (sent by the server). Codes are single-use and replaced every 2 minutes. A turn ends when the visitor taps Leave, after 10 minutes without activity, or at 00:00 IST, when all people data is wiped; the OLED then shows a fresh QR.
- The device may be offline or the free Render backend may be waking up (~1 min cold start); visitors will hit these states.

## Capabilities and Constraints

- Modes: `idle`, `eyes` (phone gyroscope/accelerometer streamed over a WebSocket; basic in phase 1, richer in phase 2), `music` (song search, disc + progress or synced lyrics, phase 3), AI lyric animations (phase 4).
- One phone controls one device, and a device has one controlling phone at a time. Pairing another device releases the first.
- Devices register themselves with the `PROVISION_KEY` built into the firmware; maintenance routes need the `ADMIN_KEY`.
- Motion sensors on iOS need HTTPS and a tap to grant permission.
- The OLED is 128×64, 1-bit; anything the app previews of the device should respect that.
- English only.
- Stack already in place: Vite + React (JavaScript) in `frontend/`, Render static site; backend API in `backend/` (see `docs/plan/README.md` §7).

## Evidence on Hand

- Architecture diagram: `docs/architecture.html`. Plan and API: `docs/plan/`.
- No photos of the device, no logo, no testimonials, no usage numbers. Do not invent any.

## Product Principles

1. **Works for a stranger in ten seconds.** Every screen a visitor sees explains itself; no jargon (MQTT, session, device ID) in visitor-facing copy.
2. **The device is the star.** The phone UI supports what happens on the OLED and points attention back to it.
3. **Honest states.** Offline devices, expired codes, a waking server and the midnight reset are shown plainly with a next step, never as generic errors.
4. **Small and understandable.** This is a learning project: prefer simple, readable implementations the owner can explain over clever ones.

## Accessibility & Inclusion

- WCAG 2.2 AA for all screens: contrast, labelled controls, keyboard and screen-reader support, `prefers-reduced-motion` respected.
- One-handed use on a phone: primary controls within thumb reach, large touch targets, nothing essential at the top corners in control screens.
- Sensor control always has a non-motion alternative (for visitors who can't or won't tilt the phone).
