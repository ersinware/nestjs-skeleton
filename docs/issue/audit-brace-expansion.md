# Bilinen Açık: brace-expansion DoS (GHSA-mh99-v99m-4gvg) — allowlist'te

**Durum:** Bilinçli olarak allowlist'e alındı — düzeltilmedi, çünkü düzeltilebilir değil.
**Tespit:** 2026-07-27, `npm run audit` 27 high bulgu verdiğinde.
**Etki:** Yok — açık yalnızca `devDependencies` ağacından erişiliyor; çalışan servise (prod
`node_modules`) hiç girmiyor.
**Aciliyet:** Düşük — upstream `minimatch` yeni major'a geçtiğinde kendiliğinden kapanacak.

---

## 1. Sorun

`brace-expansion`, `{a,b}` gibi kalıpları açarken üretilecek kombinasyon sayısını sınırlamıyor.
Saldırgan kontrolündeki bir glob kalıbı (`{a,b}{a,b}{a,b}...`) süreci OOM ile düşürebiliyor.

- Advisory: <https://github.com/advisories/GHSA-mh99-v99m-4gvg>
- Zafiyetli aralık: `<= 5.0.7`
- **Yamalı tek sürüm: `5.0.8`** — 1.x ve 2.x hatlarına backport **yok**.

## 2. Neden `npm audit` 21 ayrı bulgu gösteriyor

Tek bir advisory, 21 farklı bağımlılık yolundan sayılıyor. Hepsinin dibinde aynı zincir var:

```
<dev aracı> → minimatch@3 / @5 / @9 → brace-expansion@1.x / @2.x
```

Erişen dev araçları: `eslint`, `@eslint/eslintrc`, `eslint-plugin-import`, `@nestjs/cli`
(→ `fork-ts-checker-webpack-plugin`), `@swc/cli`, `@stoplight/spectral-*`, `openapi-typescript`
(→ `@redocly/openapi-core`), `@rollup/plugin-commonjs`.

`npm audit --omit=dev` **0 bulgu** veriyor: prod ağacında bu zincirin hiçbir halkası yok.

## 3. Neden override ile çözülemiyor

Bariz çözüm `"overrides": { "brace-expansion": "^5.0.8" }` olurdu. **Çalışmaz — çalışan kodu bozar.**
`brace-expansion@5`'in CommonJS girişi, modülün kendisi yerine bir namespace nesnesi export ediyor:

```js
// brace-expansion@5.0.8
const be = require('brace-expansion');
typeof be; // 'object'  ← fonksiyon DEĞİL
typeof be.expand; // 'function'
```

`minimatch@3/5/9` ise modülü doğrudan çağırıyor (`braceExpand(pattern)`), yani global bir override
tüm ESLint / Nest CLI / SWC zincirini runtime'da `TypeError` ile düşürür. `minimatch`'i topluca 10.x'e
yükseltmek de aynı sınıfta bir kırılma (v10 CJS export şekli v3'ten farklı).

Bu yüzden override yalnızca **zaten uyumlu olan** tüketicilere daraltıldı:

```jsonc
// package.json
"overrides": {
    "minimatch@>=10": { "brace-expansion": "^5.0.8" }
}
```

`minimatch@10` zaten `brace-expansion@^5` bağımlısı olduğu için bu bump güvenli; 27 bulgunun 3'ünü
kapattı. Geri kalan 21'i için yamalı sürüm mevcut değil.

## 4. Alınan karar

`audit-ci.jsonc` içinde **yalnızca bu advisory** allowlist'e alındı. Bilinçli olarak
`--skip-dev` tercih **edilmedi**: o bayrak gelecekteki tüm dev-dependency açıklarına da kör kalırdı;
allowlist ise sadece bu bilinen kaydı susturur, denetimin geri kalanı çalışmaya devam eder.

Config'de `show-not-found: true` açık — allowlist girdisi artık hiçbir şeyle eşleşmediğinde audit-ci
uyarır. **O uyarı görüldüğü an bu dosya ve allowlist girdisi silinmelidir.**

## 5. Ne zaman kapanır

Yukarıdaki dev araçları `minimatch@>=10`'a (dolayısıyla `brace-expansion@^5`'e) geçtiğinde. Kontrol:

```bash
npm ls brace-expansion --all   # 5.0.8 dışında sürüm kalmamalı
npm run audit                  # allowlist "not found" uyarısı vermeli
```
