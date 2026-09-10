# apicalls eval run — 2026-09-10

Shallow clones, no `node_modules` installed in the targets (types of third-party packages are therefore unresolved; SDK detection relies on imports). Per-repo JSON reports are in `eval/out/<repo>.json`.

| repo | scanned dir | files | calls | conf ≥ 0.7 | sdk | with body | with dynamic | time | top providers |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| dub | apps/web | 2420 | 424 | 110 | 110 | 197 | 365 | 8.9s | internal=133 stripe=104 unknown=59 vercel=30 api.us-east.tinybird.co=23 slack=13 google=12 api.partnerstack.com=7 |
| cal.com | packages/app-store | 822 | 244 | 42 | 42 | 134 | 214 | 2.7s | unknown=46 stripe=42 api.daily.co=24 open.feishu.cn=19 open.larksuite.com=19 internal=12 calendar.zoho.{server_location}=10 microsoft=9 |
| n8n | packages/nodes-base | 3576 | 5406 | 0 | 0 | 4269 | 4537 | 9.9s | unknown=1505 google=509 internal=444 hubspot=329 api.clickup.com=160 api.harvestapp.com=92 notion=91 api.pipedrive.com=86 |
| twenty | packages/twenty-server | 8454 | 79 | 33 | 33 | 48 | 74 | 17s | aws=33 unknown=29 github=7 resend=4 internal=3 models.dev=2 api.oneleet.com=1 |
| supabase | apps/studio | 3979 | 110 | 0 | 0 | 38 | 99 | 14.4s | unknown=82 env:SUPABASE_URL=7 github=5 env:NEXT_PUBLIC_API_DOMAIN=4 internal=2 supabase=2 api.incident.io=2 www.cloudflare.com=1 |
| formbricks | apps/web | 1841 | 134 | 6 | 6 | 61 | 113 | 6.7s | internal=69 unknown=15 airtable=11 api.brevo.com=8 stripe=6 notion=5 slack=5 airtable.com=3 |
| documenso | packages/lib | 559 | 26 | 6 | 6 | 15 | 25 | 4.6s | unknown=18 aws=5 stripe=1 challenges.cloudflare.com=1 license.documenso.com=1 |
| trigger.dev | apps/webapp | 1968 | 92 | 8 | 8 | 58 | 90 | 11.9s | unknown=46 internal=16 vercel=4 api.attio.com=4 aws=4 {posthog_assets_host}=3 a.s2.dev=3 slack=2 |
| teable | apps/nestjs-backend | 1134 | 584 | 15 | 15 | 319 | 422 | 16.7s | internal=311 unknown=237 aws=15 google=5 airtable=4 access-checker.teable.ai=3 airtable.com=2 challenges.cloudflare.com=2 |
| medusa | packages/modules/providers | 66 | 27 | 23 | 23 | 16 | 25 | 0.9s | stripe=16 aws=7 github=3 google=1 |
| vercel-ai | packages | 2459 | 247 | 0 | 0 | 155 | 240 | 7s | unknown=214 ai-gateway.vercel.sh=11 api.x.ai=7 internal=5 localhost:=4 queue.fal.run=2 google=2 {expr}=1 |
| novu | packages/providers | 130 | 55 | 1 | 1 | 48 | 25 | 0.9s | unknown=14 internal=9 smba.trafficmanager.net=5 slack=4 api.sendblue.co=1 telegram=1 graph.facebook.com=1 mailgun=1 |
| outline | plugins | 190 | 19 | 0 | 0 | 2 | 18 | 2.2s | unknown=16 slack=2 microsoft=1 |
| hoppscotch | packages/hoppscotch-backend | 191 | 0 | 0 | 0 | 0 | 0 | 0.8s |  |
| immich | server | 499 | 11 | 0 | 0 | 0 | 11 | 2.3s | unknown=11 |
| nocodb | packages/nocodb | 1241 | 42 | 3 | 3 | 18 | 34 | 8.3s | unknown=21 localhost:{env:port}=5 telemetry.nocodb.com=5 aws=3 airtable.com=2 localhost:=2 product-feed.nocodb.com=2 github=1 |
| infisical | backend | 3683 | 1551 | 18 | 18 | 642 | 1422 | 28.3s | unknown=820 microsoft=66 vercel=66 internal=55 google=49 cloudflare=41 api.render.com=25 github=23 |
| activepieces | packages/pieces/community | 9795 | 8416 | 85 | 85 | 3649 | 7419 | 19.2s | unknown=2715 google=139 api.clickup.com=109 github=104 api.crmworkspace.com=95 api.convertkit.com=87 api.zoo.dev=81 proxy.whatsscale.com=77 |
| openstatus | apps/web | 153 | 27 | 0 | 0 | 7 | 24 | 0.8s | unknown=17 internal=5 checker.openstatus.dev=2 env:SLACK_FEEDBACK_WEBHOOK_URL=1 api.openstatus.dev=1 github=1 |
| directus | api | 832 | 13 | 0 | 0 | 6 | 11 | 3.3s | unknown=9 google-ai=2 anthropic=1 openai=1 |

**Totals over 20 repos:** 43992 files scanned, 17507 calls found, 350 at confidence ≥ 0.7, 350 via SDK registries, 9682 with a body shape, 15168 with at least one dynamic part, 167s total scan time.

## Commits scanned

