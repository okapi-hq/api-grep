# api-grep eval run — 2026-10-09

Shallow clones, no `node_modules` installed in the targets (types of third-party packages are therefore unresolved; SDK detection relies on imports). Per-repo JSON reports are in `eval/out/<repo>.json`.

| repo | scanned dir | files | calls | conf ≥ 0.7 | sdk | with body | with dynamic | unresolved provider | time | coverage | top providers |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| dub | apps/web | 3460 | 696 | 192 | 192 | 320 | 610 | 96 | 16.9s | 2 not followed | internal=214 stripe=174 unknown=96 vercel=60 api.us-east.tinybird.co=23 slack=19 google=19 api-ssl.bitly.com=15 |
| cal.com | packages/app-store | 730 | 316 | 51 | 51 | 172 | 277 | 77 | 3.9s | 1 not followed | unknown=60 stripe=50 api.daily.co=41 microsoft=29 open.feishu.cn=22 open.larksuite.com=22 env:CALCOM_CREDENTIAL_SYNC_ENDPOINT=17 internal=12 |
| n8n | packages/nodes-base | 3585 | 6174 | 0 | 0 | 4885 | 4964 | 1411 | 25.1s | complete | unknown=1411 internal=625 google=442 microsoft=260 hubspot=202 api.pipedrive.com=145 sandbox-quickbooks.api.intuit.com=106 notion=102 |
| twenty | packages/twenty-server | 8477 | 116 | 48 | 48 | 57 | 101 | 44 | 26.7s | 6 not followed | unknown=44 aws=39 github=15 resend=10 internal=3 models.dev=2 sentry=2 api.oneleet.com=1 |
| supabase | apps/studio | 3992 | 233 | 44 | 53 | 77 | 173 | 107 | 18s | 1 not followed | env:PLATFORM_PG_META_URL=57 unknown=49 internal=48 supabase=33 sentry=28 github=7 supabase.com=3 api.incident.io=2 |
| formbricks | apps/web | 2144 | 258 | 46 | 46 | 91 | 210 | 21 | 10s | complete | internal=109 airtable=23 posthog=21 unknown=21 sentry=13 brevo=12 stripe=12 google=9 |
| documenso | packages/lib | 559 | 31 | 11 | 11 | 18 | 25 | 12 | 3s | complete | unknown=12 internal=6 aws=5 posthog=3 google-vertex=2 stripe=1 challenges.cloudflare.com=1 license.documenso.com=1 |
| trigger.dev | apps/webapp | 1973 | 153 | 37 | 37 | 75 | 127 | 70 | 15.2s | complete | unknown=68 internal=33 b.s2.dev=14 posthog=5 slack=4 vercel=4 api.attio.com=4 a.s2.dev=4 |
| teable | apps/nestjs-backend | 958 | 136 | 37 | 37 | 47 | 111 | 31 | 35.6s | complete | unknown=30 airtable=29 internal=28 aws=15 sentry=8 openai=8 google=5 access-checker.teable.ai=4 |
| medusa | packages/modules/providers | 82 | 30 | 26 | 26 | 19 | 28 | 0 | 1.2s | complete | stripe=16 aws=7 posthog=3 github=3 google=1 |
| vercel-ai | packages | 2400 | 284 | 6 | 6 | 159 | 270 | 236 | 9.3s | 9 not followed | unknown=235 internal=18 xai=14 vercel-ai-gateway=11 google=3 fal=2 env:TOOL_RELAY_URL=1 |
| novu | packages/providers | 131 | 59 | 3 | 3 | 51 | 24 | 10 | 0.8s | complete | unknown=10 internal=9 slack=6 smba.trafficmanager.net=5 resend=2 api.eu.sparkpost.com=2 api.io.italia.it=2 api.sendblue.co=1 |
| outline | plugins | 170 | 80 | 5 | 5 | 7 | 73 | 65 | 2.4s | complete | unknown=65 github=5 microsoft=4 discord=3 slack=3 |
| hoppscotch | packages/hoppscotch-backend | 193 | 1 | 1 | 1 | 1 | 1 | 0 | 1.6s | complete | posthog=1 |
| immich | server | 502 | 10 | 0 | 0 | 0 | 10 | 10 | 6.6s | complete | unknown=10 |
| nocodb | packages/nocodb | 1218 | 52 | 7 | 7 | 20 | 41 | 20 | 29.6s | complete | unknown=19 internal=8 airtable.com=7 telemetry.nocodb.com=5 aws=3 sentry=2 twilio=2 product-feed.nocodb.com=2 |
| infisical | backend | 3688 | 2121 | 50 | 50 | 970 | 1898 | 868 | 38.7s | 1 not followed | unknown=868 microsoft=147 internal=118 google=80 vercel=77 gitlab.com=72 github=54 id.heroku.com=42 |
| activepieces | packages/pieces/community | 9795 | 10179 | 134 | 134 | 4314 | 8714 | 2448 | 21.9s | complete | unknown=2448 google=275 github=153 api.clickup.com=140 api.bexio.com=135 proxy.whatsscale.com=126 stripe=114 api.crmworkspace.com=101 |
| openstatus | apps/web | 249 | 45 | 2 | 2 | 20 | 41 | 26 | 1.1s | complete | unknown=26 internal=11 checker.openstatus.dev=2 sentry=2 formbricks.com=1 slack=1 api.openstatus.dev=1 github=1 |
| directus | api | 833 | 24 | 2 | 2 | 15 | 16 | 15 | 15.5s | complete | unknown=15 anthropic=3 google-ai=3 openai=3 |
| thealgorithms-python | web_programming | 36 | 82 | 0 | 0 | 3 | 50 | 12 | 0s | complete | unknown=12 ww7.gogoanime2.org=6 www.google.com=5 github=4 api.carbonintensity.org.uk=3 api.coingecko.com=3 firebase=3 api.nasa.gov=3 |
| gpt-researcher | . | 217 | 57 | 11 | 11 | 35 | 55 | 9 | 0.4s | 3 not followed | api.typesafe.ai=12 openai=11 unknown=7 modelslab.com=5 eutils.ncbi.nlm.nih.gov=4 fastcrw.com=2 api.tavily.com=2 api.bing.microsoft.com=1 |
| redash | . | 198 | 99 | 0 | 0 | 18 | 84 | 80 | 0.3s | complete | unknown=78 google=4 cloud-api.yandex.net=4 api-metrica.yandex.com=4 env:REDASH_JWT_AUTH_PUBLIC_CERTS_URL=2 internal=2 version.redash.io=2 api.chatwork.com=1 |
| apprise | . | 252 | 333 | 0 | 0 | 237 | 314 | 133 | 1.2s | 1 not followed | unknown=133 api.simplepu.sh=8 api.twist.com=8 microsoft=7 discord=6 oauth.reddit.com=6 aws=6 slack=6 |
| llm | . | 21 | 30 | 16 | 16 | 15 | 28 | 13 | 0.2s | complete | openai=17 unknown=13 |
| saleor | saleor | 2614 | 75 | 19 | 19 | 18 | 74 | 55 | 2.8s | 12 not followed | unknown=55 stripe=19 usage-telemetry.saleor.io=1 |
| socialite | . | 33 | 33 | 0 | 0 | 0 | 4 | 4 | 0.1s | complete | api.linkedin.com=6 unknown=4 api.bitbucket.org=3 meta-graph=3 google=3 slack=3 api.twitter.com=3 github=2 |
| koel | . | 1173 | 51 | 0 | 0 | 2 | 49 | 47 | 0.6s | 12 not followed | unknown=47 api.dropboxapi.com=2 internal=1 github=1 |
| coolify | . | 1470 | 130 | 56 | 56 | 42 | 100 | 23 | 3.1s | 1 skipped | stripe=54 cloudflare=19 unknown=18 api.vultr.com=7 api.hetzner.cloud=6 env:VERSIONS_URL=4 cdn.coollabs.io=4 api.digitalocean.com=4 |
| rss-bridge | . | 618 | 5 | 0 | 0 | 0 | 5 | 3 | 0.9s | complete | unknown=3 touch.facebook.com=2 |
| symfony-notifier | src/Symfony/Component/Notifier | 404 | 116 | 0 | 0 | 53 | 98 | 13 | 0.3s | complete | unknown=13 internal=11 upload.twitter.com=8 graph.instagram.com=6 graph.threads.net=6 discord=2 meta-graph=2 google=2 |
| wordpress | . | 1853 | 4 | 0 | 0 | 0 | 4 | 4 | 5.9s | 2 skipped | unknown=4 |
| firefly-iii | . | 1348 | 5 | 0 | 0 | 0 | 4 | 1 | 1.7s | complete | ff3exchangerates.z6.web.core.windows.net=2 github=1 hibp=1 unknown=1 |

