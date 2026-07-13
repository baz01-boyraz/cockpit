# Hermes — cockpiT'in Jarvis'i (konsolide roadmap)

> **ARCHIVED 2026-07-13 — SUPERSEDED.** Bu dosya artık aktif mimari veya ajan
> talimatı değildir. Güncel runtime ve Memory tasarımı
> `docs/plans/agent-memory-system-v2.md` ile `docs/MEMORY-CHARTER.md` içindedir.
> Aşağıdaki içerik yalnızca geçmiş kararların kaydı olarak korunur.

> **Bu dosya `docs/plans/hermes-jarvis-plan.md`'ın yerini alır.** O dosyada Docker sandbox
> öneriliyordu ve Hermes coding fallback'i kendisi (DeepSeek ile) yapıyordu — ikisi de bu
> sohbette **değişti** (aşağıda "v1'den farklar" bölümüne bak). Eski dosya arşiv olarak
> kalıyor, güncel kaynak budur. Created 2026-07-05.
>
> **Bu dosyayı kim okursa (Claude, Codex, gelecekteki Baz):** her faz kendi başına
> anlaşılabilir olacak şekilde yazıldı — hangi dosyaya dokunulacağı, hangi şemanın
> sarılacağı, ne zaman "bitti" sayılacağı somut. Kota bitip Codex'e geçilirse, Codex bu
> dosyayı okuyup "şu ana kadar ne yapıldı, şimdi hangi fazdayız, sıradaki adım ne" sorusunu
> tek başına cevaplayabilmeli.

## Onaylanmış temel kararlar (bu sohbette netleşti)

- **Hermes = [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)**
  (MIT, doğrulandı `gh api repos/NousResearch/hermes-agent` ile — gerçek repo).
- **Model policy:** Hermes chat/orchestration = `deepseek/deepseek-v4-pro`; bounded tool-less
  triage, memory distillation and curation = `deepseek/deepseek-v4-flash`. Provider slugs live
  once in `shared/hermes-model-policy.ts` and cockpiT passes `-m` explicitly, so a changed
  Hermes config cannot silently promote a cheap background call or downgrade main judgment.
- **Rol ayrımı (kritik, karışıklığı önlemek için):**
  - **Claude Code** = coding işinin **birincil** yürütücüsü. Her zaman ilk tercih.
  - **Codex** = Claude Code kotası bittiğinde coding'in **ikincil** yürütücüsü.
  - **Hermes (DeepSeek/GLM)** = coding yapmaz. Orkestrasyon, memory, swarm, git/log
    stewardship, sohbet, dispatch — app'in "sağ kolu". Coding fallback zincirinde en son,
    sadece Baz açıkça isterse ("ben yapabilirim" seçeneği sunulur, otomatik devreye girmez).
  - Hermes app içinde **arka planda sürekli yaşayan** bir agent — 7/24 her şeyi izleyen bir
    şey değil, ama app açıkken hazır bekleyen, görev verildiğinde devreye giren bir süreç.
- **Sandbox: Docker YOK, tamamen local çalışacak.** Önceki taslakta Docker/container
  isolation öneriliyordu (blast-radius + network-egress riskini azaltmak için) — Baz bunu
  açıkça reddetti, tekrar gündeme getirilmeyecek. Bunun anlamı: **Açık Soru 0'ın temel riski
  (Hermes kendi shell'iyle çalışıyor, cockpiT'in `guarded()`/`ApprovalService` kapısı onu
  görmüyor) container ile çözülmüyor.** Bunun yerine iki kısmi mitigasyon var:
  1. Hermes'e cockpiT'i kontrol etme yetkisi **raw shell/dosya erişimi olarak değil, dar bir
     MCP tool seti olarak** veriliyor (aşağıya bak) — Hermes'in app üzerindeki her hareketi
     zaten Zod-validated bir IPC handler'a eşleniyor.
  2. hermes-agent'ın kendi native "Command approval" özelliği var (README'de doğrulandı,
     `docs/user-guide/security`) — Faz 1'de bunun gerçekte ne kadar sıkı çalıştığı
     doğrulanacak.
  - **Bu hâlâ kabul edilmiş bir risktir, çözülmüş değil.** Hermes'in kendi genel shell
    executor'ı (örn. hermes-agent'ın kendi dosya-düzenleme/terminal tool'ları) tamamen kapalı
    tutulmalı — Hermes'in coding/dosya-değiştirme ihtiyacı olduğunda bunu **kendisi yapmaz**,
    Claude Code'a veya Codex'e devreder (Faz 4). Hermes'in kendi tool erişimi MCP server'daki
    dar listeyle sınırlı kalırsa, bu risk pratikte çok daralır.

## v1'den (`hermes-jarvis-plan.md`) farklar — özet

| Konu | v1 (eski) | v2 (bu dosya) |
|---|---|---|
| Sandbox | Docker öneriliyordu, Açık Soru 0 açıktı | Docker yok, local; risk kabul edildi + MCP-tool daraltmasıyla azaltıldı |
| Coding fallback | Hermes kendi DeepSeek'iyle kodluyordu | Codex devreye giriyor; Hermes hiç kodlamıyor |
| App kontrolü | Vague ("GitService/LogIntelligenceService okur") | Somut: local MCP server, ~12 dar tool |
| Memory damıtma | Zaten var olan local `claude` CLI, dokunulmuyordu | Hermes/DeepSeek'e taşınıyor (kota tasarrufu), `terminal:exit` tetikleyicisi ekleniyor |
| Telefon/Telegram | Faz 8, tek başına | Aynı yerde ama artık "Faz 4'ün swarm-card dispatch'inin Telegram'dan tetiklenen hali" — yeni mekanizma değil |
| Chat arayüzü | Eski `RightPanel`'i canlandırma fikri | Yeni, küçük, sağ-alt köşe chat widget (RightPanel'e dokunulmuyor) |

## Mimari: local MCP server — Hermes'in app'i kontrol etme yolu

