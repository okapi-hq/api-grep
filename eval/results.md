# apicalls eval run — 2026-09-09

Shallow clones, no `node_modules` installed in the targets (types of third-party packages are therefore unresolved; SDK detection relies on imports). Per-repo JSON reports are in `eval/out/<repo>.json`.

| repo | scanned dir | files | calls | conf ≥ 0.7 | sdk | with body | with dynamic | time | top providers |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| dub | apps/web | 2420 | 424 | 110 | 110 | 197 | 334 | 12.5s | internal=133 stripe=104 unknown=59 vercel=30 api.us-east.tinybird.co=23 slack=13 google=12 api.partnerstack.com=7 |
| cal.com | packages/app-store | 822 | 244 | 42 | 42 | 126 | 203 | 3s | unknown=46 stripe=42 api.daily.co=24 open.feishu.cn=19 open.larksuite.com=19 internal=12 calendar.zoho.{server_location}=10 microsoft=9 |
| n8n | packages/nodes-base | 3576 | 7 | 0 | 0 | 2 | 5 | 9.8s | 169.254.169.254=3 sts.{region}.{getawsdomain}=2 169.254.170.2=1 unknown=1 |
| twenty | packages/twenty-server | 8454 | 79 | 33 | 33 | 52 | 74 | 20.6s | aws=33 unknown=29 github=7 resend=4 internal=3 models.dev=2 api.oneleet.com=1 |
| supabase | apps/studio | 3979 | 110 | 0 | 0 | 38 | 99 | 18s | unknown=82 env:SUPABASE_URL=7 github=5 env:NEXT_PUBLIC_API_DOMAIN=4 internal=2 supabase=2 api.incident.io=2 www.cloudflare.com=1 |
| formbricks | apps/web | 1841 | 134 | 6 | 6 | 61 | 113 | 8.2s | internal=69 unknown=15 airtable=11 api.brevo.com=8 stripe=6 notion=5 slack=5 airtable.com=3 |
| documenso | packages/lib | 559 | 26 | 6 | 6 | 15 | 25 | 3.9s | unknown=18 aws=5 stripe=1 challenges.cloudflare.com=1 license.documenso.com=1 |
| trigger.dev | apps/webapp | 1968 | 92 | 8 | 8 | 48 | 90 | 12.7s | unknown=46 internal=16 vercel=4 api.attio.com=4 aws=4 {posthog_assets_host}=3 a.s2.dev=3 slack=2 |
| teable | apps/nestjs-backend | 1134 | 584 | 15 | 15 | 317 | 414 | 17.8s | internal=311 unknown=237 aws=15 google=5 airtable=4 access-checker.teable.ai=3 airtable.com=2 challenges.cloudflare.com=2 |
| medusa | packages/modules/providers | 66 | 27 | 23 | 23 | 16 | 25 | 1.2s | stripe=16 aws=7 github=3 google=1 |
| vercel-ai | packages | 2459 | 15 | 0 | 0 | 7 | 12 | 9.4s | internal=5 localhost:=4 unknown=3 ai-gateway.vercel.sh=1 google=1 env:TOOL_RELAY_URL=1 |
| novu | packages/providers | 130 | 55 | 1 | 1 | 46 | 27 | 1.1s | unknown=14 internal=9 smba.trafficmanager.net=5 slack=4 api.sendblue.co=1 telegram=1 graph.facebook.com=1 mailgun=1 |
| outline | plugins | 190 | 19 | 0 | 0 | 2 | 18 | 2.7s | unknown=16 slack=2 microsoft=1 |
| hoppscotch | packages/hoppscotch-backend | 191 | 0 | 0 | 0 | 0 | 0 | 0.9s |  |
| immich | server | 499 | 11 | 0 | 0 | 0 | 11 | 3.1s | unknown=11 |
| nocodb | packages/nocodb | 1241 | 42 | 3 | 3 | 18 | 33 | 9.8s | unknown=21 localhost:{env:port}=5 telemetry.nocodb.com=5 aws=3 airtable.com=2 localhost:=2 product-feed.nocodb.com=2 github=1 |
| infisical | backend | 3683 | 1551 | 18 | 18 | 643 | 1398 | 40.1s | unknown=820 microsoft=66 vercel=66 internal=55 google=49 cloudflare=41 api.render.com=25 github=23 |
| activepieces | packages/pieces/community | 9795 | 181 | 85 | 85 | 97 | 156 | 23.2s | unknown=52 slack=47 openai=30 api.canva.com=11 aws=8 google=5 {host}=5 secure.splitwise.com=5 |
| openstatus | apps/web | 153 | 27 | 0 | 0 | 7 | 24 | 1.1s | unknown=17 internal=5 checker.openstatus.dev=2 env:SLACK_FEEDBACK_WEBHOOK_URL=1 api.openstatus.dev=1 github=1 |
| directus | api | 832 | 13 | 0 | 0 | 6 | 11 | 4.9s | unknown=9 google-ai=2 anthropic=1 openai=1 |