**Totals over 33 repos:** 55376 files scanned, 22018 calls found, 804 at confidence ≥ 0.7, 813 via SDK registries, 11741 with a body shape, 18583 with at least one dynamic part, 301s total scan time.

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
- thealgorithms-python: 215c1f0710f610aaf5ebaeab04edacec3f5308cd
- gpt-researcher: 0957c301ed06c2a5857b834358c7227c739041d4
- redash: e170795256ae028930e4760192e5dc3f59bb420c
- apprise: f746ec5659da5d59cfd75db49ad57bd75c4acdd2
- llm: 05d7ae7dedc524b024ab463b063854e7c43fee01
- saleor: 782a751f622c4a047798ce7084b7c66c0877ec6f
- socialite: fa0181ee6204ca28a55cd67145fadd631ac209cf
- koel: a2e5973bf843a64003ae31393d05c4be8ce1468b
- coolify: a963f95612ad8d449dc3797b657bc889fca48ac8
- rss-bridge: 7f5cedf1b71eac177510234219aeca185e63d04e
- symfony-notifier: e42875f20222a93cfef6ef4da26ca02a8a7d91f4
- wordpress: 3310b5ccad24f88b53396fbd01bdc4224d9fc5b2
- firefly-iii: e141960f4e8e8d7145a59e326ae4595d741e65b1

