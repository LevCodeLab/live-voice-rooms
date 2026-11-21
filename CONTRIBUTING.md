# Contributing to live-voice-rooms

Thanks for hacking on `live-voice-rooms`! Keep PRs small, focused, and easy to review.

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the signaling and room API test suite:
   ```bash
   npm test
   ```
3. Verify the production frontend bundle compiles cleanly:
   ```bash
   npm run build
   ```

## Guidelines

- Keep the signaling protocol lightweight JSON over `ws`.
- Avoid routing remote WebRTC `MediaStream` audio to `AudioContext.destination` on listeners (use an `<audio>` element for playback and an unconnected `AnalyserNode` for visualization).
- Keep UI components strictly monochrome (`#141418` background, `#26262E` border, `#FFFFFF` / `#E4E4E7` text).
