# Killio Vault

Android-first React Native companion to Killio: 24/7 audio diary, hands-free
assistant, and on-device local agents. See the full plan at
`C:\Users\ejane\.claude\plans\ayudame-a-hacer-alguito-lively-firefly.md`.

## Status — all 5 phases scaffolded

- **Phase 0 — Scaffold + Auth:** expo-router app, dark theme ported from the web
  frontend, Keystore token store, axios single-flight refresh (body-token),
  password + OTP login, session restore, personal-team resolution.
- **Phase 1 — Diary:** Android microphone foreground service (Kotlin, typed FGS)
  + AudioRecord → energy VAD → STT engine → offline outbox → `POST /vault/diary/ingest`.
  Consent gate, schedule windows (24/7 / hours / off), diary screen.
- **Phase 2 — Assistant + mobile tools:** SSE stream to `/agent/chat/stream`,
  native TTS, client-action tools (`call_number`/`open_app`/`open_browser`/
  `vault_upload_screenshot`) via the backend pause/resume, `tts_search` diary tool.
- **Phase 3 — Local agents + memory:** on-device agent CRUD (op-sqlite), vector
  memory (JS cosine over `/ai/embed` vectors), `save/search/list/read_memory`,
  `LocalAgentRuntime` (persona + assigned docs + memory injected locally).
- **Phase 4 — Cloud STT + screenshots + wake word:** `SttService` (OpenAI/Deepgram)
  behind `/vault/stt` (credit-metered), MediaProjection screen-capture interface +
  screenshot upload, 3-phrase wake-word interface.
- **Phase 5 — Gating:** plan-tier Vault entitlements (`/vault/entitlements`),
  upsell in Settings, agent-count limit.

## Layout

```
app/                 # screens: index, login, home, consent, diary, settings, assistant, agents
src/core/            # api/ (http, auth, teams, vault, agent, ai, uploads, documents), auth/, device
src/db/              # op-sqlite (outbox + local_agents + agent_memory)
src/capture/         # foreground-service controller, schedule, permissions, native bridge
src/stt/             # VAD segmenter + engine interface (whisper.rn / null)
src/agents/          # local-agent model, LocalAgentRuntime, memory/ (tools + vector)
src/screen/          # MediaProjection screen-capture interface
src/wakeword/        # Porcupine wake-word interface
src/tts/ src/actions/ src/settings/ src/theme/ src/ui/
modules/killio-capture/   # local Expo module: Kotlin mic foreground service
plugins/withVaultCapture.js  # Android permissions config plugin
```

## Native vs Expo Go

Pure-JS code (auth, API, diary UI, assistant text chat, agents, memory) runs in
Expo Go. The native pieces — mic foreground service, screen capture, wake word,
on-device whisper — require the **dev-build APK** and are gated behind
`isAvailable()` checks so the app degrades gracefully in Expo Go.

## Run

```bash
cd Killio-Vault
npm install
# Point at your backend. Android emulator -> host is 10.0.2.2; physical device
# uses the host LAN IP. Backend: `cd ../Killio-Backend && npm run dev` (port 4000).
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000 npm start
```

Expo Go is fine for Phase 0 (pure JS/UI). Phases 1+ (mic foreground service,
wake word, screen capture) require a custom dev-build APK.

## Verify (Phase 0)

1. Start backend (`Killio-Backend`, port 4000).
2. Launch the app, log in with a seeded account.
3. Expect: route to `home`, personal workspace name shown.
4. Kill + reopen → session restores without re-login (token refresh round-trips).
