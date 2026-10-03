'use strict';
/*
  batch-assets.js
  ------------------------------------------------------------
  「這批（這週）素材資料夾」上傳：使用者把美術工單附的那包 zip（例如
  924-930.zip）整包丟進來，這支負責解壓、把每張圖轉成 dataURL，並且對每個
  檔名做「標準化」處理，給 asset-matcher.js 拿去跟 Excel 裡寫的檔名模糊比對。

  標準化規則（已跟你確認過）：去掉副檔名、空白、底線、連字號、括號，以及
  「Copy of」「複製」這幾個常見的重複檔名前後綴，主體名稱相同就算同一個檔案。
  這樣「Beauty_康是美.png」才比對得到「Beauty_康是美 - 複製.png」，
  「幫寶適logo-15.png」才比對得到「Copy of 幫寶適logo-15.png」。

  只做「這一批」用，不會寫進 data/asset-library.json 資料庫——這批資料夾是
  每週會變的素材，資料庫放的是「重複使用、跨檔期」的固定素材（LOGO常用建檔、
  券樣模板等）。
*/
var BatchAssets = (function(){
  var files = []; // [{ name, normalized, dataUrl, ext }]

  function normalizeName(name){
    if(!name) return '';
    var base = String(name);
    // 只取檔名本身，去掉資料夾路徑
    base = base.split('/').pop().split('\\').pop();
    // 去掉副檔名
    base = base.replace(/\.[a-zA-Z0-9]+$/, '');
    // 去掉常見的重複檔名前後綴
    base = base.replace(/copy of/gi, '');
    base = base.replace(/複製/g, '');
    base = base.toLowerCase();
    // 去掉空白、底線、連字號、括號、百分比符號——這幾個常常是Excel跟實際
    // 檔名對同一個商品用不同符號表達的地方(例如Excel寫"10%菸鹼醯胺"，
    // 檔名寫成"10_菸鹼醯胺"，%沒去掉的話兩邊永遠對不起來，這是實際踩過
    // 的bug)。全形/半形括號內容不特別處理，只去符號本身。
    base = base.replace(/[\s_\-（）()%]/g, '');
    return base;
  }

  /* 讀一個 zip 檔（File物件），解出所有圖片，回傳 Promise，resolve時
     files 已經準備好。非圖片（.txt/.json等）會被忽略。
     2026-10：加上onProgress(可選)，每解完一張圖回報一次進度
     { done, total, loadedBytes, totalBytes, pending }，給匯入中的進度視窗用
     （zip是本機解壓縮，沒有位元組進度，loadedBytes/totalBytes固定給0）。 */
  function loadZip(file, onProgress){
    return JSZip.loadAsync(file).then(function(zip){
      var entries = [];
      zip.forEach(function(relPath, entry){
        if(entry.dir) return;
        if(!/\.(png|jpg|jpeg|webp|gif)$/i.test(relPath)) return;
        entries.push(entry);
      });
      var total = entries.length, done = 0;
      function report(){
        if(!onProgress) return;
        try{ onProgress({ done:done, total:total, loadedBytes:0, totalBytes:0, pending:[] }); }catch(e){}
      }
      report();
      return Promise.all(entries.map(function(entry){
        return entry.async('base64').then(function(b64){
          var ext = (entry.name.match(/\.([a-zA-Z0-9]+)$/)||[,'png'])[1].toLowerCase();
          var mime = ext === 'jpg' ? 'jpeg' : ext;
          var shortName = entry.name.split('/').pop().split('\\').pop();
          return shrinkIfNeeded('data:image/'+mime+';base64,'+b64).then(function(dataUrl){
            done++; report();
            return { name: shortName, normalized: normalizeName(shortName), ext: ext, dataUrl: dataUrl };
          });
        });
      }));
    }).then(function(list){
      files = list;
      return files;
    });
  }

  /* 讀一批直接選出來/拖曳進來的檔案（webkitdirectory 資料夾選取，或拖曳
     整個資料夾用 editor-popups.js 的遞迴 entry 讀取），跟 loadZip() 產生
     同一種格式的清單，後面 asset-matcher.js 用起來完全不用分是zip還是
     資料夾來源。非圖片檔案會被忽略。

     2026-10：加上進度回報跟「不等了」的出口——
       onProgress(可選)：每讀到一點資料/每讀完一張都會呼叫一次，內容是
         { done, total, loadedBytes, totalBytes, pending:[{name,size}] }
         pending是還沒讀完的檔案，進度視窗拿來顯示「現在卡在哪一張」。
       finishNow()：資料夾放在雲端硬碟(G:)時，瀏覽器要等檔案下載下來才讀得到，
         檔案大或網路慢會等很久，甚至某一張一直讀不完——原本整個匯入會停在
         「匯入中」完全沒有反應也沒有出口。finishNow()會放棄還沒讀完的檔案，
         直接用已經讀完的那些繼續往下走（沒讀到的格子之後會出現在警示清單，
         可以手動補圖）。 */
  var _activeLoad = null;

  /* 2026-10：太大的圖先縮小再存（見js/image-shrink.js），縮完才算這張讀完。
     沒有載入image-shrink.js的話就維持原圖。 */
  function shrinkIfNeeded(dataUrl){
    return new Promise(function(resolve){
      if(typeof ImageShrink === 'undefined'){ resolve(dataUrl); return; }
      ImageShrink.shrinkDataUrl(dataUrl, resolve);
    });
  }

  function loadFileList(fileArray, onProgress){
    var images = (fileArray||[]).filter(function(f){ return /\.(png|jpe?g|webp|gif)$/i.test(f.name); });
    var total = images.length, done = 0;
    var totalBytes = images.reduce(function(sum, f){ return sum + (f.size||0); }, 0);
    var loaded = images.map(function(){ return 0; });
    var settled = images.map(function(){ return false; });
    var results = new Array(total);
    var readers = [];
    var finished = false;

    function report(){
      if(!onProgress) return;
      var loadedBytes = loaded.reduce(function(sum, n){ return sum + n; }, 0);
      var pending = [];
      images.forEach(function(f, i){ if(!settled[i]) pending.push({ name:f.name, size:f.size||0 }); });
      try{ onProgress({ done:done, total:total, loadedBytes:loadedBytes, totalBytes:totalBytes, pending:pending }); }catch(e){}
    }

    return new Promise(function(resolve){
      function finish(){
        if(finished) return;
        finished = true;
        _activeLoad = null;
        files = results.filter(Boolean);
        resolve(files);
      }
      _activeLoad = {
        finishNow: function(){
          if(finished) return;
          var readersNow = readers.slice();
          finish(); // 先標記結束，下面abort觸發的事件就不會再改到結果
          if(typeof ImageShrink !== 'undefined') ImageShrink.clearQueue(); // 還在排隊等縮圖的也不等了
          readersNow.forEach(function(r){ try{ if(r.readyState === 1) r.abort(); }catch(e){} });
        }
      };
      if(!total){ finish(); return; }
      report();
      images.forEach(function(f, i){
        var reader = new FileReader();
        readers.push(reader);
        function settle(result){
          if(finished || settled[i]) return;
          settled[i] = true;
          results[i] = result;
          loaded[i] = f.size || loaded[i];
          done++;
          report();
          if(done >= total) finish();
        }
        reader.onprogress = function(e){
          if(finished || settled[i] || !e.lengthComputable) return;
          loaded[i] = e.loaded;
          report();
        };
        reader.onload = function(){
          if(finished || settled[i]) return;
          var ext = (f.name.match(/\.([a-zA-Z0-9]+)$/)||[,'png'])[1].toLowerCase();
          loaded[i] = f.size || loaded[i];
          report();
          shrinkIfNeeded(reader.result).then(function(dataUrl){
            settle({ name:f.name, normalized: normalizeName(f.name), ext:ext, dataUrl: dataUrl });
          });
        };
        reader.onerror = function(){ settle(null); };
        reader.onabort = function(){ settle(null); };
        reader.readAsDataURL(f);
      });
    });
  }

  /* 放棄還沒讀完的檔案，用已經讀完的繼續（見loadFileList上面的說明）。
     沒有正在進行的讀取時什麼都不做。 */
  function finishNow(){
    if(_activeLoad) _activeLoad.finishNow();
  }

  function list(){ return files.slice(); }
  function clear(){ files = []; }
  function isLoaded(){ return files.length > 0; }

  /* 依標準化後的名稱找檔案，可能同時比對到多個（例如同名 .jpg/.png 兩個
     版本），全部回傳讓呼叫端決定怎麼處理（見 asset-matcher.js 的取捨規則）。*/
  function findAllByNormalized(normalized){
    if(!normalized) return [];
    return files.filter(function(f){ return f.normalized === normalized; });
  }

  return {
    normalizeName: normalizeName,
    loadZip: loadZip,
    loadFileList: loadFileList,
    finishNow: finishNow,
    list: list,
    clear: clear,
    isLoaded: isLoaded,
    findAllByNormalized: findAllByNormalized
  };
})();
