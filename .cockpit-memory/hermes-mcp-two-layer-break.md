---
schema: 1
name: hermes-mcp-two-layer-break
title: Hermes MCP: tool recognition layer and transport/auth layer are independent failure modes
class: gotcha
capturedAt: 2026-07-10T01:54:48.027Z
gate: save
updatedAt: 2026-07-10T01:54:48.027Z
---

In v0.2.1, the -t whitelist fix in HermesChatService.ts (adding 'cockpit' to HERMES_CHAT_TOOLS) succeeded — Hermes recognized cockpit tool names and no longer said 'tools unavailable'. But the MCP transport/auth layer remained broken: either the MCP server never started (Services.ts silently swallows HermesMcpServer.start() failure) or the bearer token env var didn't reach the Hermes spawn. These are TWO INDEPENDENT failure layers: tool name identification (-t whitelist) and transport connectivity (server startup + auth token flow). One can pass while the other is completely broken, and they produce different symptoms: tool names work → Hermes lists tools correctly but every call fails with 'unreachable'. When debugging MCP integration, always check both layers independently — lsof for server listening, curl for auth response, env inspection for token propagation. The silent error swallowing at boot makes server-startup failures invisible in the UI.

Related: [[hermes-mcp-architecture]], [[mcp-token-chat-only]]