## Findings from this run (2026-10-09)

Compared with main on the same clones and commits: the 20 TypeScript repositories, and the 6 Python and 7 PHP ones
added in this run, each scanned in its own language.

| | calls | resolved provider | unresolved | not followed |
|---|---:|---:|---:|---:|
| TypeScript (20 repos) | 20528 → 20998 | 12471 → 15431 | 8057 → 5567 | 729 → 20 |
| Python and PHP (13 repos) | 830 → 1020 | 409 → 623 | 421 → 397 | 23 → 28 |

- **Deeper wrappers.** Call sites are followed through four wrappers instead of two, and the evaluation budget counts
  lookups only (a `+` chain, template spans and object hops no longer use it up): 709 TypeScript call sites that were
  listed as not followed are calls now.
- **Where URLs are built.** Imported config objects and helpers, object methods (`common.getApiUrl()`), helpers with
  several returns or called as `fn.call(this)`, `let` variables assigned in branches, conditionals and URL tables
  with one literal host, and literal `.replace()`: activepieces resolves 1740 more calls, n8n 1057, infisical 370.
- **Customer subdomains.** `{instance}.my.salesforce.com` is `salesforce`; `{subdomain}.zendesk.com`, with no provider
  entry, is `zendesk.com`.
- **Late binding.** `static::HOST`, `$this` and `self` read the subclass a base method runs on: the Symfony notifier
  bridges go from 2 to 103 resolved calls, instead of resolving to the base class's `localhost`.
- **Python clients.** `httpx2` (TheAlgorithms, llm) and `requests_hardened` (saleor) are detected.
- **Test code.** NestJS `*.e2e-spec.ts` (teable) and codemod `__testfixtures__/` (vercel/ai) are out of scope by
  default, which removes about 700 calls.

Still unresolved: hosts the user configures (n8n credentials, activepieces `auth.props.baseUrl`), config injected
into classes by factories (vercel/ai), PHP clients behind a service locator and an interface (rss-bridge), Laravel
`Http::macro` and dynamic verbs (coolify), Saloon connectors (koel), and WordPress core's own `wp_remote_*`, which
shadows the client table.
