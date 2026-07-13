# cockpiT v0.2.1 — Canlı Test Bulguları: 5 Sorunun Kök Çözümü

Analizin bitti; şimdi kaldığımız yer burası. Az önce v0.2.1 release edildi
(son commit 09dbc51). Canlı testte 5 sorun çıktı. Hepsini kök nedenden çöz —
semptom bandajı değil. Başlamadan CLAUDE.md'yi (çalışma sözleşmesi),
docs/DESIGN.md'yi (tasarım kuralları) ve docs/plans/system-roadmap.md'nin
progress log'unu oku.

## Kurallar (ihlal etme)

- Kapılar her işten sonra ham exit-code ile yeşil olacak: `npm run typecheck`,
  `npm run lint` (0 uyarı), `npm test` (taban: 1130 test), `npx playwright test`
  (5/5). IPC'ye kanal eklersen dört bacak zorunlu (shared/ipc.ts + registerIpc
  + preload + src/lib/mock.ts) — test/ipc-contract.test.ts bunu zorlar.
- UI işi: `npm run build` → `node serve.mjs` → `node screenshot.mjs
  http://localhost:3000 <etiket>` → PNG'yi geri oku → en az 2 tur pixel-inceleme.
  Molten Obsidian: ember/copper accent, transition-all YASAK, sadece
  transform/opacity animasyonu, her interaktif öğede hover/focus-visible/active.
- Conventional commits ile küçük mantıklı commit'ler at; PUSH ETME — release'i
  Baz yapar. Dosyalar <800 satır, immutable güncellemeler, IPC sınırında Zod.

## Sorun 1 — Hermes MCP bağlantısı kopuk (EN KRİTİK)

Semptom (birebir): Hermes chat'te "MCP cockpit sunucusu şu an unreachable
(ard arda 3 hata aldı, ~45 saniye içinde otomatik dener). O yüzden
get_git_status ve memory tool'ları çalışmıyor."

Bağlam: v0.2.1'de iki değişiklik yapıldı — (a) HermesChatService.ts'te
`HERMES_CHAT_TOOLS = ['-t', 'memory,skills,cockpit']` (bu ÇALIŞTI: hermes artık
araçları isimleriyle tanıyor), (b) cockpit MCP sunucusuna bearer token auth
eklendi: HermesMcpServer.ts oturum başına token üretir, Services.ts bunu thunk
ile HermesChatService'e verir, spawn'da env `COCKPIT_MCP_TOKEN` olarak geçer;
makine-yerel `~/.hermes/config.yaml`'daki cockpit MCP tanımına
`headers: Authorization: "Bearer ${COCKPIT_MCP_TOKEN}"` eklendi (hermes,
config değerlerinde ${VAR}'ı env'den genişletir — kaynak:
~/.hermes/hermes-agent/tools/mcp_tool.py `_interpolate_env_vars`).

Önce TEŞHİS, sonra düzeltme:

1. Uygulama açıkken `lsof -i :47615` — sunucu dinliyor mu? Dinlemiyorsa:
   HermesMcpServer.start() hatası Services.ts'te yutulur (boot'u bloklamasın
   diye) — start hatasını logla/sebebini bul (port çakışması?).
