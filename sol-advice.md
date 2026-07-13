# Sol'un cockpiT analizi ve tavsiyeleri

> **HISTORICAL SNAPSHOT.** Bu rapor 2026-07-09 mimarisini anlatır; güncel runtime
> sözleşmesi veya uygulama talimatı değildir. 2026-07-13 sonrası aktif kaynaklar
> `docs/plans/agent-memory-system-v2.md` ve `docs/MEMORY-CHARTER.md` dosyalarıdır.

> Tarih: 2026-07-09
>
> İncelenen sürüm: `v0.2.1` / `09dbc51`
>
> Kapsam: ürün vizyonu, Electron güven sınırı, terminal katmanı, Swarm, Council,
> Hermes, Sentinel, Memory, Git/review, usage/outcomes, testler, CI/release,
> tasarım ve gelir stratejisi.

## Kısa hüküm

cockpiT artık bir “vibe coding terminali” değil. Yerel çalışan bir **AI engineering
control plane** olma yolunda: proje bağlamını, farklı model kapasitelerini, güvenli
iş yürütmeyi, hafızayı, gözlemlenebilirliği ve insan onayını tek yerde topluyor.
Bu yön doğru ve sıradan bir AI IDE'den daha değerlidir.

Sistemin en güçlü tarafı panel sayısı değil, şu döngünün büyük kısmının gerçekten
çalışıyor olması:

```text
Sinyal / insan isteği
  → spec gate (Council)
  → izole iş alanı (Swarm worktree)
  → worker
  → diff / review
  → insan kararı
  → outcome
  → kalıcı hafıza
```

Ancak bugün bu döngü bazı yerlerde **kanıt yerine UI durumu** kullanıyor. Bir kartın
`Done` olması kodun `main`e girdiğini göstermiyor; Council onayı kart metninin o
versiyonuna kriptografik olarak bağlı değil; ardışık agent adımları çıktılarını
birbirine devretmiyor; Swarm execution hâlâ fiilen Claude-only. Bir sonraki büyük
sıçrama daha fazla feature değil, bu zinciri **artifact ve provenance temelli**
hale getirmek olmalı.

Benim genel değerlendirmem:

| Alan | Durum | Yorum |
|---|---:|---|
| Ürün vizyonu | Çok güçlü | “Terminal değil cockpit” ayrımı doğru |
| Temel mimari | Güçlü | Main/preload/renderer sınırı temiz |
| Güvenlik niyeti | Güçlü | Redaction, approval, audit, MCP allowlist iyi |
| Güvenlik güncelliği | Kritik açık | Electron 33 EOL ve audit açıkları var |
| Swarm izolasyonu | İyi ama fail-open | Worktree başarısızsa project root'a düşebiliyor |
| Agent orkestrasyonu | Orta | Paralel kart var; gerçek handoff ve engine çeşitliliği eksik |
| Memory vizyonu | Çok güçlü | Ürünün muhtemel kalıcı moat'i |
| Memory doğruluğu | Riskli | 102 dirty değişiklik ve güncelliğini yitirmiş notlar var |
| Test omurgası | Güçlü | 1130 unit + 5 mock E2E yeşil |
| Release gate doğruluğu | Eksik | Coverage ve E2E CI'da gerçekte zorunlu değil |
| Tasarım | Ayırt edici | Premium kimlik var; dashboard yoğunluğu azaltılmalı |
| Gelire hazır olma | İç kullanımda yakın | Dış dağıtım/onboarding/trust katı henüz hazır değil |

## Sistemi nasıl anlıyorum

### 1. Uygulama kabuğu

- Electron main process tüm gerçek yetkiyi elinde tutuyor.
- Renderer yalnızca UI; Node API almıyor.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Typed preload bridge (`window.cockpit`) dışında renderer → main yolu yok.
- IPC girdileri Zod ile sınırda doğrulanıyor.
- Browser mock, renderer'ı Electron olmadan çalıştırıp screenshot ve E2E sağlıyor.

Bu temel doğru. cockpiT büyürken en çok korunması gereken mimari karar bu.

### 2. Execution katmanı

- `TerminalManager` gerçek PTY süreçlerini yönetiyor.
- OSC 133 tabanlı Command Blocks terminali semantik bloklara ayırıyor.
- Swarm kartı kendi branch/worktree'sinde worker açıyor.
- Kartlar paralel, kart içindeki role pipeline ise ardışık çalışıyor.
- Crash/quit sonrası terminal, worktree ve kart reconciliation mekanizmaları var.

