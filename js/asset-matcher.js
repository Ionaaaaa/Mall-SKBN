'use strict';
/*
  asset-matcher.js
  ------------------------------------------------------------
  工單裡 LOGO/曝品/素材 欄位寫的是「人看得懂的檔名/代碼」，不是真的檔案路徑。
  這支負責把這些文字，比對成真的圖檔來源，順序固定：

    1. 先比對「這批上傳資料夾」(BatchAssets，這週的素材zip)
    2. 再比對「資料庫」(data/asset-library.json，跨檔期重複使用的固定素材，
       例如常用LOGO、券樣模板)
    3. 兩邊都沒有 → 回傳 unmatched，呼叫端負責收集警示、不會讓其他格卡住

  中間版位常見的「檔期內建LOGO」(例如 10.10品牌週年慶\01_LOGO) 跟一般品牌LOGO
  是兩條不同的比對路徑：只要文字裡有路徑分隔符號(\ 或 /)，就直接當「內建代碼」
  只查資料庫的 matchKeys，不會去這批資料夾裡找檔名——因為這批資料夾放的是
  這週的商品/品牌LOGO，本來就不會有檔期活動的固定版面素材。

  「素材」類型（曝品欄位='素材'，例如商城券*1/商城券*2/免運車）也是只查資料庫，
  用 matchType 精準比對，不走模糊檔名比對——這些是固定圖庫，不是每週會變的
  上傳檔案。
*/
var AssetMatcher = (function(){

  // 全形英數字轉半形，避免「LOGＯ」這種全形字母比對不到「LOGO」
  function toHalfWidth(s){
    return String(s||'').replace(/[\uFF01-\uFF5E]/g, function(ch){
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
  }

  function normKey(s){
    return toHalfWidth(s).replace(/\\/g,'/').replace(/\s+/g,'').toLowerCase();
  }

  // 去掉像「（請使用上方橘字版）」這種夾在檔名前面的操作備註文字
  function stripInstructionNote(s){
    return String(s||'').replace(/^[（(][^）)]*[）)]\s*/, '').trim();
  }

  /* 工單LOGO欄寫「無」或只寫一個橫線(-、－、—、–…，全形半形都算)，都代表
     「這一格不需要放LOGO」。2026-10：原本只認「無」，寫「-」會被當成一般
     文字去比對——LOGO欄比對不到就退回看檔期欄，結果檔期欄剛好是資料庫裡有
     的名字(例如蝦皮直營)時，會自己帶一張LOGO進去。 */
  function isNoLogoMark(raw){
    var s = toHalfWidth(raw).replace(/\s+/g, '');
    return s === '無' || /^[-\u2010-\u2015\u2212\u2500\u30FC\uFE58\uFE63]+$/.test(s);
  }

  function isBuiltinRef(raw){
    return /[\\\/]/.test(String(raw||''));
  }

  /* 資料庫LOGO清單攤平：[{id,brand,name,path,matchKeys,categoryLabel}] */
  function flattenLogos(){
    return (typeof AssetLibrary !== 'undefined') ? AssetLibrary.systemElements('logo') : [];
  }
  function flattenArtwork(){
    return (typeof AssetLibrary !== 'undefined') ? AssetLibrary.artwork() : [];
  }

  /* 依 brand 文字模糊比對資料庫清單(logo或artwork通用)，抓 brand 或 name
     欄位裡有包含關係的，回傳第一個。找不到回傳 null。 */
  function findByBrandText(list, brandText){
    if(!brandText) return null;
    var nb = normKey(brandText);
    if(!nb) return null;
    var hit = list.find(function(it){
      var ni = normKey(it.brand||'');
      return ni && (nb.indexOf(ni) >= 0 || ni.indexOf(nb) >= 0);
    });
    return hit || null;
  }

  /* ── 2026-10：LOGO比對改成「挑最符合的一筆」────────────────
     原本的 findByBrandText/findByMatchKeys/findByKeyInText 都是「清單裡第一個
     有包含關係的就回傳」，會有兩個問題：
       (a) 短的搶走長的：工單寫「蝦皮直營3C家電」會先中「蝦皮直營」；日期類
           關鍵字更明顯，「11.11」裡面就包含「1.11」，誰排前面誰贏。
       (b) 沒有數字邊界：「2.2」會誤中「12.2x」「2.25」。
     bestLogoMatch 把清單每一筆都算一個比對等級，回傳等級最高的那一筆：
       完全相等  >  工單文字包含關鍵字(關鍵字越長越準)  >  關鍵字包含工單文字
       >  模糊比對(差一兩個字，見下面fuzzyDistance)
     前兩個等級同分才看清單順序；後兩個等級同分當成比對不到(見bestLogoMatch)。
     findByBrandText 還留著給 matchProduct 用，邏輯沒動。 */
  function isDigitCh(ch){ return ch >= '0' && ch <= '9'; }

  /* needle 出現在 hay 的 idx 位置時，確認不是「切在一串數字/日期中間」：
     needle 開頭是數字 → 前一個字不能是數字，也不能是「數字+小數點」
     needle 結尾是數字 → 後一個字不能是數字，也不能是「小數點+數字」
     所以「1.11」不會中「11.11」、「2.2」不會中「12.2」「2.25」，但
     「2.2購物節」「2.2.png」「2.2/01_LOGO」這種照樣比對得到。 */
  function digitBoundaryOk(hay, idx, needle){
    var len = needle.length;
    if(isDigitCh(needle.charAt(0))){
      var p1 = hay.charAt(idx-1), p2 = hay.charAt(idx-2);
      if(isDigitCh(p1) || (p1 === '.' && isDigitCh(p2))) return false;
    }
    if(isDigitCh(needle.charAt(len-1))){
      var n1 = hay.charAt(idx+len), n2 = hay.charAt(idx+len+1);
      if(isDigitCh(n1) || (n1 === '.' && isDigitCh(n2))) return false;
    }
    return true;
  }

  function containsWithBoundary(hay, needle){
    if(!hay || !needle) return false;
    var from = 0, idx;
    while((idx = hay.indexOf(needle, from)) >= 0){
      if(digitBoundaryOk(hay, idx, needle)) return true;
      from = idx + 1;
    }
    return false;
  }

  /* ── 模糊比對（容錯字）────────────────────────────────────
     工單不一定會打得跟資料庫一模一樣（「蝦皮寵物節」其實是「蝦皮寵物展」、
     「從齒完美」其實是「從齒玩美」、「時尚周」/「時尚週」），所以在完全相等／
     包含都比對不到之後，再補一層「差一兩個字也算」的比對：
       候選字串 4～7 個字 → 容許差 1 個字（打錯、多打、少打都算）
       候選字串 8 個字以上 → 容許差 2 個字
       候選字串 3 個字以下 → 不做（太短，差一個字就可能是另一個活動）
       候選字串裡有數字 → 不做（「2.2購物節」跟「3.3購物節」只差一個字，
                            但是完全不同的檔期，日期一定要打對）
     比對時是拿工單文字裡「長度差不多的一小段」去比，所以前後多寫了
     「_LOGO」之類的字也沒關係。 */
  function fuzzyAllowance(len){ return len >= 8 ? 2 : (len >= 4 ? 1 : 0); }

  /* 兩段文字的編輯距離（改一個字/多一個字/少一個字各算1），超過max就不用
     算得很精確，直接回傳max+1。 */
  function editDistance(a, b, max){
    var la = a.length, lb = b.length;
    if(Math.abs(la - lb) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for(j = 0; j <= lb; j++) prev[j] = j;
    for(i = 1; i <= la; i++){
      cur[0] = i;
      var rowMin = cur[0];
      for(j = 1; j <= lb; j++){
        var cost = a.charAt(i-1) === b.charAt(j-1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + cost);
        if(cur[j] < rowMin) rowMin = cur[j];
      }
      if(rowMin > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  /* 工單文字 nt 裡有沒有一段跟 nk 只差一兩個字。回傳差幾個字，沒有就回傳-1。 */
  function fuzzyDistance(nt, nk){
    var allow = fuzzyAllowance(nk.length);
    if(!allow || /[0-9]/.test(nk)) return -1;
    var best = allow + 1;
    for(var wl = nk.length - allow; wl <= nk.length + allow; wl++){
      if(wl < 1 || wl > nt.length) continue;
      for(var i = 0; i + wl <= nt.length; i++){
        var d = editDistance(nt.substr(i, wl), nk, allow);
        if(d < best) best = d;
      }
    }
    return best <= allow ? best : -1;
  }

  /* 比對等級（數字越大越可信）：
       3 完全相等
       2 工單文字包含候選字串（候選字串越長越準）
       1 候選字串包含工單文字（工單只寫一部分，例如「婦幼展」→「蝦皮婦幼展」）
       0 模糊比對（差一兩個字）
     回傳 {tier, value}，沒中回傳 null。value 只在同一個等級裡互相比較。 */
  function scoreCandidate(nt, cand, allowReverse, allowFuzzy){
    var nk = normKey(cand);
    if(!nk) return null;
    if(nk === nt) return { tier:3, value:nk.length };
    if(containsWithBoundary(nt, nk)) return { tier:2, value:nk.length };
    if(allowReverse && nt.length >= 2 && containsWithBoundary(nk, nt)) return { tier:1, value:0 };
    if(allowFuzzy){
      var d = fuzzyDistance(nt, nk);
      if(d >= 0) return { tier:0, value:-d };
    }
    return null;
  }

  function betterScore(a, b){
    if(!b) return true;
    return a.tier > b.tier || (a.tier === b.tier && a.value > b.value);
  }

  /* opts:
       useBrand     —— 要不要拿 brand 欄位當候選字串
       reverseBrand —— brand 要不要接受「候選字串包含工單文字」這個方向
       reverseKeys  —— matchKeys 要不要接受這個方向。一般LOGO文字不開，避免
                       工單只寫很短的字(例如"logo")就誤中「OOTD_LOGO」這類
                       關鍵字；內建代碼(有\\或/)才開，維持原本的雙向行為。
       fuzzy        —— 要不要開模糊比對（差一兩個字也算）

     等級1、0是「猜」的，所以多一個限制：同一個等級如果有兩筆以上不同的
     LOGO都符合（例如只寫「年貨節」，美食年貨節/居家年貨節都中；只寫
     「家電祭」，涼夏/狂購都中），就當成比對不到、列進警示讓人手動選，
     不要自己挑一張帶進去——帶錯圖比沒帶圖更難發現。 */
  function bestLogoMatch(list, text, opts){
    var nt = normKey(text);
    if(!nt) return null;
    var best = null, bestScore = null, sameLevelCount = 0;
    list.forEach(function(it){
      var s = null;
      function consider(c){ if(c && betterScore(c, s)) s = c; }
      if(opts.useBrand && it.brand) consider(scoreCandidate(nt, it.brand, opts.reverseBrand, opts.fuzzy));
      (it.matchKeys||[]).forEach(function(k){
        consider(scoreCandidate(nt, k, opts.reverseKeys, opts.fuzzy));
      });
      if(!s) return;
      if(betterScore(s, bestScore)){ best = it; bestScore = s; sameLevelCount = 1; }
      else if(s.tier === bestScore.tier && s.value === bestScore.value) sameLevelCount++;
    });
    if(best && bestScore.tier <= 1 && sameLevelCount > 1) return null;
    return best;
  }

  /* 從這批資料夾裡，依標準化檔名比對，回傳最合適的一個檔案(dataUrl)。
     同名多副檔名（例如 .jpg/.png 都有）時：raw裡有明確寫副檔名就優先選
     那個；沒寫的話優先選 .png（LOGO/去背場景比較常見、透明背景比較安全）。*/
  function pickBestBatchFile(rawName, candidates){
    if(candidates.length === 1) return candidates[0];
    var wantExt = (String(rawName).match(/\.([a-zA-Z0-9]+)$/)||[,''])[1].toLowerCase();
    if(wantExt){
      var exact = candidates.find(function(c){ return c.ext === wantExt || (wantExt==='jpg'&&c.ext==='jpeg'); });
      if(exact) return exact;
    }
    var png = candidates.find(function(c){ return c.ext === 'png'; });
    return png || candidates[0];
  }

  /* 資料庫LOGO的專屬色票（背景色+文字色）。一個LOGO可以有多組：json裡寫
     "presetColors": [{ "bg":"#fd5401", "text":"#f9ff39" }, ...]（例如限時特賣
     有橘/藍/紅三組）；只有一組的老寫法 presetBgColor/presetTextColor 也吃得
     下，會被當成只有一組。回傳統一格式：presetColors是完整清單，
     presetBgColor/presetTextColor是第一組（沒有Excel指定背景色時的預設）。 */
  function logoPresetFields(it){
    var list = (Array.isArray(it.presetColors) && it.presetColors.length)
      ? it.presetColors
      : (it.presetBgColor ? [{ bg: it.presetBgColor, text: it.presetTextColor }] : []);
    return {
      presetColors: list,
      presetBgColor: list.length ? list[0].bg : undefined,
      presetTextColor: list.length ? list[0].text : undefined,
      categoryKey: it.categoryKey,
      // 2026-09：資料庫LOGO預設都是「原圖直接放」(logoMode:'original')，不會
      // 加裁切+底色的膠囊色塊——因為資料庫裡的LOGO本來就是做好的固定素材，
      // 不像使用者自己上傳的照片常常四周有雜亂留白需要裁切。但少數LOGO
      // (例如品牌會員)本身圖檔比例跟版位的LOGO框不一樣，需要用裁切+底色
      // 的膠囊模式包起來才好看，這種在json裡登記forceTrimMode:true，
      // 不管是Excel匯入自動比對到、還是使用者自己手動瀏覽資料庫選到，都會
      // 直接套用trim模式（含自動底色偵測，見modules/logo-module.js）。
      forceTrimMode: !!it.forceTrimMode,
      // 2026-10：這張LOGO固定用原本的顏色，匯入時不要自動開「強制白色」。
      // 給本身就是做好黑白/彩色配置、反白之後會壞掉的LOGO用（例如蝦皮時尚週：
      // 白底黑字+黑底白字兩塊拼起來，白色那塊是實心的，強制白色會變成一整塊
      // 白色剪影、字看不到）。json裡登記keepOriginalColor:true，見
      // editor-import.js的applyLogoWhiteAuto。使用者事後在放大編輯面板手動
      // 切換強制白色不受這個限制。
      keepOriginalColor: !!it.keepOriginalColor
    };
  }

  /* ── LOGO ──────────────────────────────────────────────── */
  function matchLogo(rawLogoValue, brandText){
    var raw = String(rawLogoValue||'').trim();
    if(!raw || isNoLogoMark(raw)) return { src:null, source:'none' };

    if(isBuiltinRef(raw)){
      var lib = bestLogoMatch(flattenLogos(), raw, { useBrand:false, reverseKeys:true });
      if(lib) return Object.assign({ src: lib.path, source:'database', note:null }, logoPresetFields(lib));
      return { src:null, source:'unmatched', note:'內建LOGO代碼「'+raw+'」資料庫裡還沒有登記，需要手動上傳或補資料庫' };
    }

    var cleaned = stripInstructionNote(raw);
    var norm = BatchAssets.normalizeName(cleaned);
    var candidates = BatchAssets.findAllByNormalized(norm);
    if(candidates.length){
      var best = pickBestBatchFile(cleaned, candidates);
      return { src: best.dataUrl, source:'batch', note:null };
    }

    // 2026-10：查資料庫的順序改成「先看LOGO欄寫的文字，比對不到才退回看檔期欄
    // (brandText)」。原本是檔期欄優先，工單檔期欄寫「蝦皮直營」、LOGO欄寫
    // 「Apple授權經銷商」時，會先中蝦皮直營、LOGO欄根本沒被看到——LOGO欄才是
    // 「這一格要放哪張LOGO」的直接指示，應該優先。
    // 每一段文字都用bestLogoMatch挑最符合的一筆：brand雙向、matchKeys只看
    // 「文字包含關鍵字」單一方向（例如工單寫 Watsons，靠matchKeys裡登記的
    // "Watsons"比對到屈臣氏；不開反方向，避免工單只寫很短的字就誤中一堆）。
    // 模糊比對(差一兩個字，fuzzy:true)只用在LOGO欄，而且排在最後：LOGO欄、
    // 檔期欄都沒有明確比對到，才回頭用LOGO欄的文字猜。檔期欄不做模糊比對
    // ——它只是備援線索，拿它去猜容易把不相干的活動帶進來。
    var logos = flattenLogos();
    var dbOpts = { useBrand:true, reverseBrand:true, reverseKeys:false };
    var fuzzyOpts = { useBrand:true, reverseBrand:true, reverseKeys:false, fuzzy:true };
    var dbHit = bestLogoMatch(logos, cleaned, dbOpts) || bestLogoMatch(logos, brandText, dbOpts)
      || bestLogoMatch(logos, cleaned, fuzzyOpts);
    if(dbHit) return Object.assign({ src: dbHit.path, source:'database', note:null }, logoPresetFields(dbHit));

    return { src:null, source:'unmatched', note:'LOGO「'+raw+'」在這批資料夾跟資料庫都比對不到，需要手動上傳或選擇' };
  }

  /* ── 商品（曝品=商品）───────────────────────────────────── */
  function matchProduct(artContent, brandText){
    var raw = String(artContent||'').trim();
    if(!raw || raw === '無') return { src:null, source:'none' };

    // 2026-10：商品這一格的「/」不當成資料夾路徑。工單常把日期寫進檔名
    // （例如 10/24_Fashion-時尚週_換季限時瘋搶），但Windows檔名不能有「/」，
    // 丟圖區的實際檔案會存成「10 24_…」；normalizeName看到「/」會當成路徑、
    // 只留斜線後面那段，前面的「10」被丟掉就比對不到。這裡先把「/」(全形
    // 「／」也算)換成空白再標準化，空白本來就會被去掉，兩邊就一致了。
    // 只改商品這一格：LOGO欄的「/」「\」是內建代碼(見isBuiltinRef)，不能動。
    // 比對不到時再退回原本「當成路徑、只看最後一段」的做法，工單真的寫了
    // 「子資料夾/檔名」的情況照舊比對得到。
    var candidates = BatchAssets.findAllByNormalized(BatchAssets.normalizeName(raw.replace(/[\/\uFF0F]/g, ' ')));
    if(!candidates.length) candidates = BatchAssets.findAllByNormalized(BatchAssets.normalizeName(raw));
    if(candidates.length){
      var best = pickBestBatchFile(raw, candidates);
      return { src: best.dataUrl, source:'batch', note:null };
    }

    var dbHit = findByBrandText(flattenArtwork(), brandText);
    if(dbHit) return { src: dbHit.path, source:'database', note:null };

    return { src:null, source:'unmatched', note:'商品圖「'+raw+'」在這批資料夾跟資料庫都比對不到，需要手動上傳或選擇' };
  }

  /* ── 素材（曝品=素材，例如商城券*1/商城券*2/免運車）─────────
     只查資料庫的 matchType，精準比對（這些是固定圖庫，不是每週上傳檔）。*/
  function matchMaterial(materialType){
    var raw = String(materialType||'').trim();
    if(!raw || raw === '無') return { src:null, source:'none', hasText:false };

    var hit = flattenArtwork().find(function(it){ return it.matchType === raw; });
    // presetColor：這個素材專屬對應的背景色+文字色（例如限時特賣-黃/藍/紅），
    // 匯入時Excel沒指定背景色就自動套用，見editor-import.js的applyAutoBackground
    if(hit) return { src: hit.path, source:'database', hasText: !!hit.hasText, presetColor: hit.presetColor || null, note:null };

    return { src:null, source:'unmatched', hasText:false, note:'素材「'+raw+'」資料庫裡還沒有登記對應圖檔，需要手動上傳或補資料庫' };
  }

  return {
    normKey: normKey,
    isBuiltinRef: isBuiltinRef,
    isNoLogoMark: isNoLogoMark,
    matchLogo: matchLogo,
    logoPresetFields: logoPresetFields,
    matchProduct: matchProduct,
    matchMaterial: matchMaterial
  };
})();
