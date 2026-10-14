# Task 1 implementation report

## Status and scope

Implemented the backend side of the approved persistent ESP32-to-backend TCP design in the isolated `backend-hosted-tcp` worktree. Only the active checkout's `/api/arm/angles` handler was consulted for its existing HTTP contract. No active-checkout files were modified. Neither local `.env` nor firmware `sdkconfig` was opened.

The dispatch instruction and parent clarification supersede Step 5's older no-commit wording: commit only this isolated task's files, leaving the active checkout untouched.

## Changes

- Added `backend/firmware_link.js` with `createFirmwareLink({ackTimeoutMs = 2000} = {})`, returning `{server, sendTarget}`.
- The TCP server tracks one current connection, closes and invalidates the previous connection on replacement, and uses a shared FIFO command queue with one outstanding acknowledgement.
- Requests fail immediately with 503 without an available writable socket. Disconnects and replacements reject outstanding and queued requests with 503.
- Each command is written as `channel:angle\n`. Its acknowledgement deadline starts after the write callback, excluding queue wait time.
- Only exact `OK\n` and `ERR\n` frames are accepted; valid partial prefixes are buffered with a maximum of four bytes. ERR rejects its command with 502 and allows the queue to proceed. Malformed data rejects the current command with 502 and closes the connection; timeout rejects it with 504 and closes the connection. Both invalidate queued requests with 503. No commands are retried.
- Updated `backend/app.js` to inject `sendTarget` into both HTTP routes. Removed outbound per-command sockets and the `ESP32_HOST` requirement.
- Preserved the servo route's validation and Dutch responses. Ported the current six-channel batch handler with its exact validation, channel order 0 through 5, response wording, and sequential stop-on-first-rejection loop. The batch's calls share the same queue as single-servo requests.
- Updated `backend/server.js` to validate `FIRMWARE_PORT` (default 3333) using the existing port pattern, bind TCP on `0.0.0.0`, then bind HTTP using `PORT` (default 3000), log both listener ports, and report listener bind errors before exiting with failure.
- Updated `backend/.env.example` to `FIRMWARE_PORT=3333` and `PORT=3000`. The package start command and Node env-file startup behavior are unchanged.

## Files changed

- `backend/firmware_link.js` (created)
- `backend/app.js`
- `backend/server.js`
- `backend/.env.example`
- `.superpowers/sdd/2026-10-15-backend-hosted-tcp/task-1-report.md` (created)

## Verification and tests

No tests were added or run, no application listeners were started, and no packages were installed, as required by the dispatch and plan constraint. Runtime behavior is therefore unverified.

Reviewed the full backend diff and the new connection manager source, including fragmented acknowledgements, malformed and oversized frames, queue progression after ERR, socket replacement, write-callback guards, timeout invalidation, stale connection events, and startup errors. `git diff --check` completed successfully with no whitespace errors before staging.

## Self-review findings

- The connection identity guard prevents close/error/write events from an old socket from invalidating a replacement socket or its queue.
- Pending state is established before writing, and a late write callback cannot arm a deadline for a command that already settled.
- Connection invalidation occurs before promise rejection and socket destruction, preventing rejected requests or late socket events from continuing on the old connection.
- The entire batch is validated before any command is sent, and the awaited loop stops after its first failure. Already accepted channels can still move, as the preserved response explicitly warns.
- No known implementation defects were identified during static review.

## Concerns and limits

- Socket timing, binding errors, and HTTP behavior were reviewed statically only; integration with the persistent firmware client remains to be exercised when testing is authorized.
- Existing tests that construct `createApp` with outbound host/port options must be migrated to the new injected `sendTarget` contract when tests are authorized.
- The protocol has no acknowledgement identifier, so queue safety depends on one reply per command. Closing the connection after malformed data or timeout prevents those failed exchanges from satisfying later commands.
