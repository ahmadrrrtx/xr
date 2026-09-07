# XR Provider Capability Matrix (1.0.0)

**Generated:** 2026-09-07T13:56:54.229Z — from the provider catalog (catalog truth). 
A row can never claim a capability the catalog does not declare; fixture drift fails CI.

Legend: `✓` supported · `—` not declared · `fixture` = offline VCR contract fixture exists.

| preset | kind | tier | streaming | tool-use | native-tool-calls | json | vision | usage-reporting | fixture |
|---|---|---|---|---|---|---|---|---|---|
| anthropic | hosted | premium | ✓ | ✓ | ✓ | ✓ | ✓ | provider-reported with estimated fallback (F-13) | ✓ |
| bedrock | hosted | enterprise | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | — |
| cerebras | hosted | free | ✓ | — | — | — | — | n/a | — |
| cohere | hosted | premium | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| deepseek | hosted | free | ✓ | — | — | ✓ | — | n/a | — |
| fireworks | hosted | cheap | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| google | hosted | free | ✓ | ✓ | ✓ | ✓ | ✓ | provider-reported with estimated fallback (F-13) | ✓ |
| gpt4all | local | free | ✓ | — | — | — | — | n/a | — |
| groq | hosted | free | ✓ | ✓ | ✓ | ✓ | — | provider-reported with estimated fallback (F-13) | ✓ |
| huggingface | hosted | cheap | ✓ | — | — | ✓ | — | n/a | — |
| jan | local | free | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| koboldcpp | local | free | ✓ | — | — | — | — | n/a | — |
| llamacpp | local | free | ✓ | — | — | ✓ | — | n/a | — |
| lmstudio | local | free | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| localai | local | free | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| mistral | hosted | cheap | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| ollama | local | free | ✓ | ✓ | ✓ | ✓ | — | provider-reported with estimated fallback (F-13) | ✓ |
| openai | hosted | premium | ✓ | ✓ | ✓ | ✓ | ✓ | provider-reported with estimated fallback (F-13) | ✓ |
| openrouter | hosted | cheap | ✓ | ✓ | ✓ | ✓ | ✓ | provider-reported with estimated fallback (F-13) | ✓ |
| perplexity | hosted | premium | ✓ | — | — | ✓ | — | n/a | — |
| sambanova | hosted | cheap | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| sglang | local | free | ✓ | — | — | ✓ | — | n/a | — |
| textgenwebui | local | free | ✓ | — | — | — | — | n/a | — |
| together | hosted | cheap | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| vllm | local | free | ✓ | ✓ | ✓ | ✓ | — | n/a | — |
| xai | hosted | premium | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | — |

> **Live confirmation:** this matrix is the *declared* capability surface (catalog + offline fixtures).
> Live provider smoke is `provider-canaries` (`.github/workflows/provider-canaries.yml`), which probes a provider
> only when its API key is configured and never fabricates a pass. Hosted rows are `✓ fixture` (contract-tested offline);
> the hosted live canary rows are produced by the canary job and recorded separately.