**Totals over 20 repos:** 43992 files scanned, 3641 calls found, 350 at confidence ≥ 0.7, 350 via SDK registries, 1698 with a body shape, 3072 with at least one dynamic part, 204s total scan time.

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

## Providers across all 20 repos (top 25)

unknown=1496, internal=620, stripe=170, vercel=102, aws=84, microsoft=77, slack=75, google=75, github=42, cloudflare=41, openai=40, api.render.com=25, api.daily.co=24, api.us-east.tinybird.co=23, api.travis-ci.com=22, env:SEED_AUTHENTIK_URL=20, api.fly.io=20, open.feishu.cn=19, open.larksuite.com=19, api.heroku.com=17, circleci.com=17, api.bitbucket.org=16, airtable=15, api.humanitec.io=15, dev.azure.com=14

`unknown` means the host could not be resolved statically (a variable, a call result, an unresolved
workspace-package constant); `internal` is a relative `/api/...` path or localhost.

## Findings from this run

Fixed during the run (all three landed as code changes with fixtures):

- **tsconfig path aliases were treated as npm packages.** `@app/lib/request`, `@server/...` start with
  `@` and matched the scoped-package heuristic. The resolved declaration is now trusted first.
- **Factory-returned clients were not followed.** `const request = createRequestClient()` where the
  function returns an `axios.create(...)` instance (Infisical) is now resolved, taking that repo from
  90 to 1551 calls.
- **Wrapper expansion lost options spread from a parameter.** `fetch(url, { ...init })` inside a
  wrapper resolved `method` before the caller's arguments were substituted; inner calls are now
  re-detected with the substitution.

Known recall gaps, not addressed (each is a framework-specific HTTP helper, out of the v0 detector set):

- **n8n** (`packages/nodes-base`, 7 calls): every node calls `this.helpers.httpRequest(options)` /
  `this.helpers.requestWithAuthentication.call(this, cred, options)`. Uniform options object
  (`method`, `url`/`uri`, `body`, `qs`, `headers`), so a dedicated detector would recover hundreds of calls.
- **activepieces** (`packages/pieces/community`, 181 calls): 2395 files use
  `httpClient.sendRequest({ method: HttpMethod.POST, url, body })` from `@activepieces/pieces-common`.
  Same shape as above. The 181 found are direct SDK usages (Slack, OpenAI) and raw fetch.
- **vercel/ai** (`packages`, 15 calls): providers go through `postJsonToApi` / `postToApi` from
  `@ai-sdk/provider-utils`, a workspace package. Resolvable once workspace packages are linked
  (types installed) or via a registry entry for that helper.
- **supabase studio**: talks to its own platform API through `get`/`post` helpers with `API_URL`
  constants from a workspace package; hosts land in `unknown` / `env:`.

Repo selection notes:

- **outline** integrations live in `plugins/`, not `server/` (list corrected mid-run).
- **hoppscotch** backend has no outbound HTTP at all (GraphQL + DB), 0 calls is correct.
- **novu** moved most providers to a separate repo; 130 files is the current size of `packages/providers`.

Precision has not been measured yet: `pnpm eval:score sample <repo> 100` produces the labeling sheet.