### 3. Judgment katmanı

- Council farklı lens ve engine'lerle spec veya diff inceliyor.
- Spec modu autonomous build öncesi gate.
- Sentinel deterministik sinyali önce kaydediyor, Hermes ile sonradan enrich ediyor.
- Review diff'i sanitize edip LLM'e veriyor.
- Outcome scorecard Council, Memory ve Sentinel kararlarının sonuçlarını okumaya
  çalışıyor.

### 4. Memory katmanı

- `.cockpit-memory/*.md` dosyaları proje bilgisinin kaynak gerçeği.
- SQLite ledger provenance ve review queue tutuyor.
- Claude session transcript'leri otomatik distill ediliyor.
- 7-day test, dedup, secret rejection ve review gate kod seviyesinde mevcut.
- Relevance-ranked pointer'lar Council ve Swarm prompt'larına giriyor.
- Haftalık curation doğrudan silmiyor; proposal üretiyor.

Bu sistem ürünün en değerli uzun vadeli parçası olabilir. Bir agent'ın iyi cevap
vermesi kolay kopyalanır; bir ekibin/projenin geçmişinden **doğru, güncel ve ölçülen
bir kurumsal hafıza** üretmek daha zor kopyalanır.

### 5. Hermes katmanı

- Hermes chat proje `AGENTS.md` kurallarıyla çalışıyor.
- Loopback MCP server yalnızca allowlist tool setini sunuyor.
- Per-launch bearer token ve DNS-rebinding koruması var.
- Hermes doğrudan shell/filesystem almıyor; aynı app servislerini çağırıyor.
- İnsan isteğiyle açılan kart ve Hermes'in kendi fark ettiği konu için proposal
  birbirinden ayrılmış.

Bu ayrım çok iyi: “agent bir şey fark etti” ile “insan bunu yap dedi” aynı yetki
değildir.

## Gerçek doğrulama sonuçları

Bu rapor yalnızca doküman okumaya dayanmıyor. Mevcut `v0.2.1` üzerinde:

- `npm run typecheck`: geçti.
- `npm run lint`: geçti, 0 warning.
- `npm test`: 92 suite, **1130/1130 test geçti**.
- `npm run test:coverage`: geçti.
  - Tüm ölçülen dosyalar: %81.66 statement/line, %86.49 branch, %81.61 function.
  - `shared/`: %97.88 line.
  - main services: %71.08 line.
- `npm run build`: geçti.
- `npm run test:e2e`: **5/5 geçti**.
- `npm audit --omit=dev`: 0 bulgu.
- Tam `npm audit`: **18 bulgu**; 4 moderate, 12 high, 2 critical.
- GitHub Release `v0.2.1`: başarılı CI run'ından yayınlanmış; ZIP, DMG,
  blockmap ve `latest-mac.yml` var.
- Local `HEAD`, `v0.2.1` tag'i ve `origin/main` aynı commit'te.

İlk unit/E2E denemelerinde görülen `listen EPERM` hataları sandbox'ın localhost
portu açmasını engellemesiydi. Loopback izniyle gerçek koşulda tekrarlandığında
tüm testler geçti; bunları ürün hatası olarak saymıyorum.

## P0 — release sonrasında ilk yapılması gerekenler

### P0.1 — Electron 33'ü desteklenen hatta taşı

Bu artık normal dependency bakımı değil, güvenlik açığıdır.

- `package.json` Electron `^33.3.1` kullanıyor.
- Electron 33 resmi olarak **29 Nisan 2025'te EOL** oldu.
- 2026-07-09 tarihinde stable/supported hatlar 41–43; stable `43.1.0`.
- Tam npm audit Electron üzerinden çok sayıda high güvenlik advisory'si bildiriyor.
- Roadmap'teki “bir major geride” cümlesi güncel değil; yaklaşık on major geride.