2. Dinliyorsa: `curl -i http://127.0.0.1:47615/mcp` → 401 mü, refused mı?
   401 + hermes "unreachable" diyorsa token akışı kırık demektir. Şüpheliler:
   env'in gerçekten spawn'a ulaşması (HermesChatService.ask'ta env merge),
   hermes tarafında ${VAR} genişletmesinin oneshot akışında config'i NE ZAMAN
   yüklediği (genişletme "secret scope"tan çözülüyor olabilir — mcp_tool.py'ı
   incele), ya da token'ın gateway/başka bir hermes süreci üzerinden gitmesi.
3. Kök neden neyse minimal ve güvenli çöz: auth'u KALDIRMA (güvenlik kararı),
   akışı düzelt. Gerekirse cockpit tarafında daha sağlam bir aktarım tasarla
   (örn. token'ı hermes'in okuyabildiği 0600 izinli bir dosyaya yazıp header'da
   ${env:...} yerine ondan çözmek gibi — hermes'in ne desteklediğine göre).

Kabul kriteri: cockpiT içindeki Hermes chat'e "Bu projenin git durumunu özetle,
hangi branch'teyiz?" yazınca GERÇEK git verisiyle cevap gelmesi (snapshot'tan
değil, get_git_status aracını çağırarak).

## Sorun 2 — Council paneli: history yerleşimi + yanlış durum göstergesi

(a) Council panelindeki HISTORY listesi compose alanının hemen altında uzun bir
liste olarak duruyor. Baz'ın istediği: history'yi panelin üstünde ayrı bir
SEKME yap, YA DA varsayılanda sadece son 3 koşuyu göster + "View all" ile
tam listeye geç. Hangisi panel diline daha oturuyorsa onu seç, gerekçele.

(b) Bug: koşu hâlâ "Convening..." durumundayken history'de aynı koşu kırmızı ✗
ile "Spec-gate deliberation · now" olarak görünüyor — status='pending' satır
"failed" gibi render ediliyor. Pending, koşan/spinner durumuyla gösterilmeli
(council_sessions V18 status kolonu: pending/final/failed).

(c) Araştır: Baz'ın önceki standalone koşuları history'de ✗ görünüyor — bunlar
gerçekten fail mi oldu (CouncilService.run seat spawn hataları?) yoksa eski
crash'lerden süpürülen pending→failed satırlar mı? Gerçek fail varsa nedenini
bul ve UI'da dürüst göster (hangi seat, ne hatası).

## Sorun 3 — Swarm gate istemi görsel olarak kırık

Start'a basınca çıkan council-gate isteminde "Convene council" butonunun metni
taşıyor/kesiliyor (buton dar, metin iki satıra kırılıp kenardan taşıyor),
inset kart içinde sıkışık duruyor. Dosyalar: src/components/swarm/SwarmCard.tsx
+ src/styles/swarm.css (gate prompt bölümü). İstemi kart diline uygun, ferah ve
taşmasız yap; dar kart genişliğinde (TO DO kolonu) screenshot ile doğrula.
Genel Swarm board'a da bir görsel geçiş yap — Baz "çok berbat görünüyor" dedi;
kart yoğunluğu/tipografi/boşluk ritmini DESIGN.md gözüyle elden geçir.

## Sorun 4 — Usage yeni tasarımı gerçek pencerede patlıyor

v0.2.1'de Usage "Engines & spend" hero'suna dönüştürüldü (motor başına modül).
Mock ekran görüntülerinde doğruydu ama Baz'ın gerçek penceresinde: halkalar dev
boyutlu, Codex modülü sağdan ekran dışına taşıyor, Hermes ikinci satırda tek
başına büyük boşlukla kalıyor. Kök: .capacity grid'inin responsive davranışı
(sabit/aşırı geniş kolonlar + ring boyutunun clamp'lenmemesi). Dosyalar:
src/panels/UsagePanel.tsx, src/components/AiSpendOverview.tsx,
src/styles/dashboard.css veya usage.css (.capacity* sınıfları).
Grid'i auto-fit/minmax ile akışkan yap, ring boyutunu clamp'le; 1280 / 1512 /
1728 / 2000px genişliklerinde screenshot alıp DÖRDÜNDE de doğrula (puppeteer
viewport'u screenshot.mjs'te ayarlanabilir mi bak, gerekirse geçici script).

## Sorun 5 — Council sonucu okunmuyor: insan için tasarla (yüksek öncelik)

Council koşusu fonksiyonel olarak doğru çalışıyor ama sonuç ekranı ham metin
duvarı: tam panel genişliğinde (~2000px) kesintisiz paragraflar, bold dışında
tipografik hiyerarşi yok, chairman analizi + verdict + refined spec + koltuk
çıktıları hepsi aynı anda dökülüyor. Baz'ın tepkisi birebir: "bunları kim
okuyacak, user friendly insan okuyacağı gibi olmalı."

Dosyalar: src/components/CouncilVerdict.tsx (+ CouncilScorecard.tsx),
src/styles/council-view.css ve verdict'in kullanıldığı yerler (CouncilPanel,
SwarmPanel kart editörü).

Yeniden tasarım ilkeleri (verdict-first, progressive disclosure):

1. En üstte NET bir karar bandı: büyük verdict chip'i (APPROVED yeşil /
   NEEDS_CLARIFICATION amber / FAILED kırmızı) + tek cümlelik "why" özeti
   (chairman verdict'inin ilk cümlesi ya da varsa yapısal özet alanı).
2. Hemen altında "Council senden ne istiyor" bölümü: NEEDS_CLARIFICATION ise
   numaralı açık soruları belirgin, taranabilir liste olarak çıkar (bu veri
   zaten çıktıda numaralı liste halinde geliyor); APPROVED ise refined spec'in
   Goal/Acceptance criteria kısmı öne çıksın.
3. Chairman'ın uzun analizi varsayılan KAPALI bir "Chairman analysis"
   accordion'ında; koltuk çıktıları (seat outputs) koltuk başına ayrı
   collapsible satırlarda (isim + engine chip + tek satır özet görünür, tıkla
   → tam metin); refined spec ayrı collapsible.
4. Okuma genişliği: uzun metin blokları max-width ~72ch ile sınırlansın
   (tam panel genişliğine yayılmasın), satır aralığı/paragraf boşluğu
   DESIGN.md tipografi ritmine göre; markdown-lite render'ında başlıklar,
   listeler ve inline code görsel olarak ayrışsın.
5. Scorecard (koltuk sıralaması) verdict'in yanında kompakt kalabilir ama
   verdict'in ÜSTÜNE çıkmasın — karar her zaman ilk görülen şey.

Doğrulama: mock'taki seed verdict'lerle build+serve+screenshot, dar (1280) ve
geniş (2000) pencerede en az 2'şer tur; "5 saniyede karar + benden ne
isteniyor'u görüyor muyum" testi.

## Bitirince

Tüm kapılar + görsel turlar yeşilse commit'leri at (push yok) ve Baz'a şu
formatta rapor ver: sorun başına kök neden → ne değişti → nasıl doğrulandı →
hangi ekran görüntüsü. Version bump/release kararını Baz verir.
