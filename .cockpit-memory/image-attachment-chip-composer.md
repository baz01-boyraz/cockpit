---
schema: 1
name: image-attachment-chip-composer
title: Image attachment chip UX in composer
class: architecture
capturedAt: 2026-07-13T01:45:52.121Z
gate: save
updatedAt: 2026-07-13T01:45:52.121Z
---

Images uploaded to terminal agent now appear as styled thumbnail chips inside the composer (filename + size + × dismiss button, shimmer animation on save), replacing raw absolute-path links. Send button shows a chip count badge. Max 4 images per message. The old floating attachment panel and the toolbar screenshot button were removed. The sent line uses a short relative path (.dev-cockpit/attachments/…); absolute path is preserved only in raw shell terminal output (because cd may have changed cwd).

Related: [[terminal-composer-single-input]]