Kaynaklar: [Electron release schedule](https://releases.electronjs.org/schedule),
[Electron stable releases](https://releases.electronjs.org/).

Tek seferde kör `npm audit fix --force` yapılmamalı. Ayrı bir upgrade programı:

1. Electron + `@electron/rebuild` + electron-vite/Vite + electron-builder
   compatibility matrisi çıkar.
2. Önce Electron'ı desteklenen bir hatta geçir; native ABI rebuild yap.
3. `better-sqlite3`, `node-pty`, updater, safeStorage, signing ve packaged PTY
   testlerini gerçek `.app` üzerinde çalıştır.
4. Ardından build-tool advisories'ini kapat.
5. Upgrade'i normal feature ile karıştırma; rollback edilebilir tek amaçlı release yap.

### P0.2 — CI'ın söylediğiyle gerçekten yaptığı aynı olsun

`docs/plans/system-roadmap.md` B3 “coverage CI'da enforce” diyor; Gate C “kırmızı
E2E release'i bloklar” diyor. Mevcut `.github/workflows/release.yml` ise:

- `npm run typecheck`
- `npm run lint`
- `npm test`

çalıştırıyor; `npm run test:coverage` ve `npm run test:e2e` çalıştırmıyor.
`e2e/README.md` bunu dürüstçe “CI wiring follow-up” diye kaydetmiş. Yani roadmap
status'u ile executable gate farklı.

Release workflow'a şunlar eklenmeli:

1. `npm run test:coverage` — configured threshold gerçekten release'i bloklasın.
2. Fresh build sonrası Playwright mock E2E.
3. En az bir packaged-app smoke: app açılıyor, preload bridge geliyor, SQLite
   migration geçiyor, gerçek PTY açılıyor/kapanıyor.
4. Failure artifact olarak Playwright report, screenshot, app log ve migration
   diagnostics yüklenmeli.

Mock E2E çok yararlı ama preload, native modules, signing, updater ve PTY'yi test
etmez. C2 artık “nice to have” değil; Electron upgrade'in güvenlik kemeri.

### P0.3 — Worktree yoksa autonomous worker'ı project root'a sessiz düşürme

`SwarmService.startCard()` worktree creation başarısız olduğunda `worktree = null`
ile devam ediyor ve worker'ı ana proje dizininde açıyor. Kod yorumu bunu açıkça
“refused start would be worse than unisolated one” diye savunuyor.

Benim kararım tersidir: autonomous coding için **izolasyonsuz başlamak, başlamamaktan
daha kötüdür**. Ana worktree'de insan değişikliklerini veya başka kartı ezebilir;
ürünün verdiği “parallel safe” sözünü sessizce bozar.

Öneri:

- Coding rolü için fail closed: worktree yoksa kart `blocked/parked` kalsın.
- Scout/planner gibi read-only roller için project root fallback opsiyonel olabilir.
- Kullanıcı açıkça “unisolated, concurrency=1” demeden builder root'ta başlamasın.
- UI ve audit, isolation mode'u görünür göstersin.

### P0.4 — Spec approval'u kartın tam sürümüne bağla

Bugün `council_session_id` approved bir session'a işaret ediyorsa kart gate'i
geçiyor. Fakat:

- Council sonucu incelenen spec'in digest'ini saklamıyor.
- Kart body onaydan sonra değiştirilebiliyor.
- Başka bir approved session id aynı projedeki farklı body'ye bağlanabiliyor.

Bu nedenle gate bugün “approved meeting linki var” diyor; “bu metin onaylandı”
demiyor.

Gerekli model:

```text
spec_revision_id
spec_sha256
council_session_id
approved_at
```

Kart title/body/acceptance criteria değiştiğinde approval otomatik stale olmalı.
Start yalnızca current spec hash = approved spec hash ise geçmeli. Küçük metadata
değişiklikleri için hangi alanların hash'e dahil olduğu açık tanımlanmalı.

### P0.5 — “Done” ile “shipped” kavramlarını ayır

Şu an kart `Done` kolonuna sürüklenince `swarm.card_shipped` outcome'u yazılıyor.
Fakat worker özellikle commit/push yapmıyor; move işlemi branch'in `main`e merge
olduğunu, release'e girdiğini veya acceptance criteria'nın geçtiğini doğrulamıyor.

Bu durum Judgment Scorecard'ın temel gerçeğini bozabilir: Council-gated kartların
başarısı gerçekte “kullanıcı kartı Done'a sürükledi” ile ölçülür.

Artifact lifecycle önerim:

```text
completed  = worker bitti, diff üretildi
accepted   = insan diff'i kabul etti
integrated = commit SHA main/default branch'te reachable
released   = SHA release tag/deploy içinde
reworked   = acceptance sonrası yeniden değişti
reverted   = revert veya düzeltme commit'i geldi
```

Her aşamada kanıt saklanmalı: diff hash, commit SHA, check run id, reviewer,
release/deploy id. “Shipped” yalnızca `integrated` veya `released` kanıtıyla
kullanılmalı.

## P1 — sistemi gerçekten çok-agentlı ve kendini geliştiren hale getirecek işler

### P1.1 — Role pipeline'a gerçek handoff artifact'i ekle

Bugün Planner → Builder → Reviewer adımları aynı worktree'de ardışık çalışıyor.
Fakat planner yalnızca terminale plan yazarsa, bu çıktı builder prompt'una
aktarılmıyor. Yeni worker aynı kart body + Council brief + memory pointer ile
başlıyor. Bu bir zincir görünümü veriyor ama planner'ın düşüncesi kayboluyor.

Her step typed artifact üretmeli:

- Planner: `plan.json` veya structured markdown.
- Builder: changed files, check results, deviations from plan.
- Tester: test evidence.
- Reviewer: severity-tagged findings.
- Fixer: finding id → fix → proof.

Artifact DB'de metadata + worktree'de inspectable file olarak tutulabilir. Sonraki
step'in prompt'una capped summary ve artifact path verilmelidir. Bir step gerekli
artifact'i üretmediyse pipeline ilerlememelidir.

Bu mekanizma cockpiT'in önemli farkı olabilir: “beş agent çalıştırdım” değil,
**her agent ne teslim etti ve sonraki onu gerçekten kullandı**.

### P1.2 — Swarm execution'ı engine-neutral yap

Council gerçekten Claude/Codex/OpenRouter karışımı kullanıyor. Swarm worker ise
`shared/swarm-worker.ts` içinde daima `claude ...; exit` üretiyor ve terminal rolü
`claude`. `assertQuotaAllows()` da yalnızca Claude exhaustion kontrol ediyor.

Yani şu an:

- Çoklu engine judgment var.
- Paralel kart var.
- Farklı persona/role var.
- Fakat heterogeneous execution yok.

Kart/assignment seviyesinde açık bir `enginePolicy` gerekli:

```text
preferred: claude | codex
fallbacks: [...]       # yalnız insan politikası izin veriyorsa
model: optional
reason: capability / cost / quota / measured quality
```

Claude quota bittiğinde sessiz switch yapılmamalı; mevcut Hermes sözleşmesi doğru:
kullanıcıya Claude/Codex seçenekleri sunulmalı. Engine adapter ortak bir lifecycle
üretmeli: spawn, resume, stop, output parse, completion signal, usage attribution.

### P1.3 — Provider çeşitliliğini Council approval şartına dahil et

Council seat fallback'leri sistemi dayanıklı yapıyor; fakat birkaç seat aynı Claude
fallback'ine düşerse beş bağımsız isim gerçekte tek provider ailesinin görüşü
olabilir. Riskli işler için minimum independence policy öneririm:

- En az N başarılı seat.
- En az 2 farklı engine/provider ailesi.
- Chairman engine'i en azından kritik seat çoğunluğundan farklı.
- Degrade edildiğinde UI “5/5 seat” değil, “5 seat / 2 provider” göstersin.

Trivial işlerde tek hızlı reviewer yeterli olabilir. Council maliyetinin sonucu
iyileştirip iyileştirmediğini Outcome verisiyle ölçmeden her karta aynı ağır akışı
uygulamayın.

### P1.4 — Prompt ve karar provenance'ını versionla

Outcome ölçümü için yalnız model adı yetmez. Şunlar kaydedilmeli:

- prompt template version/hash,
- Council roster version,
- engine/model gerçek kullanılan değer ve fallback bilgisi,
- input spec/diff hash,
- memory note id + version/hash,
- tool policy version,
- duration, token/cost, retry/timeout.

Böylece “Council iyi mi?” yerine “hangi roster + prompt + engine kombinasyonu bu
iş tipinde daha az rework üretiyor?” sorusu cevaplanır.

### P1.5 — Memory'yi engine-neutral ve freshness-aware yap

Auto-capture bugün `ClaudeSessionsService` üzerinden Claude transcript'lerine
odaklı. Codex, Hermes, Council ve Swarm artifact'leri aynı kapsama doğal biçimde
girmiyor. Kendini geliştiren sistem için tek bir normalized event/artifact stream
gerekli.

Önerilen kaynaklar:

- Human decision
- Claude/Codex/Hermes turn
- Council verdict
- Swarm step artifact
- Check result
- Git integration/revert
- Sentinel signal/outcome
- Release/deploy

Memory notunda `source`, `sourceRevision`, `validFrom`, opsiyonel `supersededBy`
olmalı. Kod değiştiğinde eski mimari/gotcha notları “halen doğru” varsayılmamalı.

Mevcut çalışma ağacı bunun aciliyetini gösteriyor:

- `.cockpit-memory` içinde 115 markdown notu var.
- Yalnız 31'i tracked.
- 18 tracked not modified, 84 yeni not untracked: toplam **102 dirty memory change**.
- Bazı yeni notlar aynı release içinde zaten düzeltilmiş sorunları hâlâ aktif bug
  gibi anlatıyor. Örneğin `council-crash-silent-data-loss.md` pending-session fix'i
  zaten kodda olmasına rağmen açık sorun diliyle yazılmış.

Charter kaliteyi artırmış, fakat tek başına freshness çözmüyor.

### P1.6 — Memory git gürültüsünü source git'ten ayır

Memory kaynak gerçeği olarak markdown kalabilir; bunu değiştirmeyi önermiyorum.
Fakat yüzlerce otomatik not değişikliği normal `git status`u kapladığında cockpiT'in
“Git confidence” vaadi kendi memory sistemi tarafından zayıflatılıyor.

Üç seçenek:

1. `.cockpit-memory` için ayrı sidecar git repo/ref — benim tercihim.
2. Uygulama tarafından otomatik, ayrı author ile düzenli memory-only commit lane.
3. Source repo'da kalacaksa UI'da source diff / memory diff tamamen ayrılmalı ve
   release staging memory churn'ünü varsayılan olarak dışlamalı.

Memory hiçbir zaman feature commit'ine kazara karışmamalı. Bunun için “memory
working tree health” ayrı bir gösterge olmalı.

### P1.7 — Tek bir capability/action policy registry oluştur

Şu an approval action type'ları, router tavsiyeleri, IPC guarded handler'ları,
Hermes tool allowlist'i ve proje safety config'i farklı dosyalarda yaşıyor.
Örnek drift: default project config `git_push` için approval istiyor, fakat ürün
sözleşmesi normal push'ı doğrudan çalıştırıyor; yalnız force-push guarded.

Tek registry şu bilgileri taşımalı:

```text
action id
read/write/destructive
allowed actors
approval strength
executor
redaction policy
audit schema
availability
```

IPC, MCP, UI ve router bu registry'den türemeli. Böylece yeni Railway mutation
geldiğinde dört yerde unutulmaz.

### P1.8 — Local data lifecycle, backup ve restore ekle

SQLite tablolarının çoğu append-only veya read-limitli; fakat log, audit, usage,
sentinel ve Council için genel retention/prune politikası yok. `LIMIT 200` okumayı
sınırlar, database büyümesini sınırlandırmaz.

Gerekli minimum:

- DB size ve table cardinality health ekranı.
- Age/size bazlı retention; audit ve outcome için farklı politika.
- WAL-safe backup.
- Export/import.
- Migration öncesi otomatik backup ve migration sonrası integrity check.
- “Reset app data” için açık kapsam; project dosyalarına dokunmama garantisi.

Kullanıcının yıllarca bu sisteme güvenmesi için memory kadar restore hikâyesi de
güçlü olmalı.

## P2 — kalite, bakım ve UX tavsiyeleri

### P2.1 — Living roadmap sayısını azalt

`cockpit-VISION.md`, `system-roadmap.md`, `BRIDGESPACE-ROADMAP.md` ve feature planları
arasında status drift var. Örneğin BridgeSpace üç büyük feature'ı hâlâ TODO
gösterirken master vision bunları shipped gösteriyor; system roadmap coverage/E2E
gate'ini completed sayıyor ama workflow bunu yapmıyor.

Öneri:

- Bir tane canonical `CURRENT-ROADMAP.md`.
- Eski roadmap'ler `docs/archive/` altında immutable historical record.
- Status mümkünse koddan/CI'dan üretilsin: test count, migration version, current
  release, open live drill.
- `[x]` yalnız executable evidence linkiyle kullanılmalı.

### P2.2 — Büyük orchestration dosyalarını bounded context'e böl

Özellikle:

- `SwarmService.ts`: ~1030 satır.
- `Services.ts`: ~655 satır ve yoğun composition/wiring.
- `src/lib/mock.ts`: ~1428 satır.
- `shared/ipc.ts`: ~747 satır.
- CSS toplamında hâlâ birkaç bin satırlık feature dosyaları var.

Swarm için doğal ayrım:

- `CardRepository`
- `SwarmOrchestrator`
- `WorkerEngineAdapter`
- `WorktreeIsolation`
- `PipelineRunner`
- `Completion/IntegrationService`
- `OutcomeRecorder`

Mock da elle yazılmış ikinci backend olmaktan çıkıp shared scenario factory +
contract fixtures kullanmalı. Mevcut parity test iyi, fakat 1400 satırlık mock
uzun vadede ayrı ürün gibi bakım ister.

### P2.3 — Coverage kuyruğunu riske göre kapat

Toplam coverage iyi; core pure logic çok iyi. Düşük kalan side-effect servisleri:

- `AgentUsageService`: yaklaşık %11 line.
- `RailwayService`: yaklaşık %14.
- `railwayCli.ts`: yaklaşık %9.
- `AppScreenshotService`: yaklaşık %22.
- `GitHubService`: yaklaşık %25.
- `ClaudeSessionsService`: yaklaşık %12.
- `ProjectService`: yaklaşık %14.
- `LogIntelligenceService`: yaklaşık %58.

Sırf oran artırmak için test yazmayın. Önce process/network/filesystem sınırlarında
fake adapter kurun; timeout, malformed output, partial failure, cancellation ve
shutdown testleri ekleyin.

### P2.4 — Global uncaught handler'ı kontrollü recovery'ye çevir

Main process bütün `uncaughtException` ve `unhandledRejection` olaylarını loglayıp
çalışmaya devam ediyor. Background sweep'in uygulamayı kapatmaması doğru niyet;
fakat gerçek uncaught exception sonrası process state güvenilir olmayabilir.

Tercih:

- Background servislerinde lokal error boundary.
- Fatal main error'da crash report + kullanıcıya recovery ekranı + kontrollü
  relaunch.
- “degraded subsystem” state'i: Memory sweep bozuksa app açık kalsın ama Memory
  health bunu göstersin.

### P2.5 — Dashboard'u command queue gibi davranacak şekilde sadeleştir

Görsel kimlik güçlü; ember/glacier ayrımı ve “Molten Obsidian” sahiplenilebilir.
Sorun estetik değil, eşzamanlı dikkat noktası sayısı.

Mevcut mock dashboard'ta aynı anda hero, approval, dört metric card, recent errors,
activity ve üç toast görülüyor. Sağ alt toast stack ana içeriği kapatıyor.

Öneri:

- Üstte yalnız bir “Next best action”.
- Approval > failed worker > security/update > informational şeklinde sabit
  attention priority.
- Aynı source/fingerprint toast'larını collapse et.
- Toast maksimum 1–2 görünür; geri kalanı Sentinel inbox'a.
- Hero launch düğmeleri proje sağlıklı ve action queue boşken baskın olsun.
- Mock seed “her feature aynı anda” yerine normal/sakin state'i varsayılan yapsın;
  stress state ayrı story olsun.

### P2.6 — Bundle ve startup bütçesi koy

Production renderer build yaklaşık:

- JS: 1.325 MB
- CSS: 343 KB

Electron local app için web kadar kritik değil; yine de tüm paneller başlangıç
bundle'ında. Panel-level lazy loading, ağır graph/council yüzeylerini split etmek ve
startup instrumentation faydalı olur. Önce ölçün: app ready, first paint, interactive,
DB migration, MCP ready ve first terminal spawn süreleri.

### P2.7 — Portable project config ve onboarding doctor

Tracked `.dev-cockpit/project.json` şu an eski bir absolute path içeriyor:
`/Users/mustafaboyraz/Projects/baz-cockpit`; gerçek repo başka yerde. Config'in DB
project path'inden ayrı absolute path tutması portability ve debug karmaşası.

- Absolute project path runtime'da DB'den gelmeli veya select sırasında normalize
  edilmeli.
- Repo içinde `project.example.json` tutulabilir; machine-specific gerçek config
  ignore edilebilir.
- “Doctor” ekranı: Claude/Codex/Hermes/gh/railway availability, auth, MCP, shell
  integration, native ABI, git worktree, safeStorage, DB integrity, updater/signing.
- Her kırmızı kontrol tek bir actionable fix göstermeli.

## Release ve dağıtım tavsiyeleri

### Mevcut güçlü yanlar

- CI-only publish kuralı doğru.
- Aynı run metadata + asset ilkesi doğru.
- `v0.2.1` release asset seti eksiksiz.
- Signature identity doğrulaması build'i fail ettirebiliyor.
- Updater blockmap/metadata mevcut.

### Açık riskler

- Dış kullanıcı için Apple Developer ID + notarization + hardened runtime zorunlu
  hale gelmeli. Self-signed + quarantine strip yalnız kişisel beta yolu.
- Manual install script GitHub ZIP'ini indirip kuruyor; release metadata/digest
  doğrulaması açıkça yapılmalı.
- Yalnız macOS arm64 asset var. İlk müşteri segmenti macOS Apple Silicon olabilir;
  hemen her platformu açmak şart değil, fakat ürün sayfası bunu dürüst söylemeli.
- Çok sık stable tag çıkarılıyor. Canary/beta/stable channel ayrımı, release
  notes, rollback ve data migration notları eklenmeli.
- GitHub Actions third-party action referanslarını SHA ile pinlemek supply-chain
  sertleştirmesi olur.

## Para kazanma stratejisi

### Önce doğru kategori adı

cockpiT'i “AI IDE”, “terminal” veya “Claude/Codex launcher” diye satmayın. Bunlar
kolayca commodity olur. En güçlü ifade:

> **Local-first AI engineering control plane:** birden fazla coding agent'ını
> spec, izolasyon, onay, hafıza, maliyet ve outcome kanıtıyla yöneten cockpit.

Müşteri “başka bir chat kutusu” değil, şu sonuçları satın alır:

- Agent ne yaptı biliyorum.
- Projeler birbirine karışmıyor.
- Yanlış değişiklik main'e sessiz girmiyor.
- Claude kotası bitince iş körleşmiyor.
- Aynı hatayı ikinci kez öğretmiyorum.
- Hangi agent/workflow para ve zaman kazandırıyor görebiliyorum.

### Tavsiye ettiğim gelir sırası

#### 1. cockpiT ile para kazandıran ürünler üret

İlk para cockpiT lisansından gelmek zorunda değil. Sistemi kullanarak 2–3 küçük,
gerçek ödeme alan ürün veya hizmet üret. Her birinde ölç:

- idea → first paid user süresi,
- accepted card başına LLM maliyeti,
- rework oranı,
- production bug/revert,
- insan review süresi,
- reusable memory sayısı ve tekrar kullanım değeri.

Bu hem gelir üretir hem cockpiT'in gerçek satış kanıtını oluşturur.

#### 2. Service-assisted beta

İkinci adımda 5–10 ciddi solo builder/agency kullanıcısına yalnız uygulama verme;
kurulum ve workflow design hizmetiyle beraber ver. Onlardan feature listesi değil,
hangi noktada güvenlerinin kırıldığını öğren.

İlk wedge için en uygun segment bence:

- aynı anda birkaç client/proje yöneten macOS solo developer,
- küçük product studio/agency,
- Claude + Codex aboneliği zaten olan power user.

Bu kullanıcılar quota, context switching, dirty worktree, review ve memory acısını
gerçekten yaşıyor.

#### 3. Ürün lisansı

İlk ticari paket hipotezi:

- Local desktop app.
- BYO Claude/Codex/OpenRouter accounts.
- Tek kullanıcı, çok proje.
- Ücretin karşılığı model tokenı değil; orchestration, safety, memory ve evidence.

Fiyatı bugün sabitlemek yerine 10 design-partner görüşmesinde willingness-to-pay
test edin. Early access için bir defalık ücret + yıllık update veya aylık founder
planı denenebilir. Takım collaboration/cloud sync'i ilk paket için şart değil.

#### 4. Team/agency moat

Sonraki ücretli katman:

- shared policy packs,
- review/approval roles,
- organization memory with provenance,
- audit export,
- workflow templates,
- per-project cost/outcome comparison,
- remote task intake.

Cloud'a taşınması gereken şey önce source code değil; policy, encrypted metadata,
license ve seçilmiş collaboration state olabilir. Local-first güven vaadini bozmayın.

### Şimdilik yapılmaması gerekenler

- Her LLM sağlayıcısını eklemek.
- Genel amaçlı günlük yaşam Jarvis'i ile coding ürününü aynı anda büyütmek.
- Windows/Linux/macOS Intel'i product-market fit'ten önce eşzamanlı açmak.
- Railway mutation veya autonomous deploy'u trust chain tamamlanmadan açmak.
- Outcome kanıtı olmadan “AI kendi kendini geliştiriyor” iddiası.
- Yalnız panel/animasyon ekleyerek premium hissi artırmaya çalışmak.

## Önerdiğim uygulama sırası

### İlk 7 gün — trust reset

1. Electron/toolchain upgrade planı ve compatibility spike.
2. Coverage + mock E2E'yi CI release gate'e bağla.
3. Packaged-app smoke oluştur.
4. Worktree fallback'i fail-closed yap.
5. Council approval spec hash binding tasarımı.
6. Memory dirty/stale backlog için bir defalık audit; source git ile memory git
   ayrım kararını ver.

### Sonraki 2–3 hafta — evidence loop

1. Card lifecycle'ı completed/accepted/integrated/released olarak ayır.
2. Commit SHA + diff hash + check evidence kaydet.
3. Pipeline step artifact handoff'u getir.
4. Prompt/engine/memory provenance versioning ekle.
5. Outcome scorecard'ı gerçek Git/release kanıtıyla yeniden tanımla.

### Sonraki 30–60 gün — engine ve ürünleşme

1. Claude/Codex worker adapter ortak interface.
2. Explicit engine selection/fallback consent.
3. Unified transcript/artifact event model.
4. Doctor, backup/restore, DB retention.
5. Signed/notarized beta distribution.
6. 5–10 design partner ile onboarding.

### 60–90 gün — gelir deneyi

1. cockpiT ile üretilmiş ilk ücretli microproduct/service.
2. Cycle-time/cost/rework case study.
3. Paid private beta.
4. Tek bir ICP ve tek positioning sayfası.
5. Kullanım verisine göre lisans modeli; tahmine göre değil.

## Başarı metrikleri

Vanity metric yerine şu metrikleri ana dashboard/scorecard için öneriyorum:

- Median idea → integrated commit.
- Accepted card başına insan aktif süresi.
- Accepted card başına model maliyeti.
- First-pass acceptance rate.
- 7 ve 30 gün içinde rework/revert oranı.
- Spec-gated vs skipped kartlarda failure farkı.
- Council'ın sorduğu clarification'lardan gerçekten scope değiştirenlerin oranı.
- Memory recall sonrası tekrar kullanılan not oranı.
- Stale/superseded memory oranı.
- Isolation fallback sayısı — hedef sıfır.
- Agent/provider bazında cost-adjusted accepted outcome.
- Release gate kaçışları: CI yeşil olup packaged smoke kırılan build sayısı.

## Korunması gereken kararlar

Şunları yeniden yazmayın; bunlar doğru omurga:

- Renderer'ın yetkisiz, main'in capability owner olması.
- Typed/narrow preload bridge.
- Shared pure logic + Zod boundary validation.
- Secret'ın renderer'a geri dönmemesi.
- MCP'nin raw shell/filesystem vermemesi.
- Human-requested action ile self-initiated proposal ayrımı.
- Worktree isolation fikri.
- Memory'nin local-first ve provenance-ledgered olması.
- Council input'larının untrusted data olarak fence edilmesi.
- CI-only release publishing ve same-run metadata/assets kuralı.
- Molten Obsidian görsel kimliği.

## Son söz

cockpiT'in değerli olacağı yer “agent daha güzel kod yazdı” değil. Modeller sürekli
değişecek ve birbirini yakalayacak. Kalıcı değer şu sistemde:

1. Doğru işi doğru engine'e vermek.
2. İşi izole ve geri alınabilir yürütmek.
3. Agent'lar arasında kayıpsız handoff yapmak.
4. İnsan kararını doğru yerde tutmak.
5. Sonucu commit/release kanıtıyla ölçmek.
6. Öğrenileni güncel ve güvenilir hafızaya çevirmek.

Bu altı madde tamamlandığında cockpiT gerçekten normal terminal + normal LLM'in
ötesine geçer. En yakın büyük hedefim “daha autonomous” değil, **daha kanıtlı
autonomy** olurdu. Güvenilir autonomy kurulduğunda hem kendi ürünlerini daha hızlı
çıkarırsın hem cockpiT'in kendisi satılabilir bir ürüne dönüşür.