- dub: 14181a920cbff3294b1067ae3c3e153bfa2fa1af
- cal.com: b3321936c347744a759e0f36a9793bb78c9bca78
- n8n: 4a3fc82d85e9eff8e606e18cde8755e72af1e06a
- twenty: 7a95c177372bc7679e115ca040e6802c1f9aac07
- supabase: 83c33e903c920aa40cfc811e2a5bd81c40e0412d
- formbricks: 3a5cc8adc11efb9211721d9f17226ab3c952338e
- documenso: 389390c884949fe27c240488a3259da3cdba93e0
- trigger.dev: 6f5c49c02145309152b6736c54a07e927469ad84
- teable: 5ef2238883cad7c3980084de9a9031135fb9734f
- medusa: 9508d6ebaa7bd6222b37a25c0f62eb6264411600
- vercel-ai: 45f2b6a5bc06bdb40a847ea961f8d7ca7cd86563
- novu: 8d058d98c42ac32e41a6e6e5f675cce80929bb38
- outline: 4a5a616a21be800257dc11cef4263d0dd0412156
- hoppscotch: ac145e7f758151b41fd46d3e5f513886ce9068ba
- immich: 86ae0dd06c7f5df1369e8c4daa20f28c3bd3bf0a
- nocodb: fb5b841148c24177554558fcc7ccd592ddd52ebd
- infisical: 3b4dd11b00c308c412ce804795352440deb784a4
- activepieces: 38416c450408bd414ad3b285fe1d616c77fb74ee
- openstatus: e89b614b7b838e4831699c5789cd68f17fa8fbd6
- directus: a5da59da94bb33c8d644df93a21403eca4c1a4e7

## Example requests

Each call now carries synthesized `examples` (`--curl` renders them). "resolved url" counts calls whose first
example has no `{placeholder}` left in the URL (an unresolved host such as `https://{baseUrl}/…` or `{env:API_URL}`).

| repo | calls | examples | calls with >1 example | resolved url | with body | via framework helper |
|---|---:|---:|---:|---:|---:|---:|
| activepieces | 8416 | 8924 | 423 | 5317 (63%) | 5301 | 8235 |
| n8n | 5406 | 5554 | 142 | 3627 (67%) | 4801 | 5399 |
| infisical | 1551 | 1741 | 150 | 677 (44%) | 643 | 0 |
| teable | 584 | 625 | 41 | 330 (57%) | 323 | 0 |
| dub | 424 | 482 | 48 | 358 (84%) | 223 | 0 |
| vercel-ai | 247 | 374 | 83 | 31 (13%) | 173 | 232 |
| cal.com | 244 | 265 | 17 | 178 (73%) | 134 | 0 |
| formbricks | 134 | 151 | 13 | 119 (89%) | 65 | 0 |
| supabase | 110 | 124 | 9 | 15 (14%) | 42 | 0 |
| trigger.dev | 92 | 113 | 16 | 37 (40%) | 62 | 0 |
| twenty | 79 | 85 | 6 | 17 (22%) | 52 | 0 |
| novu | 55 | 59 | 2 | 39 (71%) | 49 | 0 |
| nocodb | 42 | 45 | 3 | 13 (31%) | 18 | 0 |
| others (7 repos) | 123 | 133 | 6 | 39 | 57 | 0 |

**Totals:** 17507 calls, 18675 examples, 10797 calls (62%) with a fully resolved example URL, 11943 with a body.

## Findings from this run (2026-09-10)

Compared with the 2026-09-09 run (3641 calls): 17507 calls, same 20 repos and commits.

- **Framework helpers closed the biggest recall gap.** `src/detect/registry/frameworks.json` describes
  options-object helpers (n8n `this.helpers.httpRequest` / `request` / `*WithAuthentication.call(this, cred, options)`,
  activepieces `httpClient.sendRequest`, ai-sdk `postJsonToApi` and friends). n8n went from 7 to 5406 calls,
  activepieces from 181 to 8416, vercel/ai from 15 to 247.
- **Wrapper expansion follows `fn.call(this, …)`.** n8n nodes call their `GenericFunctions` wrappers that way;
  4942 of the n8n calls and 4880 of the activepieces calls are reported at the node call site with the
  caller's method / resource / body substituted. Two bugs surfaced and were fixed: a TypeScript `this`
  parameter was counted as a real parameter (shifting every argument by one), and `const { body, ...rest } =
  options` inside a wrapper did not resolve back to the caller's object.
- **Bodies that collapsed to a string.** `` `delete_condition=${x}` `` with a form content type, `body ?
  JSON.stringify(body) : undefined`, `new URLSearchParams({...}).toString()` and `qs.stringify(obj)` are now
  unwrapped into object shapes (dub went from 4 string-shaped bodies to 2).
- **Enum members from uninstalled packages.** `HttpMethod.POST` / `AuthenticationType.BEARER_TOKEN` read as
  their member name when the enum's package has no types installed, which fixes activepieces methods and auth.
- **Memory.** 9.8k-file activepieces needs ~2.8 GB of heap; the CLI now re-runs itself with
  `--max-old-space-size=8192` (`APICALLS_HEAP_MB` overrides) and `pnpm eval` passes the flag explicitly.

Where example URLs are still unresolved (38% overall):

- **Config-carried hosts**: vercel/ai (`this.config.url({ path })`, path kept, base dynamic), supabase studio
  (`API_URL` from a workspace package), twenty and trigger.dev (`this.baseUrl` set from injected config).
  Resolving these needs either workspace package linking or a "constructor argument" hop.
- **n8n / activepieces credentials**: `${credentials.domain}` / `${auth.baseUrl}` hosts are user-provided by
  design and stay `{baseUrl}`-style placeholders; the path and body are still concrete.

Precision has not been measured yet: `pnpm eval:score sample <repo> 100` produces the labeling sheet.
