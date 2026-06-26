# §2.1 Multi-provider routing — verification evidence

**Claim:** A non-Claude provider is realized by respawning the SAME `claude`
binary + stream-json parser with `ANTHROPIC_BASE_URL` pointed at a router
(claude-code-router / LiteLLM / OpenRouter), not by spawning a foreign CLI.

**Method:** Started a local mock HTTP endpoint on 127.0.0.1:4999, then spawned
`claude` exactly as Yumi's routed-provider path does (the stream-json args from
`build_spawn_plan`) with `ANTHROPIC_BASE_URL=http://127.0.0.1:4999`.

**Result (ground truth — `docs/evidence/v1-provider-routing-mock.log`):**
```
LISTENING 4999
HIT HEAD / ua=Bun/1.4.0 len=0
HIT POST /v1/messages?beta=true ua=claude-cli/2.1.193 (external, sdk-cli) len=187229
HIT POST /v1/messages?beta=true ua=claude-cli/2.1.193 (external, sdk-cli) len=187215
```
`claude` routed its real `POST /v1/messages` traffic (full ~187KB request) to the
configured base URL. A router placed there would translate that to any backend
model. The CLI exits non-zero only because the *mock* doesn't speak the protocol
— the HIT log is the proof the routing path works.

**Unit coverage:** `provider::tests::routed_provider_injects_base_url_with_identical_claude_args`,
`routed_provider_without_router_is_an_error_not_a_fake` (a non-Claude provider
with no router URL returns a clear error — never a fake success).
