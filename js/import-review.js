'use strict';
/*
  import-review.js —— 匯入比對確認
  ------------------------------------------------------------
  匯入工單時多兩個步驟，其他流程不變：

    1. 選頁籤：Excel有好幾個頁籤時，先問要匯入哪一頁。
       預設順序：下載當下正在看的那一頁（檔案裡有記錄的話）→ 上次選的頁籤名稱
       → 最右邊那一頁。只有一頁時直接用，不會跳出來問。

    2. 比對確認：讀完工單、還沒套用之前，先檢查LOGO跟商品圖。
       全部都對得到 → 直接匯入，不會多跳視窗。
       有對不到的 → 跳出「比對確認」：左邊是缺圖的格子，右邊可以選
         - 這批上傳的圖（依子資料夾分組，名字像的排「推薦」）
         - LOGO格另外可以選LOGO資料庫（推薦＋搜尋，不全部展開）
       選完一格，同一份工單裡寫一樣字的其他缺圖格子會問要不要一起套用。
       可以略過，略過的格子匯入後一樣列在右側警示。

    匯入之後，上方工具列的「比對確認」可以再打開這個畫面換圖。
    「確認單」只列手動指定過的格子，可以複製成圖片貼到對話裡請對方確認。

  只比對LOGO跟商品圖。素材/券樣是資料庫的固定圖，不在這裡處理。

  接法：
    - editor-import.js 的 handleExcelFile 會先呼叫 ImportReview.wants(file)，
      要的話交給 ImportReview.handleExcel()，最後一樣呼叫原本的 onSuccess。
      導覽用的範例工單不走這裡（見 wants）。
    - 子資料夾：BatchAssets只記檔名，這支在載入時另外記每張圖在哪個子資料夾
      （包住 BatchAssets.loadFileList/loadZip、editor-popups.js 的
      readEntryFilesRecursive，只多記路徑，原本的行為不變）。
    - 樣式在 css/style.css 最後面「匯入比對確認」那一段。
*/
var ImportReview = (function(){

  var LS_LAST_SHEET = 'skbn_last_sheet_v1';
  var folderOf = {};          // 檔名 → 子資料夾路徑（'' = 最外層）
  var lastSession = null;     // 最近一次匯入的比對紀錄（重新打開/確認單用）

  /* ══════════════ 0. 小工具 ══════════════ */
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

  function dirOfPath(p){
    p = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    var parts = p.split('/');
    parts.pop();               // 檔名
    // 最外層那個資料夾就是使用者選的資料夾本身，不算「子資料夾」
    if(parts.length) parts.shift();
    return parts.join('/');
  }

  /* 兩段文字最長的共同片段（拿來推薦「名字很像」的圖） */
  function commonPart(a, b){
    if(!a || !b) return '';
    var best = '';
    for(var i = 0; i < a.length; i++){
      for(var j = 0; j < b.length; j++){
        var k = 0;
        while(i+k < a.length && j+k < b.length && a.charAt(i+k) === b.charAt(j+k)) k++;
        if(k > best.length) best = a.substr(i, k);
      }
    }
    return best;
  }
  /* 共同片段要夠長才算「像」：中文2個字、英數3個字；關鍵字本身很短（例如LG）
     就要整個出現。不然「CLINIQUE」跟「TCL」只因為都有cl就被推薦。 */
  function likeScore(key, name){
    var c = commonPart(key, name);
    if(!c) return 0;
    var cjk = /[\u3400-\u9fff]/.test(c);
    if(c.length >= 3 || (cjk && c.length >= 2) || (c === key && c.length >= 2)) return c.length;
    return 0;
  }

  /* 檔期欄通常是「資交(單張)-FMCG-Beauty-CLINIQUE倩碧開館 (雅絲蘭黛集團)」這種
     長字串，真正的品牌在最後一段。拆成幾段關鍵字，每段都拿去比。 */
  function brandKeys(brand){
    var s = String(brand || '');
    var out = [];
    s.split(/[-｜|]/).forEach(function(part){
      part = part.replace(/[（(][^）)]*[）)]/g, ' ').replace(/官方|旗艦店|旗艦館|開館|總代理|品牌/g, ' ');
      part.split(/\s+/).forEach(function(w){
        var n = BatchAssets.normalizeName(w);
        if(n.length >= 2 && !/^(sbd|續|資交|單張|官方|旗艦店|旗艦館|品牌|總代理)$/.test(n)) out.push(n);
      });
    });
    return out;
  }

  function shortBrand(brand){
    var s = String(brand || '');
    var parts = s.split('-');
    return parts.length > 1 ? parts[parts.length-1].trim() : s;
  }

  /* ══════════════ 1. 記下每張圖在哪個子資料夾 ══════════════ */
  function installFolderTracking(){
    // 拖曳資料夾：檔案物件本身沒有路徑，要從entry拿
    if(typeof window.readEntryFilesRecursive === 'function' && !window.readEntryFilesRecursive.__ir){
      var origRead = window.readEntryFilesRecursive;
      window.readEntryFilesRecursive = function(entry, out, done){
        if(entry && entry.isFile){
          entry.file(function(file){
            try{ file.__irPath = entry.fullPath; }catch(e){}
            out.push(file);
            done();
          }, function(err){
            console.warn('[拖曳上傳] 讀取檔案失敗，已跳過：'+entry.fullPath, err);
            done();
          });
          return;
        }
        return origRead(entry, out, done);
      };
      window.readEntryFilesRecursive.__ir = true;
    }

    var origList = BatchAssets.loadFileList;
    BatchAssets.loadFileList = function(fileArray, onProgress){
      folderOf = {};
      Array.prototype.forEach.call(fileArray || [], function(f){
        folderOf[f.name] = dirOfPath(f.__irPath || f.webkitRelativePath || '');
      });
      return origList.apply(BatchAssets, arguments);
    };

    var origZip = BatchAssets.loadZip;
    BatchAssets.loadZip = function(file, onProgress){
      folderOf = {};
      var paths = (typeof JSZip !== 'undefined') ? JSZip.loadAsync(file).then(function(zip){
        zip.forEach(function(relPath, entry){
          if(entry.dir) return;
          var name = relPath.split('/').pop();
          // zip裡面最外層常常就是資料夾本身，dirOfPath會把它去掉
          folderOf[name] = dirOfPath(relPath);
        });
      }).catch(function(){}) : Promise.resolve();
      var res = origZip.apply(BatchAssets, arguments);
      return Promise.all([res, paths]).then(function(r){ return r[0]; });
    };
  }

  function batchFiles(){
    return BatchAssets.list().map(function(f){
      f.folder = folderOf[f.name] || '';
      return f;
    });
  }

  /* LOGO資料庫的每一筆，包成跟「這批上傳的圖」一樣的格式，選圖畫面才能共用
     同一套縮圖/指定邏輯。db:true 用來區分來源。只有LOGO用得到。 */
  var _dbLogoCache = null;
  function dbLogoFiles(){
    if(_dbLogoCache) return _dbLogoCache;
    if(typeof AssetLibrary === 'undefined' || !AssetLibrary.isLoaded()) return [];
    _dbLogoCache = AssetLibrary.systemElements('logo').map(function(item){
      var keys = [item.name, item.brand].concat(item.matchKeys || []).filter(Boolean);
      return {
        db:true, item:item, name:item.name || item.brand, dataUrl:item.path,
        folder:'素材資料庫・'+(item.categoryLabel || ''),
        search: keys.map(function(k){ return AssetMatcher.normKey(k); }).join('|'),
        normKeys: keys.map(function(k){ return BatchAssets.normalizeName(k); })
      };
    });
    return _dbLogoCache;
  }

  /* 資料庫LOGO多半是白色去背圖，放在白底/棋盤格上看不到。改用它實際會搭配的
     底色：資料庫登記的專屬底色 → 這一格的背景色 → 中灰。上傳的圖維持棋盤格。 */
  function thumbBg(f, slot){
    if(!f || !f.db) return '';
    var pf = AssetMatcher.logoPresetFields(f.item);
    return pf.presetBgColor || (slot && slot.bgColor) || '#6b6b6b';
  }
  function bgStyle(f, slot){
    var c = thumbBg(f, slot);
    return c ? ' style="background:'+c+'"' : '';
  }

  /* ══════════════ 2. 選頁籤 ══════════════ */

  /* 「下載當下正在看的那一頁」：xlsx裡 workbook.xml 的 activeTab，或某一頁
     sheetView 上的 tabSelected="1"。Google試算表匯出的檔案有沒有寫，要拿真的
     檔案測過才知道；沒寫就退回「上次選的」→「最右邊」。 */
  function detectActiveSheet(buf, sheetNames){
    if(typeof JSZip === 'undefined') return Promise.resolve(-1);
    return JSZip.loadAsync(buf).then(function(zip){
      var wbFile = zip.file('xl/workbook.xml');
      if(!wbFile) return -1;
      return wbFile.async('string').then(function(xml){
        var m = xml.match(/<(?:\w+:)?workbookView\b[^>]*\bactiveTab="(\d+)"/);
        if(m) return +m[1];
        // 沒寫activeTab = 第一頁（Excel的規則）。但Google有時候是用各頁的
        // tabSelected表示，再看一下各頁有沒有標記。
        var files = sheetNames.map(function(_, i){ return zip.file('xl/worksheets/sheet'+(i+1)+'.xml'); });
        return Promise.all(files.map(function(f){ return f ? f.async('string') : ''; })).then(function(xmls){
          var idx = -1;
          xmls.forEach(function(x, i){ if(idx < 0 && /<(?:\w+:)?sheetView\b[^>]*\btabSelected="(1|true)"/.test(x)) idx = i; });
          return idx;
        });
      });
    }).catch(function(){ return -1; });
  }

  function sheetSummaries(wb){
    return wb.SheetNames.map(function(name){
      var banners = null;
      try{
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:'' });
        banners = parseWorkOrder(rows);
      }catch(e){ banners = null; }
      return { name:name, banners:(banners && banners.length) ? banners : null };
    });
  }

  function pickSheet(wb, buf){
    var sums = sheetSummaries(wb);
    if(sums.length === 1) return Promise.resolve(sums[0]);
    return detectActiveSheet(buf, wb.SheetNames).then(function(activeIdx){
      var last = lsGet(LS_LAST_SHEET);
      var lastIdx = last ? wb.SheetNames.indexOf(last) : -1;
      var defIdx = activeIdx >= 0 ? activeIdx : (lastIdx >= 0 ? lastIdx : sums.length - 1);
      // 預設那一頁不是工單格式（例如停在「填寫說明」頁下載）→ 改選最近的工單頁
      if(!sums[defIdx].banners){
        var alt = -1;
        for(var d = 1; d < sums.length && alt < 0; d++){
          if(sums[defIdx+d] && sums[defIdx+d].banners) alt = defIdx+d;
          else if(sums[defIdx-d] && sums[defIdx-d].banners) alt = defIdx-d;
        }
        if(alt >= 0) defIdx = alt;
      }
      return showSheetPicker(sums, defIdx, activeIdx, lastIdx);
    });
  }

  function showSheetPicker(sums, defIdx, activeIdx, lastIdx){
    return new Promise(function(resolve, reject){
      var sel = defIdx;
      var ov = makeOverlay('ir-sheet');
      function render(){
        ov.innerHTML =
          '<div class="popup-panel ir-sheet-panel">'+
            '<div class="popup-head"><span>選擇匯入頁籤</span></div>'+
            '<div class="popup-body"><div class="ir-sheet-list">'+
            sums.map(function(s, i){
              var tags = [];
              if(i === activeIdx) tags.push('<span class="ir-tag ir-tag-blue">目前頁籤</span>');
              else if(i === lastIdx) tags.push('<span class="ir-tag">上次選擇</span>');
              var info = s.banners ? (s.banners.length+' 組') : '非工單格式';
              return '<label class="ir-sheet-row'+(i===sel?' on':'')+(s.banners?'':' off')+'" data-i="'+i+'">'+
                '<input type="radio" name="ir-sheet"'+(i===sel?' checked':'')+(s.banners?'':' disabled')+'>'+
                '<span class="ir-sheet-name">'+esc(s.name)+'</span>'+tags.join('')+
                '<span class="ir-sheet-info">'+info+'</span></label>';
            }).join('')+
            '</div></div>'+
            '<div class="popup-foot">'+
              '<button class="tbtn" data-act="cancel">取消</button>'+
              '<button class="tbtn primary" data-act="ok">匯入</button>'+
            '</div>'+
          '</div>';
      }
      render();
      ov.addEventListener('click', function(e){
        var row = e.target.closest('.ir-sheet-row');
        if(row && !row.classList.contains('off')){ sel = +row.dataset.i; render(); return; }
        var act = e.target.closest('[data-act]');
        if(!act) return;
        if(act.dataset.act === 'ok'){
          ov.remove();
          lsSet(LS_LAST_SHEET, sums[sel].name);
          resolve(sums[sel]);
        } else {
          ov.remove();
          reject('cancel');
        }
      });
    });
  }

  /* ══════════════ 3. 找出對不到的格子 ══════════════ */

  /* 每一格的LOGO/商品各算一個「項目」。matchLogo/matchProduct本身不會改資料，
     可以放心先跑一次看結果。 */
  function collectItems(banners, mode){
    var items = [];
    var files = batchFiles();
    var dbFiles = dbLogoFiles();
    function fileBySrc(src){
      if(!src) return null;
      for(var i = 0; i < files.length; i++) if(files[i].dataUrl === src) return files[i];
      for(var j = 0; j < dbFiles.length; j++) if(dbFiles[j].dataUrl === src) return dbFiles[j];
      return null;
    }
    banners.forEach(function(banner, bIdx){
      Core.SLOT_KEYS.forEach(function(key){
        var slot = banner[key];
        var base = {
          banner: banner, bIdx: bIdx, key: key, slot: slot,
          pos: bannerDateLabel(banner, bIdx)+' '+(SLOT_LABEL[key]||key),
          dateLabel: bannerDateLabel(banner, bIdx),
          slotLabel: SLOT_LABEL[key]||key,
          brand: slot.brand || ''
        };
        // LOGO
        var lraw = slot._reviewOrigLogo != null ? slot._reviewOrigLogo : slot._importLogoRaw;
        if(lraw !== undefined && String(lraw).trim() && !AssetMatcher.isNoLogoMark(lraw)){
          var it = Object.assign({ kind:'logo', raw:String(lraw).trim() }, base);
          if(mode === 'before'){
            var r = AssetMatcher.matchLogo(it.raw, slot.brand);
            it.source = r.source; it.autoFile = fileBySrc(r.src);
            it.autoSrc = r.src || null;
            it.problem = r.source === 'unmatched';
          } else {
            it.autoSrc = slot.logoRaw || slot.logoSrc || null;
            it.autoFile = fileBySrc(slot.logoRaw);
            it.source = it.autoFile && !it.autoFile.db ? 'batch' : (it.autoSrc ? 'database' : 'unmatched');
            it.problem = !it.autoSrc;
          }
          items.push(it);
        }
        // 商品
        if(slot._importArtType === '商品'){
          var praw = slot._reviewOrigProduct != null ? slot._reviewOrigProduct : (slot._importArtContent || '');
          var pit = Object.assign({ kind:'product', raw:String(praw).trim() }, base);
          if(mode === 'before'){
            var pr = pit.raw ? AssetMatcher.matchProduct(pit.raw, slot.brand) : { src:null, source:'unmatched' };
            pit.source = pr.source; pit.autoFile = pr.source === 'batch' ? fileBySrc(pr.src) : null;
            pit.autoSrc = pr.src || null;
            pit.problem = pr.source === 'unmatched';
          } else {
            pit.autoSrc = slot.productSrc || null;
            pit.autoFile = fileBySrc(slot.productSrc);
            pit.source = pit.autoFile ? 'batch' : (pit.autoSrc ? 'database' : 'unmatched');
            pit.problem = !pit.autoSrc;
          }
          items.push(pit);
        }
      });
    });
    return items;
  }

  /* ══════════════ 4. 比對確認畫面 ══════════════ */

  /* session = { mode:'before'|'after', items, files, sheetName, excelName }
     每個item多兩個欄位：pick（手動指定的檔案）、skip（略過） */
  function openReview(session){
    return new Promise(function(resolve){
      var items = session.items, files = session.files;
      var filter = items.some(function(it){ return it.problem; }) ? 'problem' : 'all';
      var cur = null;
      var hasFolders = files.some(function(f){ return f.folder; });

      function visibleItems(){
        return items.filter(function(it){ return filter === 'all' || it.problem || it.pick; });
      }
      function firstOpen(){
        var v = visibleItems();
        return v.filter(function(it){ return it.problem && !it.pick && !it.skip; })[0] || v[0] || null;
      }
      cur = firstOpen();

      function currentFile(it){ return it.pick || it.autoFile || null; }
      function usedBy(file){
        return items.filter(function(it){ return currentFile(it) === file; });
      }
      function unusedFiles(){
        return files.filter(function(f){ return !usedBy(f).length; });
      }
      function changedItems(){ return items.filter(function(it){ return it.pick; }); }
      function openProblems(){ return items.filter(function(it){ return it.problem && !it.pick && !it.skip; }); }

      function nameScore(it, f){
        var s = 0;
        // 「logo」這種通用字不拿來比，不然工單只寫LOGO時，所有檔名有logo的圖都會被推薦
        var keys = brandKeys(it.brand).concat([BatchAssets.normalizeName(it.raw)]).map(function(k){
          return k.replace(/logo/g, '');
        }).filter(function(k){ return k.length >= 2; });
        var name = f.normalized + BatchAssets.normalizeName(f.folder);
        keys.forEach(function(k){ var c = likeScore(k, name); if(c) s = Math.max(s, c * 10); });
        return s;
      }
      function looksLogoFile(f){ return /logo/i.test(f.name + f.folder); }
      function score(it, f){
        var s = nameScore(it, f);
        var looksLogo = looksLogoFile(f);
        if(it.kind === 'logo' && looksLogo) s += 15;
        if(it.kind === 'product' && looksLogo) s -= 15;
        if(!usedBy(f).length) s += 8;
        return s;
      }

      var ov = makeOverlay('ir-review');

      var KIND = { logo:'LOGO', product:'商品圖' };
      var WEEK = ['日','一','二','三','四','五','六'];

      /* 每一格的狀態：文字＋符號＋顏色，三個一起表達（不只靠顏色） */
      function statusOf(it){
        if(it.pick) return { cls:'picked', icon:'✓', text:'已指定' };
        if(it.problem && it.skip) return { cls:'skipped', icon:'–', text:'略過' };
        if(it.problem) return { cls:'missing', icon:'!', text:'缺圖' };
        return { cls:'ok', icon:'✓', text: it.source === 'database' ? '資料庫' : '已配對' };
      }
      function pill(st){ return '<span class="ir-pill '+st.cls+'"><i>'+st.icon+'</i>'+st.text+'</span>'; }

      function dateHead(it){
        var d = it.banner && it.banner.date ? new Date(it.banner.date+'T00:00:00') : null;
        return esc(it.dateLabel) + (d && !isNaN(d) ? '<span>（'+WEEK[d.getDay()]+'）</span>' : '');
      }

      function itemRow(it){
        var f = currentFile(it), st = statusOf(it);
        var thumb = f ? '<img src="'+f.dataUrl+'" alt="">'
          : (it.autoSrc && !it.pick ? '<img src="'+esc(it.autoSrc)+'" alt="">' : '<span class="ir-q">?</span>');
        return '<button type="button" class="ir-item '+st.cls+(it===cur?' cur':'')+'" data-idx="'+items.indexOf(it)+'">'+
          '<span class="ir-item-thumb"'+bgStyle(f, it.slot)+'>'+thumb+'</span>'+
          '<span class="ir-item-text">'+
            '<span class="ir-item-top"><b>'+esc(it.slotLabel)+'</b><span class="ir-kind">'+KIND[it.kind]+'</span>'+pill(st)+'</span>'+
            '<span class="ir-item-raw">'+(it.raw ? esc(it.raw) : '<i>（未填）</i>')+'</span>'+
            '<span class="ir-item-brand">'+esc(shortBrand(it.brand) || '—')+'</span>'+
            (it.pick ? '<span class="ir-item-new">→ '+esc(it.pick.name)+'</span>' : '')+
          '</span></button>';
      }

      function leftList(){
        var v = visibleItems();
        if(!v.length) return '<div class="ir-empty">無缺圖</div>';
        var html = '', lastDate = null;
        v.forEach(function(it){
          if(it.dateLabel !== lastDate){
            if(lastDate !== null) html += '</div>';
            html += '<div class="ir-day"><div class="ir-day-head">'+dateHead(it)+'</div>';
            lastDate = it.dateLabel;
          }
          html += itemRow(it);
        });
        return html + '</div>';
      }

      function thumbCard(f, it){
        var users = usedBy(f);
        var mine = it && currentFile(it) === f;
        var others = users.filter(function(u){ return u !== it; });
        var tag = others.length
          ? '<span class="ir-tag">'+esc(others[0].pos)+(others.length>1?' 等'+others.length+'格':'')+' 使用中</span>'
          : (mine ? '<span class="ir-tag ir-tag-green">使用中</span>' : '<span class="ir-tag ir-tag-free">未使用</span>');
        var ref = f.db ? 'data-db="'+dbLogoFiles().indexOf(f)+'"' : 'data-file="'+files.indexOf(f)+'"';
        if(f.db && !others.length && !mine) tag = '<span class="ir-tag ir-tag-db">資料庫・'+esc(f.item.categoryLabel||'')+'</span>';
        return '<button type="button" class="ir-thumb'+(f.db?' db':'')+(mine?' on':'')+(others.length && !mine?' used':'')+'" '+ref+' title="'+esc((f.folder?f.folder+'/':'')+f.name)+'">'+
          '<span class="ir-thumb-img"'+bgStyle(f, it && it.slot)+'><img src="'+esc(f.dataUrl)+'" alt="" loading="lazy"></span>'+
          '<span class="ir-thumb-name">'+esc(f.name)+'</span>'+tag+'</button>';
      }

      /* 右上：工單寫的 → 現在用的，左右並排，一眼看出差在哪 */
      function detail(it){
        var st = statusOf(it);
        var f = currentFile(it);
        var showSrc = f ? f.dataUrl : (!it.pick && it.autoSrc ? it.autoSrc : null);
        var note = it.problem
          ? (it.raw ? '查無同名檔案' : '未填檔名')
          : (it.source === 'database' ? '來自素材資料庫' : '已配對同名檔案');
        var pickName = f ? esc(f.name) + (f.folder ? '<span>'+esc(f.folder)+'</span>' : '')
          : (showSrc ? '素材資料庫' : '未指定');
        var actions = '';
        if(it.pick && !it.applied) actions += '<button class="tbtn" data-act="unpick">'+(it.problem ? '取消指定' : '還原')+'</button>';
        if(it.problem && !it.pick) actions += '<button class="tbtn" data-act="skip">'+(it.skip ? '取消略過' : '略過')+'</button>';
        var sib = (pendingSib && pendingSib.from === it) ? pendingSib : null;
        return '<div class="ir-detail">'+
          '<div class="ir-detail-title"><b>'+esc(it.pos)+'</b><span class="ir-kind">'+KIND[it.kind]+'</span>'+pill(st)+'</div>'+
          '<div class="ir-compare">'+
            '<div class="ir-cmp ir-cmp-raw">'+
              '<dl class="ir-cmp-fields">'+
                '<dt>檔期</dt><dd title="'+esc(it.brand)+'">'+esc(it.brand || '—')+'</dd>'+
                '<dt>工單檔名</dt><dd class="ir-cmp-text">'+(it.raw ? esc(it.raw) : '（空白）')+'</dd>'+
              '</dl>'+
              '<div class="ir-cmp-note '+(it.problem?'warn':'')+'">'+note+'</div>'+
            '</div>'+
            '<svg class="ir-cmp-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
            '<div class="ir-cmp ir-cmp-pick'+(showSrc?'':' empty')+'">'+
              '<div class="ir-cmp-img"'+bgStyle(f, it.slot)+'>'+(showSrc ? '<img src="'+esc(showSrc)+'" alt="">' : '')+'</div>'+
              '<div class="ir-cmp-pickinfo"><div class="ir-cmp-label">使用圖片</div><div class="ir-cmp-name">'+pickName+'</div></div>'+
            '</div>'+
            (actions ? '<div class="ir-cmp-actions">'+actions+'</div>' : '')+
          '</div>'+
          (sib ? '<div class="ir-sibbar"><div><b>另有 '+sib.sibs.length+' 格</b>同為「'+esc(it.raw || '（空白）')+'」：'+
              sib.sibs.map(function(x){ return esc(x.pos); }).join('、')+'</div>'+
              '<button class="tbtn" data-act="sib-no">只套用這格</button>'+
              '<button class="tbtn primary" data-act="sib-yes">一起套用</button></div>' : '')+
          '</div>';
      }

      /* 同一份工單裡「寫一樣的字」、也還沒指定的格子（跟編輯器裡「其他相同的
         代補LOGO也一起換上」同一個概念）。工單只寫「LOGO」這種通用字時，
         不同檔期其實是不同LOGO，所以還要檔期也一樣才算。 */
      var GENERIC_RAW = /^(logo|無|商品|商品圖|曝品|圖|圖片)?$/;
      function siblingsOf(it){
        var rk = AssetMatcher.normKey(it.raw), bk = AssetMatcher.normKey(it.brand);
        var generic = GENERIC_RAW.test(rk);
        return items.filter(function(x){
          if(x === it || x.kind !== it.kind || !x.problem || x.pick || x.skip) return false;
          if(AssetMatcher.normKey(x.raw) !== rk) return false;
          return !generic || AssetMatcher.normKey(x.brand) === bk;
        });
      }
      var pendingSib = null;

      /* 資料庫LOGO推薦分數：工單LOGO欄、檔期欄都拿來比。
         有數字的（10.25、11.11）一定要整段包含才算，不然 10.25 會被當成像 10.10。 */
      function dbScore(it, f){
        var rk = AssetMatcher.normKey(it.raw).replace(/_?logo$/, '').replace(/^logo_?/, '');
        var bk = AssetMatcher.normKey(it.brand);
        var best = 0;
        f.search.split('|').forEach(function(k){
          if(!k || k.length < 2) return;
          if(rk && rk === k) best = Math.max(best, 100);
          else if(rk && rk.length >= 2 && (rk.indexOf(k) >= 0 || k.indexOf(rk) >= 0)) best = Math.max(best, 60 + Math.min(k.length, rk.length));
          else if(bk && bk.indexOf(k) >= 0) best = Math.max(best, 40 + k.length);
          else if(rk && !/[0-9]/.test(k + rk)){ var c = likeScore(rk, k); if(c) best = Math.max(best, 10 * c); }
        });
        return best;
      }

      var dbQuery = '', dbQueryOwner = null;
      function dbResults(it){
        var q = AssetMatcher.normKey(dbQuery);
        if(!q) return '';
        var hits = dbLogoFiles().filter(function(f){ return f.search.indexOf(q) >= 0; });
        if(!hits.length) return '<div class="ir-dim ir-dbnone">查無結果</div>';
        return '<div class="ir-grid">'+hits.slice(0, 24).map(function(f){ return thumbCard(f, it); }).join('')+'</div>'+
          (hits.length > 24 ? '<div class="ir-dim ir-dbnone">共 '+hits.length+' 筆，請輸入更完整的關鍵字</div>' : '');
      }

      function rightPane(){
        if(!cur) return '<div class="ir-empty">選擇左側項目</div>';
        var it = cur;
        var ranked = files.slice().sort(function(a, b){ return score(it, b) - score(it, a); });
        // 推薦：名字要真的像才放（商品格不推薦檔名有logo的圖）
        var rec = ranked.filter(function(f){
          return nameScore(it, f) > 0 && !(it.kind === 'product' && looksLogoFile(f));
        }).slice(0, 6);
        var html = detail(it);
        var isLogo = it.kind === 'logo';
        if(dbQueryOwner !== it){ dbQuery = ''; dbQueryOwner = it; }
        if(isLogo){
          // 資料庫推薦：工單LOGO欄、檔期欄都比（見dbScore）；排在上傳的圖前面
          var dbRec = dbLogoFiles().map(function(f){ return { f:f, s:dbScore(it, f) }; })
            .filter(function(x){ return x.s > 0; }).sort(function(a, b){ return b.s - a.s; })
            .slice(0, 4).map(function(x){ return x.f; });
          rec = dbRec.concat(rec.slice(0, 8 - dbRec.length));
        }
        if(!files.length && !isLogo){
          return html + '<div class="ir-empty">未上傳素材資料夾</div>';
        }
        html += '<div class="ir-pickhint">點選圖片即指定，完成後跳至下一格</div>';
        if(isLogo){
          html += '<section class="ir-group ir-group-db">'+
            '<label class="ir-dbsearch-wrap"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'+
            '<input class="ir-dbsearch" type="search" placeholder="搜尋 LOGO 資料庫（'+dbLogoFiles().length+' 筆）：名稱或關鍵字" value="'+esc(dbQuery)+'"></label>'+
            '<div class="ir-dbresults">'+dbResults(it)+'</div></section>';
        }
        if(rec.length){
          html += '<section class="ir-group ir-group-rec"><h4>推薦</h4><div class="ir-grid">'+
            rec.map(function(f){ return thumbCard(f, it); }).join('')+'</div></section>';
        }
        // 依資料夾分組；沒有子資料夾就一組「全部的圖」
        var groups = {}, order = [];
        ranked.forEach(function(f){
          var g = hasFolders ? (f.folder || '最外層') : '全部的圖';
          if(!groups[g]){ groups[g] = []; order.push(g); }
          groups[g].push(f);
        });
        order.sort(function(a, b){
          var sa = Math.max.apply(null, groups[a].map(function(f){ return score(it, f); }));
          var sb = Math.max.apply(null, groups[b].map(function(f){ return score(it, f); }));
          return sb - sa || a.localeCompare(b);
        });
        order.forEach(function(g){
          html += '<section class="ir-group"><h4>'+(hasFolders ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' : '')+
            esc(g)+'<span>'+groups[g].length+' 張</span></h4><div class="ir-grid">'+
            groups[g].map(function(f){ return thumbCard(f, it); }).join('')+'</div></section>';
        });
        return html;
      }

      function render(keepScroll){
        var leftScroll = keepScroll && ov.querySelector('.ir-left') ? ov.querySelector('.ir-left').scrollTop : 0;
        var probItems = items.filter(function(it){ return it.problem; });
        var probs = probItems.length;
        var open = openProblems().length;
        var done = probs - open;
        var skipped = items.filter(function(it){ return it.problem && it.skip && !it.pick; }).length;
        var unused = unusedFiles();
        var changed = changedItems().length;
        var title = session.mode === 'before'
          ? (probs ? '比對確認：'+probs+' 格缺圖' : '比對確認')
          : '比對確認';
        var progress = probs
          ? '<div class="ir-progress"><div class="ir-progress-text">完成 <b>'+done+'</b> / '+probs+'</div>'+
              '<div class="ir-progress-bar"><div style="width:'+Math.round(done/probs*100)+'%"></div></div></div>'
          : '';
        ov.innerHTML =
          '<div class="popup-panel ir-panel" role="dialog" aria-label="比對確認">'+
            '<div class="ir-head">'+
              '<div class="ir-head-title"><h3>'+title+'</h3>'+
                '<div class="ir-sub">'+esc(session.excelName||'')+(session.sheetName?'　／　'+esc(session.sheetName):'')+'</div></div>'+
              progress+
              '<button class="popup-x" data-act="close" title="關閉">×</button>'+
            '</div>'+
            '<div class="ir-body">'+
              '<div class="ir-leftcol">'+
                '<div class="ir-filter" role="tablist">'+
                  '<button class="'+(filter==='problem'?'on':'')+'" data-filter="problem">缺圖<span>'+probs+'</span></button>'+
                  '<button class="'+(filter==='all'?'on':'')+'" data-filter="all">全部<span>'+items.length+'</span></button>'+
                '</div>'+
                '<div class="ir-left">'+leftList()+'</div>'+
                '<div class="ir-keys">↑ ↓ 切換項目</div>'+
              '</div>'+
              '<div class="ir-right">'+rightPane()+'</div>'+
            '</div>'+
            '<div class="ir-unused">'+
              '<div class="ir-unused-head"><div>未使用 <b>'+unused.length+'</b></div><span>點選即指定</span></div>'+
              '<div class="ir-unused-strip">'+(unused.length ? unused.map(function(f){
                return '<button type="button" class="ir-mini" data-file="'+files.indexOf(f)+'" title="'+esc((f.folder?f.folder+'/':'')+f.name)+'"><img src="'+f.dataUrl+'" alt=""></button>';
              }).join('') : '<span class="ir-dim">無</span>')+'</div>'+
            '</div>'+
            '<div class="ir-foot">'+
              '<div class="ir-status"><div>'+(open ? '待指定 <b>'+open+'</b>' : (probs ? '全部完成' : ''))+
                (skipped ? '　略過 '+skipped : '')+'</div>'+
                ((open || skipped) ? '<span>未指定的格子匯入後列入警示</span>' : '')+'</div>'+
              '<button class="tbtn" data-act="sheet"'+(changed?'':' disabled')+'>確認單'+(changed?'（'+changed+'）':'')+'</button>'+
              (session.mode === 'before'
                ? '<button class="tbtn" data-act="skipall">不套用，直接匯入</button><button class="tbtn primary" data-act="apply">套用並匯入</button>'
                : '<button class="tbtn primary" data-act="apply">套用變更</button>')+
            '</div>'+
          '</div>';
        if(keepScroll) ov.querySelector('.ir-left').scrollTop = leftScroll;
        var curEl = ov.querySelector('.ir-item.cur');
        if(curEl && curEl.scrollIntoView) curEl.scrollIntoView({ block:'nearest' });
      }

      // 指定圖片：有同名的其他格 → 先問要不要一起套用，不自動跳下一格
      function assign(it, f){
        it.pick = f; it.skip = false; it.applied = false;
        var sibs = it.problem ? siblingsOf(it) : [];
        if(sibs.length){ pendingSib = { from:it, file:f, sibs:sibs }; return; }
        pendingSib = null;
        advance();
      }

      function advance(){
        var v = visibleItems();
        var i = v.indexOf(cur);
        var next = v.slice(i+1).concat(v.slice(0, i)).filter(function(it){ return it.problem && !it.pick && !it.skip; })[0];
        if(next) cur = next;
      }

      render();

      function onKey(e){
        if(!document.body.contains(ov)){ document.removeEventListener('keydown', onKey); return; }
        if(document.querySelector('.ir-sheetimg')) return;
        if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if(e.target && e.target.tagName === 'INPUT') return;
        var v = visibleItems(), i = v.indexOf(cur);
        if(!v.length) return;
        e.preventDefault();
        cur = v[Math.max(0, Math.min(v.length-1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        render(true);
      }
      document.addEventListener('keydown', onKey);

      // 搜尋框：只重畫結果，不重畫整個畫面（不然輸入框會失焦）
      ov.addEventListener('input', function(e){
        if(!e.target.classList.contains('ir-dbsearch')) return;
        dbQuery = e.target.value;
        var box = ov.querySelector('.ir-dbresults');
        if(box && cur) box.innerHTML = dbResults(cur);
      });

      ov.addEventListener('click', function(e){
        var t;
        if((t = e.target.closest('[data-filter]'))){
          filter = t.dataset.filter;
          if(visibleItems().indexOf(cur) < 0) cur = firstOpen();
          render(); return;
        }
        if((t = e.target.closest('.ir-item'))){
          cur = items[+t.dataset.idx]; pendingSib = null; render(true); return;
        }
        if((t = e.target.closest('.ir-thumb'))){
          if(!cur) return;
          var f = t.dataset.db != null ? dbLogoFiles()[+t.dataset.db] : files[+t.dataset.file];
          if(cur.pick === f || (!cur.pick && cur.autoFile === f)){
            // 再點一次已選的圖 = 取消（已經套用到畫面上的不能這樣取消，改選別張就好）
            if(cur.pick === f && !cur.applied) cur.pick = null;
          } else {
            assign(cur, f);
          }
          render(true); return;
        }
        if((t = e.target.closest('.ir-mini'))){
          // 點下面「沒用到的圖」：直接指定給目前這一格
          if(!cur) return;
          assign(cur, files[+t.dataset.file]);
          render(true); return;
        }
        if((t = e.target.closest('[data-act]'))){
          var act = t.dataset.act;
          if(act === 'sib-yes' && pendingSib){
            pendingSib.sibs.forEach(function(x){ x.pick = pendingSib.file; x.skip = false; x.applied = false; });
            pendingSib = null; advance(); render(true);
          }
          else if(act === 'sib-no'){ pendingSib = null; advance(); render(true); }
          else if(act === 'unpick'){ cur.pick = null; pendingSib = null; render(true); }
          else if(act === 'skip'){ cur.skip = !cur.skip; if(cur.skip) advance(); render(true); }
          else if(act === 'sheet'){ showConfirmSheet(session); }
          else if(act === 'skipall'){ items.forEach(function(it){ it.pick = null; }); ov.remove(); resolve('apply'); }
          else if(act === 'apply'){ ov.remove(); resolve('apply'); }
          else if(act === 'close'){
            if(session.mode === 'before'){
              // 匯入前按×：當成「不改了，直接匯入」，不要讓整個匯入卡住
              if(changedItems().length && !confirm('指定的圖片尚未套用，確定直接匯入？')) return;
              items.forEach(function(it){ it.pick = null; });
            } else if(changedItems().some(function(it){ return !it.applied; }) && !confirm('指定的圖片尚未套用，確定關閉？')) return;
            ov.remove(); resolve(session.mode === 'before' ? 'apply' : 'close');
          }
        }
      });
    });
  }

  /* ══════════════ 5. 套用 ══════════════ */

  /* 匯入前：把「工單寫的文字」換成選到的檔名，後面原本的比對流程就會自己
     對到那張圖、照原本的規則處理（LOGO自動裁切白底、商品加陰影...），不用
     另外寫一套套用邏輯。原本的文字留在 _reviewOrig* 給確認單用。 */
  function applyBefore(items){
    items.forEach(function(it){
      if(!it.pick) return;
      var s = it.slot;
      if(it.kind === 'logo'){
        if(s._reviewOrigLogo == null) s._reviewOrigLogo = s._importLogoRaw;
        if(it.pick.db){
          // 資料庫LOGO：找一個「丟進原本比對流程，一定會對到這一筆」的寫法
          // （名稱/品牌/關鍵字都試，用真正的比對函式驗證），這樣色票、強制白色、
          // 裁切模式都照原本規則套用。都對不到（例如跟別筆重名）就等匯入完再直接換。
          var keys = [it.pick.item.name, it.pick.item.brand].concat(it.pick.item.matchKeys || []).filter(Boolean);
          var ok = keys.filter(function(k){ return AssetMatcher.matchLogo(k, '').src === it.pick.item.path; })[0];
          if(ok) s._importLogoRaw = ok;
          else { s._importLogoRaw = '-'; it.applied = false; it._needDirect = true; return; }
        } else {
          s._importLogoRaw = it.pick.name;
        }
      } else {
        if(s._reviewOrigProduct == null) s._reviewOrigProduct = s._importArtContent || '';
        s._importArtContent = it.pick.name;
      }
      it.applied = true;
    });
  }

  /* 資料庫LOGO直接套用（跟editor-import.js的resolveSlot同一套規則） */
  function applyDbLogo(s, item, done){
    var pf = AssetMatcher.logoPresetFields(item);
    s.logoRaw = item.path;
    s.logoMode = pf.forceTrimMode ? 'trim' : 'original';
    if(pf.presetColors && pf.presetColors.length){
      s.presetColors = pf.presetColors.slice();
      s.presetBgColor = pf.presetBgColor;
      s.presetTextColor = pf.presetTextColor;
    }
    if(pf.keepOriginalColor) s.logoForceWhite = false;
    else if(pf.categoryKey === 'siteWideSale') s.logoForceWhite = true;
    else if(pf.categoryKey === 'festival' || pf.categoryKey === 'common'){
      var lum = (typeof colorLuminance === 'function') ? colorLuminance(s.bgColor) : 1;
      var th = (window.SHARED_ELEMENTS && SHARED_ELEMENTS.luminanceThreshold) || 0.4;
      s.logoForceWhite = lum < th;
    }
    Modules.logo.applyProcessing(s, done);
  }

  /* 匯入後：直接換圖（跟手動上傳一樣），不重跑整格的比對，避免動到已經
     調整過的背景色、文字色。 */
  function applyAfter(items, done){
    var pending = 0;
    items.forEach(function(it){
      if(!it.pick || it.applied) return;
      var s = it.slot;
      if(it.kind === 'logo'){
        if(s._reviewOrigLogo == null) s._reviewOrigLogo = s._importLogoRaw;
        s._importLogoRaw = it.pick.name;
        pending++;
        if(it.pick.db){
          applyDbLogo(s, it.pick.item, function(){ if(--pending === 0) done(); });
        } else {
          s.logoRaw = it.pick.dataUrl;
          s.logoMode = 'trim';
          Modules.logo.applyProcessing(s, function(){ if(--pending === 0) done(); });
        }
      } else {
        if(s._reviewOrigProduct == null) s._reviewOrigProduct = s._importArtContent || '';
        s._importArtContent = it.pick.name;
        s.productSrc = it.pick.dataUrl;
        s.productOffsetX = 0; s.productOffsetY = 0; s.productScale = 1;
        if(!s.shadowAngle || s.shadowAngle === 'off') s.shadowAngle = 'right';
      }
      it.applied = true;
    });
    if(pending === 0) done();
  }

  /* ══════════════ 6. 確認單（圖片） ══════════════ */
  function loadImg(src){
    return new Promise(function(res){
      var im = new Image();
      im.onload = function(){ res(im); };
      im.onerror = function(){ res(null); };
      im.src = src;
    });
  }

  function drawConfirmSheet(session, includeMissing, skipDbImg){
    var rows = session.items.filter(function(it){ return it.pick; });
    var missing = includeMissing ? session.items.filter(function(it){ return it.problem && !it.pick; }) : [];
    var W = 900, PAD = 28, ROW = 92, TH = 72;
    var H = PAD + 70 + 34 + rows.length * ROW + (missing.length ? 44 + missing.length * 34 : 0) + PAD + 10;
    var cv = document.createElement('canvas');
    var dpr = 2;
    cv.width = W*dpr; cv.height = H*dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    var FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif';

    return Promise.all(rows.map(function(it){ return (skipDbImg && it.pick.db) ? null : loadImg(it.pick.dataUrl); })).then(function(imgs){
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#EE4D2D'; ctx.fillRect(0, 0, W, 6);
      ctx.fillStyle = '#111'; ctx.font = 'bold 22px '+FONT; ctx.textBaseline = 'top';
      ctx.fillText('Mall SKBN 圖片確認單', PAD, PAD);
      ctx.fillStyle = '#666'; ctx.font = '13px '+FONT;
      var d = new Date();
      var sub = (session.sheetName || session.excelName || '') + '　·　' + (d.getMonth()+1)+'/'+d.getDate()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
      ctx.fillText(sub, PAD, PAD+32);
      ctx.fillText('以下格子檔名無法對應，已暫選圖片，請確認。', PAD, PAD+50);

      var y = PAD + 82;
      // 表頭
      var cols = { pos:PAD, brand:PAD+92, raw:PAD+290, img:PAD+520, name:PAD+520+TH+14 };
      ctx.fillStyle = '#f3f3f3'; ctx.fillRect(PAD-8, y-6, W-2*PAD+16, 26);
      ctx.fillStyle = '#555'; ctx.font = 'bold 12px '+FONT;
      ctx.fillText('版位', cols.pos, y); ctx.fillText('檔期', cols.brand, y);
      ctx.fillText('工單檔名', cols.raw, y); ctx.fillText('暫選圖片', cols.img, y);
      y += 28;

      function clip(text, maxW){
        text = String(text || '');
        if(ctx.measureText(text).width <= maxW) return text;
        while(text.length && ctx.measureText(text+'…').width > maxW) text = text.slice(0, -1);
        return text+'…';
      }
      function wrap2(text, x, yy, maxW, lh){
        text = String(text || '');
        var line = '', lines = [];
        for(var i = 0; i < text.length; i++){
          if(ctx.measureText(line+text[i]).width > maxW && line){ lines.push(line); line = ''; }
          line += text[i];
        }
        lines.push(line);
        if(lines.length > 2){ lines = lines.slice(0, 2); lines[1] = clip(lines[1]+'…', maxW); }
        lines.forEach(function(l, k){ ctx.fillText(l, x, yy + k*lh); });
      }

      rows.forEach(function(it, i){
        if(i) { ctx.strokeStyle = '#e6e6e6'; ctx.beginPath(); ctx.moveTo(PAD-8, y-8); ctx.lineTo(W-PAD+8, y-8); ctx.stroke(); }
        ctx.fillStyle = '#111'; ctx.font = 'bold 15px '+FONT;
        ctx.fillText(it.pos, cols.pos, y+4);
        ctx.font = '12px '+FONT; ctx.fillStyle = it.kind==='logo' ? '#1a73e8' : '#EE4D2D';
        ctx.fillText(it.kind==='logo' ? 'LOGO' : '商品圖', cols.pos, y+26);
        ctx.fillStyle = '#333'; ctx.font = '13px '+FONT;
        wrap2(shortBrand(it.brand), cols.brand, y+4, 186, 18);
        ctx.fillStyle = '#999';
        wrap2(it.raw || '（空白）', cols.raw, y+4, 214, 18);
        // 箭頭
        ctx.fillStyle = '#bbb'; ctx.font = '16px '+FONT; ctx.fillText('→', cols.img-24, y+24);
        // 縮圖（棋盤底，看得出去背）
        var bx = cols.img, by = y-2;
        var dbBg = thumbBg(it.pick, it.slot);
        if(dbBg){ ctx.fillStyle = dbBg; ctx.fillRect(bx, by, TH, TH); }
        else for(var cy = 0; cy < TH; cy += 8) for(var cx = 0; cx < TH; cx += 8){
          ctx.fillStyle = ((cx+cy)/8) % 2 ? '#eee' : '#fafafa'; ctx.fillRect(bx+cx, by+cy, 8, 8);
        }
        var im = imgs[i];
        if(im){
          var sc = Math.min(TH/im.width, TH/im.height);
          var w = im.width*sc, h = im.height*sc;
          ctx.drawImage(im, bx+(TH-w)/2, by+(TH-h)/2, w, h);
        }
        ctx.strokeStyle = '#ddd'; ctx.strokeRect(bx+0.5, by+0.5, TH-1, TH-1);
        ctx.fillStyle = '#111'; ctx.font = 'bold 13px '+FONT;
        wrap2(it.pick.name, cols.name, y+4, W-PAD-cols.name, 18);
        if(it.pick.folder){ ctx.fillStyle = '#999'; ctx.font = '12px '+FONT; ctx.fillText(clip('📁 '+it.pick.folder, W-PAD-cols.name), cols.name, y+44); }
        y += ROW;
      });

      if(missing.length){
        y += 6;
        ctx.fillStyle = '#b26a00'; ctx.font = 'bold 14px '+FONT;
        ctx.fillText('⚠ 缺圖，請補檔', PAD, y);
        y += 26;
        ctx.font = '13px '+FONT; ctx.fillStyle = '#333';
        missing.forEach(function(it){
          ctx.fillText(clip(it.pos+'　'+(it.kind==='logo'?'LOGO':'商品圖')+'　'+shortBrand(it.brand)+'　工單檔名：'+(it.raw||'（未填）'), W-2*PAD), PAD, y);
          y += 34;
        });
      }
      return cv;
    });
  }

  function showConfirmSheet(session){
    var ov = makeOverlay('ir-sheetimg');
    var includeMissing = false;
    function build(){
      // 本機用 file:// 開時，資料庫的圖會讓畫布無法輸出（瀏覽器安全限制），
      // 這時改成不畫資料庫圖的縮圖；放到網站上（GitHub Pages）不會有這個問題。
      return drawConfirmSheet(session, includeMissing).then(function(cv){
        try{ cv.toDataURL(); return cv; }catch(e){ return drawConfirmSheet(session, includeMissing, true); }
      }).then(function(cv){
        var missingCount = session.items.filter(function(it){ return it.problem && !it.pick; }).length;
        ov.innerHTML =
          '<div class="popup-panel ir-sheetimg-panel">'+
            '<div class="popup-head"><span>確認單預覽</span><button class="popup-x" data-act="x">×</button></div>'+
            '<div class="popup-body ir-sheetimg-body"><img src="'+cv.toDataURL('image/png')+'"></div>'+
            '<div class="popup-foot">'+
              (missingCount ? '<label class="ir-check"><input type="checkbox" data-act="miss"'+(includeMissing?' checked':'')+'> 附缺圖清單（'+missingCount+'）</label>' : '')+
              '<span class="ir-copied"></span>'+
              '<button class="tbtn" data-act="dl">下載 PNG</button>'+
              '<button class="tbtn primary" data-act="copy">複製圖片</button>'+
            '</div>'+
          '</div>';
        ov._cv = cv;
      });
    }
    build();
    ov.addEventListener('click', function(e){
      var t = e.target.closest('[data-act]');
      if(!t) return;
      var act = t.dataset.act;
      if(act === 'x') ov.remove();
      else if(act === 'miss'){ includeMissing = t.checked; build(); }
      else if(act === 'dl'){
        var a = document.createElement('a');
        a.href = ov._cv.toDataURL('image/png');
        a.download = 'SKBN確認單_'+(session.sheetName||'')+'.png';
        a.click();
      } else if(act === 'copy'){
        var msg = ov.querySelector('.ir-copied');
        if(!navigator.clipboard || typeof ClipboardItem === 'undefined'){
          msg.textContent = '無法複製，請改用下載'; return;
        }
        ov._cv.toBlob(function(blob){
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function(){
            msg.textContent = '已複製';
          }, function(){ msg.textContent = '無法複製，請改用下載'; });
        });
      }
    });
  }

  /* ══════════════ 7. 接進匯入流程 ══════════════ */

  function makeOverlay(cls){
    var ov = document.createElement('div');
    ov.className = 'popup-overlay ir-overlay '+cls;
    document.body.appendChild(ov);
    return ov;
  }

  /* editor-import.js 的 handleExcelFile 會先問 wants(file)：要不要走這個流程。
     導覽用的範例工單不要（裡面故意放了對不到的格子，給「提示與警示」那一步
     展示用；跳出比對確認的話導覽會卡住），照原本流程匯入。 */
  function wants(file){
    if(window.TOUR_SAMPLE && file && file.name === window.TOUR_SAMPLE.excelName) return false;
    return true;
  }

  function handleExcel(file, onSuccess, onFail){
      var reader = new FileReader();
      reader.onload = function(evt){
        var buf = evt.target.result, wb;
        try{ wb = XLSX.read(buf, { type:'array' }); }
        catch(err){ console.error(err); onFail('這份 Excel 讀取失敗，請確認檔案格式，或直接手動輸入內容。'); return; }

        pickSheet(wb, buf).then(function(sheet){
          if(!sheet.banners){
            onFail('「'+sheet.name+'」這一頁沒有比對到左中右三塊的欄位格式，請確認是不是同一種工單範本。');
            return;
          }
          var banners = sheet.banners;
          var session = { mode:'before', items:null, files:batchFiles(), sheetName:sheet.name, excelName:file.name };
          var ensureLib = (typeof AssetLibrary !== 'undefined' && !AssetLibrary.isLoaded()) ? AssetLibrary.load() : Promise.resolve();
          ensureLib.then(function(){
            session.items = collectItems(banners, 'before');
            lastSession = session;
            var hasProblem = session.items.some(function(it){ return it.problem; });
            if(!hasProblem){ onSuccess(banners); return; }
            openReview(session).then(function(){
              applyBefore(session.items);
              onSuccess(banners);
              // 資料庫LOGO沒辦法用原本比對流程對到的，匯入後直接換上
              session.items.forEach(function(it){
                if(!it._needDirect) return;
                it._needDirect = false; it.applied = true;
                applyDbLogo(it.slot, it.pick.item, function(){ if(typeof renderAll === 'function') renderAll(); });
              });
              updateTopbarButton();
            });
          });
        }, function(){
          // 選頁籤時按「取消匯入」
          closePopup();
        });
      };
      reader.readAsArrayBuffer(file);
  }

  /* 匯入後重新打開 */
  function reopen(){
    if(!STATE.banners || !STATE.banners.length){ alert('尚未匯入工單'); return; }
    var prev = lastSession;
    var session = {
      mode:'after', files:batchFiles(),
      sheetName: prev && prev.sheetName, excelName: prev && prev.excelName,
      items: collectItems(STATE.banners, 'after')
    };
    // 帶回之前手動指定過的紀錄（確認單要用）
    if(prev){
      session.items.forEach(function(it){
        var old = prev.items && prev.items.filter(function(o){ return o.slot === it.slot && o.kind === it.kind && o.pick; })[0];
        // 之前手動指定、而且畫面上現在還是那張圖 → 維持「已指定」的狀態
        if(old && it.autoFile === old.pick){
          it.pick = old.pick; it.applied = true; it.problem = true; it.autoFile = null;
        }
      });
    }
    lastSession = session;
    openReview(session).then(function(res){
      if(res !== 'apply') return;
      applyAfter(session.items, function(){
        if(typeof renderAll === 'function') renderAll();
      });
    });
  }

  function updateTopbarButton(){
    var btn = document.getElementById('ir-reopen-btn');
    if(btn) btn.disabled = !(STATE.banners && STATE.banners.length);
  }

  function installTopbarButton(){
    var bar = document.querySelector('.topbar-right');
    if(!bar || document.getElementById('ir-reopen-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'tbtn'; btn.id = 'ir-reopen-btn'; btn.type = 'button';
    btn.title = '重新打開比對確認：檢查/更換LOGO跟商品圖用的是哪一張';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="5" height="5" rx="1"/><rect x="9.5" y="8.5" width="5" height="5" rx="1"/><path d="M9 4.5h3.5V7M7 11.5H3.5V9"/></svg>比對確認';
    btn.addEventListener('click', reopen);
    // 放在「匯入工單」後面
    var importBtn = Array.prototype.filter.call(bar.querySelectorAll('.tbtn'), function(b){ return /匯入工單/.test(b.textContent); })[0];
    if(importBtn && importBtn.nextSibling) bar.insertBefore(btn, importBtn.nextSibling);
    else bar.appendChild(btn);
  }

  /* ══════════════ 8. 樣式（正式版搬到 css/style.css） ══════════════ */
  function init(){
    installFolderTracking();
    installTopbarButton();
    updateTopbarButton();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { wants: wants, handleExcel: handleExcel, reopen: reopen, _collect: collectItems, _last: function(){ return lastSession; } };
})();