cockpiT main process'inde yeni bir servis: **`HermesMcpServer`** (örn.
`electron/main/services/HermesMcpServer.ts`). Hermes-agent zaten MCP client desteğine sahip
(Faz 1'de doğrulandı) — buna local bir MCP server (stdio veya local socket) olarak bağlanır.
Her tool, **var olan** Zod-validated IPC handler'ı sarar; yeni bir validasyon/yetki mantığı
yazılmıyor, var olanı Hermes'e açıyoruz.

| Tool | Sardığı şema/servis | Not |
|---|---|---|
| `create_swarm_card` | `swarmCreateCardSchema` (`shared/schemas.ts:242-246`) | title ≤200 char, body ≤20.000 char |
| `update_swarm_card` | `swarmUpdateCardSchema` (`schemas.ts:254-264`) | pipeline/rol ataması, `assignments` max 6 adım |
| `start_swarm_card` | **Faz 1'de doğrulanacak** — "Start" butonunun çağırdığı service-owned transition (renderer'ın generic `swarmMoveCardSchema` ile `in_progress`'e geçemediği zaten kodda not düşülü, `schemas.ts:266-268` civarı) | Tam handler adı henüz teyit edilmedi |
| `get_swarm_status` | Kart durumunu okuma | — |
| `get_usage_quota` | `AgentUsageService` | Claude/Codex kota yüzdeleri — dispatch öncesi Hermes buna bakıyor |
| `get_git_diff` / `git_status_summary` | `GitService` (read-only) | — |
| `run_tests` / `run_typecheck` / `run_lint` | `npm test` / `npm run typecheck` / `npm run lint` | Var olan script'ler, yeni bir şey değil |
| `take_app_screenshot` | `serve.mjs` + `screenshot.mjs` akışı (CLAUDE.md'deki screenshot workflow) | — |
| `read_memory_recent` / `write_memory_summary` | `memoryWriteSchema` (`schemas.ts:203-207`, body ≤500.000 char) | — |
| `get_pending_memory_reviews` / `resolve_memory_review` | scoped review schema + Hermes-only delegated-conflict extension | accept/edit/discard; conflicts require basis+rationale+evidence |
| `subscribe_card_output(cardId)` | **Yeni, küçük plumbing** | `TerminalManager`'ın PTY stream'ini, sadece o kart running olduğu sürece, Hermes'e tee eder. 7/24 global izleme değil — sadece o an dispatch edilen tek görev. |
| user-defined cron/scheduled task | cockpiT `AutomationService` + V21 durable state | App owns time/claims; Flash gets a content-free snapshot and harmless tool allowlist. Native Hermes cron is intentionally excluded because oneshot/cron auto-bypasses soft approvals. |

OpenRouter API key: sadece child process env değişkeni olarak taşınır, asla komut stringine
girmez (v1'deki karar aynen geçerli, `SecretStore`/`safeStorage` deseni). `shared/redaction.ts`
key'i audit-log/PTY-log'da hiç göstermeyecek şekilde genişletilir.

## Fazlar

### Faz 1 — Spike: hermes-agent'ı local kur ve doğrula
**Bağımlılık:** yok · **Model:** default

1. Tek satır installer ile kur, OpenRouter key ile doğrula; cockpiT-owned calls use the explicit
   Pro/Flash role policy above rather than trusting the CLI default.
2. Tek seferlik/etkileşimsiz invocation modu var mı doğrula (`claude --print` eşleniği).
3. **Native "Command approval" özelliğini gerçekten test et** — bir riskli komutu (örn.
   `rm -rf`) tetiklediğinde gerçekten engelliyor mu, yoksa sadece log mu tutuyor? Bu sonucu
   bu dosyaya not düş — Hermes'in kendi genel tool erişimini ne kadar kapalı tutmamız
   gerektiğini belirliyor.
4. "Your own endpoint" model routing desteğini doğrula (ileride bir egress-proxy fikri tekrar
   gündeme gelirse lazım olur, şimdilik zorunlu değil ama ücretsiz bir doğrulama).
5. Done-signal uyumluluğu: Hermes'in kendisi swarm kartı çalıştırmıyor (Claude Code/Codex
   çalıştırıyor), o yüzden v1'deki "Stop-hook Hermes'i tetiklemez" endişesi **artık geçersiz**
   — ama `subscribe_card_output`'un "kart bitti" sinyalini nasıl alacağını (mevcut
   `reconcileDoneSignals`/`doneSignal.arm()` mekanizmasını mı dinleyecek) doğrula.
6. Gerçek bir görevi uçtan uca dene: Hermes'e bir MCP tool çağrısı yaptır (henüz Faz 3
   bitmediyse, elle bir tool stub'ı ile).
7. Telegram gateway kurulumu ve DM pairing/sender-allowlist'i doğrulamayı **bu fazda yap**
   (Faz 8 daha sonra inşa edilecek olsa da, doğrulamayı şimdi yapmak ileride sürpriz
   çıkarmaz).

**Çıktı:** bulgular bu dosyaya eklenir (madde 3 kritik — sonucu Faz 3/4'ün "Hermes'in kendi
tool erişimini ne kadar kısıtlı tutmalıyız" kararını etkiler).

#### Faz 1 bulguları (2026-07-05, gerçek kurulumda doğrulandı)

- **Kurulum (historical default, now superseded by explicit routing):** `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` — script
  incelendi (sudo sadece opsiyonel sistem paketleri için, varsayılan "hayır"; şüpheli network
  hedefi yok), macOS'ta root olmadan `~/.hermes` altına kuruluyor. İlk kurulum default'u
  `deepseek/deepseek-v4-flash` idi; bugün chat Pro, mekanik işler Flash olarak koddan seçiliyor.
  Key `~/.hermes/.env`'de `OPENROUTER_API_KEY` olarak duruyor. Gerçek bir istekle test
  edildi (`hermes -z "..."`), çalışıyor.
- **Not (önemli, ileride tekrar kurulum yapan biri için):** bu makinede DAHA ÖNCE farklı bir
  Hermes kurulumu vardı — hermes-agent'ın kendi "Hermes Desktop" Electron app'ine (`apps/desktop/`)
  eklenmiş özel bir dosya gezgini + Claude/Codex kullanım paneli, ve **canlı çalışan bir
  gateway + launchd auto-start servisi + zaten eşleştirilmiş bir Telegram DM kanalı**. Baz'ın
  onayıyla tamamen kaldırıldı (`~/.hermes` Trash'e taşındı, launchd servisi kaldırıldı) ve sıfırdan
  kuruldu — bu planın mimarisi (MCP-server üzerinden cockpiT'e bağlı, kendi Electron UI'ı
  kullanılmayan bir Hermes) o eski kurulumdan tamamen farklı olduğu için bilinçli bir karardı.
- **Invocation modu (madde 2):** `hermes -z "PROMPT"` (`--oneshot`) = `claude --print` eşleniği.
  **Kritik uyarı, CLI'ın kendi --help metninde:** "approvals are auto-bypassed" — aşağıya bak.
- **Command approval (madde 3) — beklenenden güçlü, kaynak kodundan doğrulandı
  (`tools/approval.py`, ~2986 satır):**
  1. **Hardline floor** — `rm -rf /` ve sistem dizinleri, `mkfs`, ham disk'e `dd`, fork bomb,
     `kill -1`, `shutdown`/`reboot`/`systemctl poweroff` gibi geri dönüşsüz komutlar **hiçbir
     modda çalışmaz** (yolo, approvals.mode=off, cron approve dahil) — koddan, çalıştırma
     katmanında engelleniyor, prompt seviyesinde değil.
  2. **`approvals.deny`** (config.yaml, kullanıcı tanımlı fnmatch glob listesi) — hardline gibi
     koşulsuz, **bize özel ek kurallar ekleme imkanı** (örn. cockpiT repo'suna özel riskli
     komutlar).
  3. **Daha yumuşak "dangerous" liste** (force-push, `rm -r`, `chmod 777`, `curl|bash`,
     kendi gateway'ini durdurma/restart, launchd servisini durdurma vb. — 50+ pattern) —
     **interaktif CLI/gateway/ask bağlamında gerçekten onay bekliyor**, ama
     **non-interactive/oneshot çağrılarda otomatik geçiyor** (`check_all_command_guards`,
     `tools/approval.py:2343`: "outside CLI/gateway/ask flows, we do not block on approvals").
  4. **Telegram/gateway bağlamı onay-gerektiren sayılıyor** (`_is_gateway_approval_context()`)
     — yani Faz 8'de Telegram'dan gelen görevler bu yumuşak onay akışından da geçecek, sadece
     bizim MCP/script üzerinden `-z` ile tetiklediğimiz çağrılarda bu katman atlanıyor.
  5. **Sonuç — Faz 3/4 tasarımına etkisi:** Hermes'i MCP üzerinden (oneshot) tetiklediğimizde
     hardline floor + bizim `approvals.deny` kurallarımız her zaman aktif kalıyor, ama yumuşak
     "dangerous" liste atlanıyor. Bu yüzden Faz 3'te MCP tool'larını yazarken **kendi
     `approvals.deny` kurallarımızı** (örn. cockpiT repo'suna özel force-push/silme paternleri)
     config.yaml'a eklemek zorunlu bir alt-görev — yumuşak listeye güvenemeyiz, hardline +
     kendi deny listemize güveniyoruz. `HERMES_EXEC_ASK` env var'ı da oneshot'ta onayı zorlamak
     için bir seçenek, Faz 3'te değerlendirilecek.
- **Dürüstlük notu:** bu pattern/regex-tabanlı bir tespit sistemi, Docker'ın sağladığı gibi bir
  OS-seviyesi sandbox değil — çok sofistike/hiç görülmemiş bir obfuscation tekniği teorik olarak
  sızabilir. Ama incelenen kod (ANSI-strip, Unicode normalizasyon, IFS-obfuscation, base64/hex/tr
  decode-pipe-to-shell tespiti, komut ikamesi çözümleme) gerçekten ciddi bir mühendislik —
  "sadece LLM'e güven" değil.
- **Uçtan uca test (madde 6):** izole bir scratch dizininde gerçek bir görev denendi — Hermes
  bir dosya oluşturdu, tam istenen içerikle, sonra `cat`/`wc -l` çalıştırıp sonucu doğru
  yorumladı (trailing-newline farkını fark edip açıkladı). Exit code 0, dosya diskte doğrulandı.
  Dosya düzenleme + shell komutu çalıştırma beklendiği gibi çalışıyor.
- **Telegram DM pairing/sender-allowlist (madde 7):** doğrulandı, gerçek bot kurmadan CLI
  yapısından — `hermes pairing {list,approve,revoke,clear-pending}` diye ayrı bir onay akışı var
  (yeni bir kullanıcı bot'a yazınca bir pairing code üretiliyor, sahibi onaylamadan erişemiyor),
  bunun üstüne `.env`'de `TELEGRAM_ALLOWED_USERS` (virgülle ayrılmış user id listesi) ile statik
  bir allowlist de eklenebiliyor. Faz 8'in "sadece Baz'ın Telegram ID'sinden mesaj kabul edilsin"
  zorunlu ön koşulu için iki katmanlı, sağlam bir mekanizma — inşa edilmesi gerekmiyor, hazır.

**Faz 1 sonucu: tüm çıkış kriterleri karşılandı, faz tamamlandı (2026-07-05).**

### Faz 2 — SecretStore: OpenRouter API key — TAMAMLANDI (2026-07-05)

- **Düzeltilmiş bulgu:** `SecretStore` zaten vardı (`safeStorage` tabanlı, encrypted) ama
  Railway/GitHub için "aynı deseni izleyecek" varsayımı yanlıştı — sıfır gerçek çağıranı vardı,
  bu Faz onun **ilk gerçek tüketicisini** kurdu.
- `shared/schemas.ts`: `secretKindSchema` (enum, bare string değil — trust boundary),
  `secretSetSchema` (value ≤500 char), `secretKindOnlySchema`.
- `shared/ipc.ts` + `registerIpc.ts`: `secret:set/has/delete` — kasıtlı olarak **`secret:get`
  yok**, ham değer renderer'a hiç dönmüyor. Basit bir key saklama CLAUDE.md'nin gated-action
  listesinde olmadığı için `guarded()` gerekmiyor, ama diğer her handler gibi Zod-validated.
  `SECRET_REFS` map'i main-process'te ref namespace'ini sahipleniyor (`openrouter → hermes.openrouter`).
- `SettingsPanel.tsx`: "Hermes · OpenRouter" bölümü, maskeli input, `has` ile "stored/not stored"
  göstergesi (değer asla gösterilmiyor), ember/copper temayla tutarlı.
- `src/lib/mock.ts`: in-memory mock, browser preview'da da çalışır.
- `shared/redaction.ts`: `sk-or-[A-Za-z0-9-]{16,}` pattern'i eklendi (defense-in-depth).
- **Test:** SecretStore round-trip + "diskte plaintext yok" kanıtı, schema valid/invalid, redaction
  testi — hepsi yeşil (`npm run typecheck`/`lint`/`test`, 609 test). Screenshot ile 2 tur görsel
  doğrulama yapıldı.
- Key'in subprocess'e env olarak geçirilmesi (Faz 3'ün işi) için `SecretStore.get()` main-only
  olarak hazır bekliyor.

### Faz 3a — HermesMcpServer: swarm tool'ları — TAMAMLANDI (2026-07-05)

- `electron/main/services/hermes/{HermesMcpServer,hermesTools,CardOutputTracker}.ts` — yeni,
  `@modelcontextprotocol/sdk` (yeni dependency, `dependencies`'te — externalizeDepsPlugin +
  electron-builder paketlemesi buna bağlı, devDependencies'e taşınmasın).
- **Transport:** Streamable HTTP, sadece `127.0.0.1:47615` (env `HERMES_MCP_PORT` ile override
  edilebilir), `/mcp` path'i, DNS-rebinding koruması + allowedHosts + 1MB body limiti. stdio değil
  — main process zaten uzun ömürlü. Bind hatası loglanıp yutuluyor (Hermes opsiyonel, app boot'unu
  bloklamaz). `hermes mcp add http://127.0.0.1:47615/mcp` adımı Baz'ın yapacağı tek seferlik
  manuel adım, otomatikleştirilmedi.
- **6 tool** (kapsamlı liste yerine bilinçli olarak daraltıldı — bkz. Faz 3b): `create_swarm_card`,
  `update_swarm_card`, `start_swarm_card`, `get_swarm_status`, `subscribe_card_output`,
  `get_usage_quota`. Her biri `shared/schemas.ts`'teki **aynı** Zod şemasıyla girdiyi yeniden
  doğruluyor, renderer'ın IPC handler'ının çağırdığı **aynı** service metodunu in-process çağırıyor.
- **`subscribe_card_output` tasarımı (yeni, mimari emsali yok):** poll-tabanlı delta-snapshot —
  her çağrı son çağrıdan bu yana birikmiş çıktı + `isDone` bayrağı döndürüyor (uzun-ömürlü stream
  değil, MCP'nin request/response modeline daha uygun; `SwarmService.board()`'un zaten
  poll-on-read ile done-signal aldığı deseni yansıtıyor). Session-scoped (`CardOutputTracker`,
  256 KiB tail limit) — asla global terminal firehose'a dönüşmüyor, başka kartın çıktısı sızmıyor.
- **Test:** 26 yeni test (her tool happy-path + Zod reddi; tracker için buffer/filtre/exit/bounded-tail).
  `npm run typecheck`/`lint`/`test` (635/635) yeşil, `npm run build` prod paketleme başarılı,
  bağımsız olarak doğrulandı.
- **Kapsam dışı bırakıldı (Faz 3b, ayrı bir sonraki adım):** `get_git_diff`, `run_tests`,
  `run_typecheck`, `run_lint`, `take_app_screenshot`, `read_memory_recent`, `write_memory_summary`,
  `get_pending_memory_reviews`, `resolve_memory_review` — Faz 4'ün "tamamlanınca kendi review'unu
  yap + rapor et" adımı bunlara ihtiyaç duyuyor, ama diff'i küçük tutmak için ayrı bir işe bölündü.
- **Not düşülen invariant'lar (ihlal edilmemeli):** Hermes'in MCP erişimi tam olarak bu tool
  listesiyle sınırlı kalmalı — yeni bir mutating tool eklenirse mutlaka ilgili Zod şemasıyla
  yeniden validate edilmeli, raw shell/dosya erişimi asla açılmayacak; `CardOutputTracker`
  session-scoped kalmalı.

### Faz 3b — HermesMcpServer: kalan tool'lar — TAMAMLANDI (2026-07-05)

- **8 yeni tool eklendi** (server/transport'a dokunulmadı, sadece tool katmanı genişletildi):
  `get_git_status`, `get_git_diff_stat`, `run_checks`, `take_app_screenshot`, `read_memory_recent`,
  `write_memory_summary`, `get_pending_memory_reviews`, `resolve_memory_review`. Toplam tool: 14.
- **Dosya bölünmesi (hermesTools.ts <800 satır kalsın diye):** yeni `hermesToolTypes.ts` (context +
  tool tipleri, cycle önlemek için ayrı), `hermesToolsGit.ts`, `hermesToolsChecks.ts`,
  `hermesToolsMemory.ts`; `hermesTools.ts` hepsini `createHermesTools`'ta birleştiriyor. İki yeni
  servis: `HermesChecksService.ts`, `AppScreenshotService.ts`.
- **Şema yeniden kullanımı:** `get_git_status`/`read_memory_recent`/`get_pending_memory_reviews` →
  `projectIdSchema`; `get_git_diff_stat` → `reviewDiffStatSchema`; `write_memory_summary` →
  `memoryWriteSchema`; `resolve_memory_review` tabanı → `memoryResolveReviewSchema`. Hermes
  conflict çözümünde ayrıca kapalı basis + rationale + evidence alanlarını doğrular; recency
  kabul edilmez. Yeni şemalar sadece gerçekten yeni şekiller için:
  `runChecksSchema` (kapalı enum), `takeAppScreenshotSchema`.
- **`run_checks` — allowlist-only (güvenlik-kritik):** `check` KAPALI bir enum
  (`'test'|'typecheck'|'lint'`), serbest string değil. Enum → tek, sabit, hardcoded npm komutu
  (`npm test` / `npm run typecheck` / `npm run lint`) map'i `HermesChecksService`'te; ekstra
  flag/arg geçirilemiyor. `execFileAsync` deseni (arg-array, `env:{...process.env}`), cwd = proje
  kökü (alt-path input yok, kaçış imkânsız), 50KB output cap, 5dk timeout (SIGTERM kill + rapor).
  Test bunu ispatlıyor: geçersiz `check` değeri şema parse'ında reddediliyor, child-process runner
  (spy) HİÇ çağrılmıyor — hiçbir process spawn olmuyor.
- **`take_app_screenshot` — rebuild-vs-reuse kararı: HER ZAMAN önce `npm run build`.** Hermes bunu
  bir swarm görevi kodu değiştirdikten hemen sonra çağırıyor; bayat `out/renderer`'ı screenshot'lamak
  eski UI'ı gösterip review'u yanıltırdı. Doğruluk > hız: build timeout'u cömert (12dk), build
  başarısızsa bayat çıktı screenshot'lanmıyor, net hata dönüyor. Sonra serve.mjs (loopback,
  47616) + screenshot.mjs → kaydedilen PNG'nin **dosya yolu** dönüyor (base64/embed yok). `url`
  verilirse loopback zorunlu (SSRF/keyfi dış sayfa engeli), `label` slug-only.
- **Test:** her tool için happy-path + Zod-reddi; `run_checks` için "process spawn olmuyor" ispatı;
  `HermesChecksService` için enum→komut map'i + non-zero exit + timeout davranışı. Toplam 660 test
  yeşil. `npm run typecheck`/`lint`/`build` de yeşil, bağımsız doğrulandı.

**Canlı uçtan-uca doğrulama (2026-07-05, unit test değil, gerçek entegrasyon):**
`npm run dev` ile app gerçekten çalıştırıldı, `HermesMcpServer`'ın `127.0.0.1:47615`'te dinlediği
`lsof` ile doğrulandı, `hermes mcp add cockpit --url http://127.0.0.1:47615/mcp` ile Hermes gerçekten
bağlandı — **tüm 14 tool doğru açıklamalarıyla keşfedildi**, hepsi enable edildi. Sonra gerçek bir
oneshot çağrısıyla (`hermes -z "call get_usage_quota..."`) Hermes gerçekten `get_usage_quota`'yı
çağırdı ve `AgentUsageService`'ten canlı, gerçek veri döndü (Claude Max plan %6 session/%83 haftalık,
Codex Plus plan %5 session/%16 haftalık). **Faz 1→2→3 zinciri baştan sona kanıtlanmış durumda** —
mock değil, gerçek Electron app + gerçek Hermes process + gerçek MCP protokolü.
Ayrıca Faz 1'in "kendi deny-list kurallarımızı ekle" zorunlu alt-görevi bu turda yapıldı:
`~/.hermes/config.yaml`'a `approvals.deny` (force-push, reset --hard, clean -f — Hermes hiç
kodlamadığı için bunlara hiç ihtiyacı olmamalı) eklendi ve gerçek bir komutla (`git push --force`)
denenip gerçekten bloklandığı doğrulandı.
- **Invariant'lar korundu:** Hermes'in MCP erişimi hâlâ tam olarak kayıtlı tool listesiyle sınırlı;
  her tool IPC path'iyle aynı Zod şemasından geçiyor; raw shell/dosya erişimi açılmadı;
  `run_checks` allowlist'i tek meşru genişleme noktası.

### Faz 4 — Swarm-card dispatch: Hermes'in coding görevi verme akışı
**Bağımlılık:** Faz 3 · **Model:** opus (kota/fallback kararı güvenlik-kritik)

Bu, senin tarif ettiğin akışın tam karşılığı:

1. Baz, Hermes'e (şimdilik chat widget'tan, Faz 8'de telefondan da) bir görev tarif ediyor.
2. Hermes, hangi projede olduğunu zaten biliyor (app içinde yaşadığı için aktif proje context'i
   elinde) — anlayana kadar **istediği kadar** netleştirici soru soruyor. Soru sayısı sabit
   değil, tamamen "Hermes niyeti anladı mı" durumuna bağlı.
3. Cevaplar toplanınca Hermes bunları bir prompt'a döküyor, `create_swarm_card` +
   `update_swarm_card` (pipeline/rol ataması) ile kartı dolduruyor — **title/body karakter
   limitlerine kendisi uyuyor** (200/20.000), pipeline'ı Role×Spec taksonomisinden seçiyor.
4. Dispatch etmeden **önce** `get_usage_quota` çağırıyor:
   - Claude Code'da kota varsa → varsayılan, kart Claude Code ile başlıyor.
   - Kota yoksa → Hermes bunu **konuşarak** sunuyor: "Claude kotan yok, Codex var, ya da
     istersen ben deneyebilirim." **Otomatik sessiz fallback yok** — Baz seçiyor.
5. Hermes `start_swarm_card` çağırıyor, kart running'e geçiyor.
6. Hermes `subscribe_card_output(cardId)` ile **sadece bu kartı** izliyor (7/24 global izleme
   değil — bu, o an verilen görevin canlı takibi).
7. Done-signal gelince: Hermes `get_git_diff` ile diff'i okuyor, kendi review'unu yapıyor
   (`run_tests`, `run_typecheck`, gerekirse `take_app_screenshot`).
8. Buna ek olarak her başarılı kart, açık bir Hermes konuşması beklemeden, önce kalıcı ve
   dedup'lı `swarm-completion` Sentinel sinyaline dönüşür. Kart/spec, diff, worktree durumu,
   sadece o session'ın bounded çıktı marker'ları ve gözlemlenen check sonuçları redakte edilip
   tool-less Hermes V4 Pro'ya verilir; yönetici özeti app toast + macOS'a gider. Pro yoksa
   deterministik özet kullanılır; model tamamlanma bilgisinin taşınmasında load-bearing değildir.
9. Hermes sana (chat widget/telefon) ne olduğunu anlatıyor — başarılıysa özet, başarısızsa
   neyin başarısız olduğu + önerisi.
10. Hermes `write_memory_summary` ile bir özet düşüyor (Faz 5'in memory akışına bağlanıyor).

- **Test:** kota-var/kota-yok senaryoları, çoklu netleştirici soru akışı (mock), review adımının
  gerçekten `run_tests` vb. çağırdığını doğrulayan entegrasyon testi.
- **Geri alma:** Faz 4'ün mantığı yeni bir servis (`HermesDispatchService` gibi) içinde
  izole tutulmalı — var olan `SwarmService.spawnWorker` yoluna dokunulmuyor, Hermes sadece
  MCP tool'ları üzerinden dışarıdan kart açıp başlatıyor (bir insanın UI'dan yaptığı ile
  aynı yoldan). Bu yüzden geri alma kolay: `HermesDispatchService`'i kapat, SwarmService
  etkilenmez.

### Faz 5 — Memory yakalama yeniden tasarımı — TAMAMLANDI (2026-07-05)
**Bağımlılık:** Faz 2 (OpenRouter key), Faz 3'ün `write_memory_summary`/`resolve_memory_review`
tool'ları · **Model:** `deepseek/deepseek-v4-flash` (explicit mechanical route)

Bu faz başlamadan önceki sistem (historical): `MemoryAutoCapture` 90sn'de bir polling yapıyor,
idle ≥10dk session'ları yakalıyor ve damıtmayı local `claude` CLI ile yapıyordu. Fazın gerçekleşen
sonucu aşağıda: distiller Hermes/Flash'a taşındı; conflict/merge/new sınıflandırması hâlâ
`shared/memory-reconcile.ts`'de deterministik, review kuyruğu aynı güvenlik sınırında.

Değişecekler:

1. **`terminal:exit` tetikleyicisi eklenir** (idle-poll'un yanına, yerine değil). Terminal
   kapanınca o session için hemen capture tetiklenir; idle-poll, hiç kapatılmadan terk edilen
   session'lar için fallback olarak kalır. (`TerminalManager.ts:169`'daki `terminal:exit`
   event'ine yeni bir listener eklenir — `Services.ts` içinde, var olan
   `SwarmService`/`tuiState` listener'larıyla aynı yerde.)
2. **Damıtma motoru local `claude` CLI'dan Hermes/DeepSeek'e taşınır** (maliyet kararı: local
   CLI "ücretsiz" görünüyor ama Claude'un kullanım kotasından düşüyor — tam da coding için
   ayırmak istediğimiz kaynağı yiyor; DeepSeek session başına ~$0.01'in altında ve kotaya hiç
   dokunmuyor). **Not: Docker/container network isolation kararı düştüğü için, "redaction
   proxy + kilitli container network" fikri artık bir OS-seviyesi garantiye dayanmıyor** —
   `shared/redaction.ts`'ten geçirip local bir proxy üzerinden OpenRouter'a göndermek hâlâ
   yapılacak (gerçek, ucuz bir koruma) ama bu **best-effort bir yazılım sınırı**, container
   ile zorlanan bir ağ sınırı değil — local çalışan her şeyle aynı güven seviyesinde.
3. **Conflict çözümü UI'dan sohbete taşınır** — Hermes `get_pending_memory_reviews`'i okuyup
   kanıt açıksa kontrollü delegated resolver olarak çözer; basis+rationale+evidence zorunludur
   ve recency tek başına geçersizdir. Kanıt yetmiyorsa farkı sade dille sorar ve senin kararını
   `resolve_memory_review` ile uygular. Memory tab UI'daki manuel Save/Edit/Discard kuyruğu
   **kaldırılmıyor**, Hermes ek bir arayüz sunuyor.
4. **Başarı/başarısızlık öğrenimi** — mevcut distill prompt'unun (`memory-observation.ts:79-98`)
   sadece "durable fact" çıkarıp çıkarmadığı, yoksa "bu session'da ne başarısız oldu, neden"
   diye özellikle sorup sormadığı **doğrulanacak**. Sormuyorsa, prompt'a küçük bir ek yapılacak.
5. Proje-bazlı vs global ("Baz brain") routing **değişmiyor**, zaten var, Hermes sadece
   `MemoryPipeline.route()`'un yaptığına saygı duyuyor.

- **Test:** terminal-close capture'ın idle-poll'dan bağımsız çalıştığını, Hermes'in damıttığı
  notların aynı reconcile/gate mantığından geçtiğini, conflict'lerin sohbet üzerinden
  çözülebildiğini doğrulayan entegrasyon testleri.
- **Geri alma:** `terminal:exit` listener'ı kaldır (idle-poll tek başına kalır, eski davranış);
  damıtma motorunu local `claude`'a geri al (feature flag ile).

**Gerçekleşen (2026-07-05):**

1. **Damıtma motoru** — `shared/hermes-run.ts`: `buildHermesArgs(prompt, {model})` →
   `['--ignore-rules', '--oneshot', prompt]` (`--ignore-rules` bilinçli — bu dar, mekanik damıtma
   çağrısı Hermes'in orkestratör-persona `AGENTS.md`'sini yüklemesin diye). `claude-run.ts`'e hiç
   dokunulmadı (`ChatService`/`ReviewService`/`CouncilService` hâlâ onu kullanıyor).
   `MemoryDistiller.defaultRunner` artık `resolveBin('hermes')` + `buildHermesArgs` kullanıyor.
   Redaction zinciri (`TranscriptReader.read(..., true)`, `redactText`) hiç değişmedi — zaten
   prompt'tan önce, hangi CLI'ın çalıştığından bağımsız olarak uygulanıyor.
2. **Prompt'a başarısızlık-yansıması eklendi** — `shared/memory-observation.ts`'in
   `PROMPT_HEADER`'ına "mistake-then-correction" örüntüsünü `gotcha` sınıfı olarak yakalama
   talimatı eklendi, "precision over recall"/"boşsa boş liste dön" disiplini korunarak (ekleme,
   çıta düşürme değil). Sentetik failure→correction transcript testiyle doğrulandı.
3. **`terminal:exit` anında yakalama** — `TerminalExitEvent`'e `projectId` + `role` eklendi
   (`shared/domain.ts`), `MemoryAutoCapture`'da paylaşılan `enqueueSession()` çıkarılıp yeni
   public `captureNow(projectId)` eklendi (idle beklemeden hemen enqueue+drain), yeni
   `electron/main/services/memoryExitTrigger.ts` (`registerMemoryExitCapture`) sadece
   `role === 'claude'` çıkışlarında tetikliyor. 90sn idle-poll fallback olarak aynen duruyor.
4. **Conflict çözümü sohbete taşındı ve sonra sertleştirildi** — Hermes
   `get_pending_memory_reviews`'i okur. Evidence açıksa kapalı bir delegated basis, rationale ve
   evidence ile kendisi çözer; aksi halde çelişkiyi tek cümlede sorup kararı uygular. Mutation
   gateway kanıtsız/recency-temelli AI çözümünü reddeder; ledger `replace/delegated`, audit ise
   actor+basis+rationale+evidence kaydeder. Memory tab UI'daki manuel kuyruk kaldırılmadı.
5. **Test:** 660→666 test yeşil (6 yeni: exit-trigger'ın idle-poll'dan bağımsız + role-filtreli
   çalıştığını, prompt-tweak'in gotcha'yı yüzeye çıkardığını kanıtlıyor).
   `npm run typecheck`/`lint`/`test`/`build` bağımsız olarak tekrar doğrulandı, mevcut
   `terminal:exit` tüketicilerinde (`SwarmService`, `CardOutputTracker`, `index.ts`) regresyon yok.

### Faz 6 — Git/log app steward
**Bağımlılık:** Faz 3 · **Model:** LLM-free sensors → bounded V4 Flash triage; approvals remain deterministic

**Scoping cevabı (Baz, 2026-07-05): İkisi de — günlük özet HER ZAMAN üretilir, ama bulunan
sorunlar için kart açma önerisi Baz'ın onayını bekler, Hermes kendi başına açmaz.**

Somut tasarım:

1. **Yeni MCP tool: `get_log_intelligence`** — var olan `LogIntelligenceService`'i sarar
   (Faz 3'ün diğer tool'larıyla aynı disiplin: read-only, mevcut şemayı/metodu kullan).
2. **Yeni MCP tool: `propose_swarm_card`** — `create_swarm_card`'ın aksine kartı **hemen
   açmıyor**. Var olan `ApprovalService`/`guarded()` desenini kullanarak (CLAUDE.md'deki
   git_force_push/deploy vb. ile aynı mekanizma) bir onay isteği oluşturuyor — Dashboard'daki
   var olan "Awaiting your approval" banner'ında görünüyor (aynı UI, yeni bir approval kind).
   Baz Approve'a basınca, main process **doğrudan** (Hermes'e geri dönmeden) `create_swarm_card`
   + `start_swarm_card`'ı çalıştırıyor — tıpkı `git_push` onayının çalışma şekli gibi.
3. **Tetikleyici ayrımı (2026-07-12 güncel):** cockpiT's built-in
   `OperationalHealthService` owns the 30-minute deterministic system sweep; app-owned
   `AutomationService` owns the visible daily briefing and user schedules. The sweep persists
   a bounded snapshot first and wakes Flash only for a changed actionable anomaly. A due
   automation gets one separate, bounded Flash verdict; healthy/unchanged sweep runs make no
   model call and no second implicit digest exists.
4. **`AGENTS.md`'ye eklenecek:** "insan senden istedi" (Faz 4 akışı, create+start doğrudan) ile
   "kendi başına fark ettim" (Faz 6 akışı, mutlaka propose+onay bekle) ayrımı — Hermes bu ikisini
   asla karıştırmamalı.

#### Faz 6 bulguları / gerçekleşen (2026-07-05)

- **Yeni approval-kind: `propose_open_swarm_card`** (risk `medium`). Üç senkron yer güncellendi:
  `ApprovalActionType` union (`shared/domain.ts`), `approvalActionTypeSchema`
  (`shared/schemas.ts`), `RISK` map (`shared/approval-rules.ts:riskLevelFor`). Yıkıcı değil ama
  worker/kota harcadığı için gated.
- **İki yeni MCP tool** (toplam 16): `get_log_intelligence` (`hermesToolsLogs.ts`, read-only,
  `LogIntelligenceService.listLogs`+`listInsights`'i sarar, `projectIdSchema`) ve
  `propose_swarm_card` (`hermesToolsPropose.ts`). `propose_swarm_card` **asla** kart açmaz —
  sadece `ApprovalService.request({actionType:'propose_open_swarm_card', payload:{title,body,assignments}})`
  çağırıp approval id'sini Hermes'e döndürür. Yeni şemalar: `proposeSwarmCardSchema`
  (reason ≤500 zorunlu) + `proposedSwarmCardPayloadSchema` (executor'ın payload'ı geri okurken
  doğruladığı alt-küme). `HermesToolContext`'e `logs` + `approvals: Pick<…,'request'>` eklendi,
  `Services.ts`'te gerçek instance'lar bağlandı.
- **`HermesApprovalExecutor` (yeni, `electron/main/services/hermes/`):** `approvals:changed`
  event'ini dinler; approve edilen her `propose_open_swarm_card` için main process **doğrudan**
  `createCard`→(assignments varsa)`updateCard`→`startCard` çalıştırır. **Çift-çalıştırma koruması:**
  kart açmadan ÖNCE `consume()` çağrılır (atomik `WHERE status='approved'` UPDATE, tek kazanan);
  consume fırlatırsa "zaten alınmış" kabul edilip atlanır — duplicate event (ve consume'un kendi
  emit ettiği `approvals:changed`) kartı iki kez açamaz. Her hata loglanır, asla fırlatılmaz.
  `ApprovalService`'e iki read metodu eklendi: `get(id)` + `listApproved(projectId, actionType)`.
- **`AGENTS.md`:** "Two ways a card gets opened" bölümü eklendi — insan-istedi (create+start
  doğrudan) vs kendi-fark-etti (propose+bekle) ayrımı net; emin değilsen propose et.
- **Test:** 689→700 (11 yeni). `propose_swarm_card` happy/Zod-reddi + swarm'a hiç dokunmadığı
  (spy) ispatı; `get_log_intelligence` happy/Zod-reddi; executor için approve→create+start+consumed,
  rejected→hiçbir şey, duplicate→tek create (idempotent), event-wiring, ve start hata verse bile
  watcher çökmez. `typecheck`/`lint`/`test`/`build` hepsi yeşil.

#### Faz 6 operational health sweep (2026-07-12)

- `OperationalHealthService` checks git divergence/conflicts, Claude/Codex quota, missing/stuck/
  parked Swarm work, verified orphan-process audit facts, grouped error counts, stale approvals,
  and Memory queue/review counts every 30 minutes. Sensors are isolated and content-free.
- V20 keeps one row per project with last run/result, actionable fingerprint, notification and
  a legacy digest-cadence column, plus an atomic overlap claim. A stale claim recovers after ten
  minutes.
- Existing Log Intelligence and Memory lifecycle alerts are counted but never duplicated. A
  one-off sensor miss is quiet; a repeated blind spot becomes a change-only Sentinel notice.
- Only changed actionable degradation reaches the standard `operational-health` Sentinel → V4
  Flash path. The former hidden 24-hour digest cadence remains schema-compatible in V20 but is
  retired; the visible Item 9 automation below is the single daily-delivery owner.

#### Faz 6 safe daily automations (2026-07-12)

- V21 `automation_jobs` stores one project-scoped lifecycle row per job: friendly schedule,
  next/last run, bounded result/error, enabled state, and an atomic overlap claim. A stale claim
  recovers after ten minutes; built-in daily jobs are idempotent and cannot be deleted.
- Every project gets one visible 09:00 `Daily briefing`. The Automations view shows plain-language
  create, last/next/result, run/retry, pause/resume, and delete controls; cron expressions never
  cross IPC or appear in UI.
- `HermesAutomationRunner` explicitly selects V4 Flash, ignores project rules, and exposes only
  the harmless `todo` toolset—no cockpit MCP, terminal, files, code execution, browser, or
  computer-use. The owner instruction is fenced as reference data and the health snapshot is
  content-free.
- Results persist before any delivery. A specialist `stage` → `publishStaged` path reuses the
  one Flash verdict instead of triggering generic triage again, and sends the manager note to
  app/macOS. A report-worthy finding may propose a Swarm card only through
  `propose_open_swarm_card`; it never starts work itself.
- Native `hermes cron` is deliberately not the authority boundary: its non-interactive mode
  auto-bypasses soft command approvals and can load broader toolsets. cockpiT owns the clock and
  state; Hermes only interprets bounded evidence.

### Faz 7 — Hermes chat widget — TAMAMLANDI (2026-07-05)

- Sağ-alt köşe, küçük, collapse/expand olan chat bubble — var olan `RightPanel`
  (`CHAT_ENABLED=false`) değil, ayrı bir component. Görsel tasarım kasıtlı minimal (Baz'ın ayrı
  bir design fikri var, sonra uygulanacak).
- **Backend (`HermesChatService`, `electron/main/services/hermes/`):** `hermes -z` her turda
  **stateless** olduğu için (kod okunarak doğrulandı — oneshot'ın `--resume`'u yok, session id
  hiç basmıyor), servis proje başına conversation history'yi **kendisi** tutuyor
  (`shared/hermes-chat.ts`: son 20 turn VE 40.000 karakter, en eskiden kırpılıyor) ve her turda
  transcript'i yeniden prompt'a gömüp `hermes -z` çağırıyor. Distiller'dan farklı olarak
  `--ignore-rules` **kullanılmıyor** — chat'in `AGENTS.md` + `cockpit` MCP tool'larını yüklemesi
  gerekiyor. Timeout 5dk (çoklu tool çağrısına yer).
- IPC: `hermesChatAsk`/`hermesChatClear`, Zod-validated, `HermesChatReply` (`{ok, text, error?}`).
  Hermes kurulu değilse insan-okur bir hata döner, exception IPC sınırından geçmiyor.
- **UI (`HermesWidget.tsx`):** gerçek mesaj thread'i, gönderirken pulsing "thinking" göstergesi,
  hata balonları (muted/danger ton), "new conversation" reset butonu, proje açık değilse
  composer disabled + net bir "no project open" durumu. "SOON" rozeti kaldırıldı.
- **Test:** 23 yeni test (history cap/truncation, schema validasyonu, hermes-not-found hata yolu,
  clear()). Screenshot ile 4 durum (empty/thinking/completed/error) doğrulandı, 2 review turu.
  `npm run typecheck`/`lint`/`test` (689/689)/`build` yeşil.

### Faz 8 — Uzaktan/telefon görev verme
**Bağımlılık:** Faz 4 (aynı dispatch akışı), Faz 1'in DM pairing doğrulaması · **Sıra: en son**
**Durum (2026-07-05):** Baz bilinçli olarak erteledi — "önce Hermes'i tam istediğimiz gibi
kuralım, telefon bağlantısını ondan sonra konuşuruz." **Taşıma katmanı (transport) artık kesin
Telegram değil** — kendi mobil app'imizi de yazabiliriz, henüz karar verilmedi. Bu fazın planı
Telegram varsayımıyla yazıldı (hermes-agent'ın hazır DM pairing/allowlist mekanizması olduğu
için en düşük dirençli yol), ama Faz 1-7 bitmeden bu karara girilmeyecek.

- Eğer Telegram seçilirse: yeni bir mekanizma değil — **Faz 4'ün swarm-card dispatch akışının
  Telegram'dan tetiklenen hali.** Baz telefondan Hermes'e yazıyor, Hermes aynı netleştirici-soru →
  kart-oluştur → kota-kontrol → dispatch → review → rapor akışını izliyor, sadece giriş/çıkış
  kanalı chat widget yerine Telegram. Zorunlu ön koşul: native DM pairing/sender-allowlist
  (Faz 1'de doğrulandı) devrede olmalı — sadece Baz'ın Telegram ID'sinden gelen mesajlar kabul
  edilir. Zorunlu test: Telegram'dan gönderilen yıkıcı bir komutun gerçekten reddedildiğini
  kanıtlayan bir güvenlik testi.
- Eğer kendi mobil app'imiz olursa: transport katmanı cockpiT'in kendi backend'ine (muhtemelen
  HermesMcpServer'ın bir uzantısı veya ayrı bir authenticated API) bağlanır — bu senaryo henüz
  hiç detaylandırılmadı, ayrı bir tasarım turu gerektirir.
- Daemon yaşam döngüsü (Mac açılışında mı, cockpiT açıkken mi başlıyor) hâlâ açık soru,
  transport kararından bağımsız olarak geçerli.

### Faz 9 — Günlük hayat entegrasyonları (ertelendi, kapsam dışı)
Değişmedi — takvim/hatırlatıcı/not, hermes-agent'ın MCP desteğiyle ayrı bir scoping
görüşmesinde ele alınacak.

## Bağımlılık grafiği

```
Faz 1 (spike, local) ──┬──> Faz 3 (MCP server) ──┬──> Faz 4 (swarm-card dispatch) ──> Faz 8 (telegram, en son)
Faz 2 (secret)       ──┘                          ├──> Faz 5 (memory redesign)
                                                   └──> Faz 6 (git/log steward, scoping bekliyor)
Faz 7 (chat widget) — bağımsız, şimdi başladı, Faz 4/5 bitince gerçek backend'e bağlanacak
Faz 9 — ayrı, ertelendi
```

## Açık sorular (Baz'a)

1. ~~Faz 1 madde 3~~ — **çözüldü**, bkz. Faz 1 bulguları (gerçek hardline floor + deny-list doğrulandı).
2. Faz 6: "Git/log'dan sorumlu olmak" günlük olarak somut ne üretsin?
3. Faz 8: `hermes gateway` ne zaman çalışsın (Mac açılışı / cockpiT açıkken / manuel buton) —
   ayrıca transport artık Telegram'a kilitli değil, kendi mobil app'imiz de olabilir (bkz. Faz 8).
4. Faz 5 madde 4: mevcut distill prompt'u gerçekten okunup "başarısızlık" sinyali arayıp
   aramadığı teyit edilmeli — teyit edilene kadar bu madde "yapılacaklar" listesinde varsayımsal.

## Kabul edilmiş riskler (tartışmaya kapalı, sadece kayıt altında)

- **Docker yok kararı:** Hermes'in kendi shell executor'ı cockpiT'in onay kapısını görmüyor.
  Mitigasyon: Hermes'in cockpiT-kontrol yetkisi MCP tool listesiyle sınırlı (raw shell değil);
  Hermes'in coding ihtiyacı Claude Code/Codex'e devrediliyor (Hermes hiç kod yazmıyor);
  hermes-agent'ın native command-approval'ı — **Faz 1'de doğrulandı (kod okunarak, varsayım
  değil):** gerçek bir hardline floor var (rm -rf /, mkfs, fork bomb, shutdown vb. hiçbir
  modda çalışmaz) + kendi `approvals.deny` kurallarımızı ekleyebildiğimiz koşulsuz bir liste.
  Bu ikisi pattern/regex-tabanlı — Docker'ın verdiği OS-seviyesi izolasyon değil, ama "sadece
  LLM'e güven"den çok daha güçlü. Yumuşak "dangerous" liste (force-push, rm -r vb.) oneshot/MCP
  çağrılarında atlanıyor — bu yüzden Faz 3'te kendi deny-list kurallarımızı eklemek zorunlu.
  Üç mitigasyon birlikte riski daraltıyor ama **sıfırlamıyor** — bilinçli bir tradeoff.
- **Memory damıtmasının local'den DeepSeek'e taşınması:** session transcript'i artık
  OpenRouter'a gidiyor (redaction sonrası). Container network sınırı olmadığı için bu bir
  yazılım-seviyesi (best-effort) koruma, OS-seviyesi değil.
