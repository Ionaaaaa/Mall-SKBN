'use strict';
/*
  editor-popups.js
  ------------------------------------------------------------
  「匯入工單」彈窗：跟你另一個 krcb 專案同一套UX——Excel工單 + 素材資料夾
  兩個dropzone，可以點擊選擇也可以直接拖曳，確認匯入後跑現有的
  resolveAndApplyBanners() 自動比對流程。

  素材資料夾這一格刻意「zip / 資料夾都吃」：
    - 拖進來/選到的是一個 .zip 檔 → 走 BatchAssets.loadZip()
    - 拖進來/選到的是資料夾本身（webkitdirectory點擊，或直接拖曳整個
      資料夾）→ 走 BatchAssets.loadFileList()
  兩條路徑最後產生的檔案清單格式完全一樣，後面的比對邏輯不用分是哪一種來源。

  拖曳資料夾的遞迴讀取（readEntryFilesRecursive/readDroppedItems）是從
  krcb專案原封不動搬過來的通用瀏覽器API邏輯，跟這個專案的比對邏輯完全無關，
  可以放心共用。
*/

function closePopup(){
  var el = document.getElementById('popup-overlay');
  if(el) el.remove();
}

function createOverlay(innerHTML){
  closePopup();
  var overlay = document.createElement('div');
  overlay.id = 'popup-overlay';
  overlay.className = 'popup-overlay';
  overlay.innerHTML = innerHTML;
  // 點背景深色區域不會關閉popup——只能用×或明確按鈕關閉，避免匯入到一半誤觸就中斷。
  document.body.appendChild(overlay);
  return overlay;
}

/* ══════════════════ 匯入工單彈窗（Excel + 素材資料夾 雙上傳） ══════════════════ */

var ICON_FILE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 1.5h5L12 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z"/><path d="M9 1.5V5h3"/></svg>';
var ICON_FOLDER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/></svg>';

var _importState = { excelFile:null, folderFiles:[] };

function openImportModal(){
  _importState = { excelFile:null, folderFiles:[] };

  var overlay = createOverlay(
    '<div class="popup-panel" style="width:440px;">'+
      '<div class="popup-head"><span>匯入工單</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body">'+

        '<div id="zone-excel" class="dropzone">'+
          '<div class="dropzone-icon">'+ICON_FILE+'</div>'+
          '<div id="zone-excel-title">拖曳 Excel 工單到這裡</div>'+
          '<div class="hint" style="margin-top:4px;">或點擊選擇檔案</div>'+
        '</div>'+

        '<div id="zone-folder" class="dropzone" style="margin-top:14px;">'+
          '<div class="dropzone-icon">'+ICON_FOLDER+'</div>'+
          '<div id="zone-folder-title">上傳這批素材資料夾（LOGO／曝品，可選）</div>'+
          '<div class="hint" style="margin-top:4px;">拖曳整個資料夾或zip都可以，也可以點擊選擇資料夾</div>'+
        '</div>'+

      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="confirm-import-btn">確認匯入</button>'+
      '</div>'+
    '</div>'
  );

  var zoneExcel = overlay.querySelector('#zone-excel');
  var zoneFolder = overlay.querySelector('#zone-folder');
  var excelInput = document.getElementById('excel-import');
  var folderInput = document.getElementById('folder-import');

  zoneExcel.onclick = function(){ excelInput.click(); };
  zoneFolder.onclick = function(){ folderInput.click(); };

  function markExcelChosen(file){
    _importState.excelFile = file;
    zoneExcel.querySelector('#zone-excel-title').textContent = '已選擇：'+file.name;
    zoneExcel.classList.add('dropzone-success');
  }
  function markFolderChosen(files){
    _importState.folderFiles = files;
    var imgCount = files.filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); }).length;
    zoneFolder.querySelector('#zone-folder-title').textContent = '已讀取 '+imgCount+' 張素材圖片';
    zoneFolder.classList.add('dropzone-success');
  }

  bindDropzone(zoneExcel, function(file){ markExcelChosen(file); });

  excelInput.onchange = function(){
    var f = excelInput.files[0];
    if(f) markExcelChosen(f);
    excelInput.value = '';
  };

  folderInput.onchange = function(){
    var files = Array.prototype.slice.call(folderInput.files);
    if(files.length) markFolderChosen(files);
    folderInput.value = '';
  };

  // 拖曳整個資料夾、或直接拖一個zip檔進來，都算「素材資料夾」這一格。
  bindFolderOrZipDropzone(zoneFolder, zoneFolder.querySelector('#zone-folder-title'), function(files){
    markFolderChosen(files);
  }, function(zipFile){
    _importState.zipFile = zipFile;
    zoneFolder.querySelector('#zone-folder-title').textContent = '已選擇 zip：'+zipFile.name;
    zoneFolder.classList.add('dropzone-success');
  });

  overlay.querySelector('#confirm-import-btn').onclick = function(){
    var btn = this;
    if(btn.disabled) return; // 防止連點觸發兩次
    if(!_importState.excelFile){ alert('請先選擇工單 Excel 檔案。'); return; }
    btn.disabled = true;

    createOverlay(
      '<div class="popup-panel" style="width:320px;">'+
        '<div class="popup-body" style="text-align:center;padding:32px 16px;">'+
          '<div class="hint" style="margin:0;">匯入中，請稍候…</div>'+
        '</div>'+
      '</div>'
    );
    runImportFlow(_importState.excelFile, _importState.folderFiles, _importState.zipFile);
  };
}

/* 確認匯入後真正跑的流程：先把素材資料夾/zip讀進 BatchAssets，再解析Excel，
   最後跑 resolveAndApplyBanners() 自動比對，完成後關掉popup、回到主畫面並
   顯示警示清單（沿用 editor-main.js 既有的 renderAll()/STATE.warnings）。 */
function runImportFlow(excelFile, folderFiles, zipFile){
  var loadBatch = zipFile ? BatchAssets.loadZip(zipFile)
    : (folderFiles && folderFiles.length ? BatchAssets.loadFileList(folderFiles) : Promise.resolve([]));

  loadBatch.catch(function(err){
    console.error(err);
    alert('素材資料夾/zip讀取失敗，先略過素材比對，只匯入Excel文字內容。');
    return [];
  }).then(function(){
    handleExcelFile(excelFile, function(banners){
      STATE.banners = banners;
      STATE.warnings = [];
      closePopup();
      renderAll();
      resolveAndApplyBanners(STATE.banners, function(warnings){
        STATE.warnings = warnings;
        renderAll();
      });
    }, function(msg){
      closePopup();
      alert(msg);
    });
  });
}

function bindDropzone(zone, onFile){
  ['dragenter','dragover'].forEach(function(evt){
    zone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.add('dropzone-active'); });
  });
  ['dragleave','drop'].forEach(function(evt){
    zone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.remove('dropzone-active'); });
  });
  zone.addEventListener('drop', function(e){
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if(file) onFile(file);
  });
}

/* ══════════════════ 拖曳上傳素材資料夾（跟krcb專案同一套遞迴讀取邏輯） ══════════════════
   點擊選資料夾（<input webkitdirectory>）跟拖曳資料夾走的是兩套完全不同的
   瀏覽器API：前者瀏覽器自動幫你走訪整個資料夾、攤平成完整檔案清單；後者要
   自己用 DataTransferItem.webkitGetAsEntry() 拿到 FileSystemEntry，再自己
   寫遞迴一層層爬。這裡就是那段自己爬的邏輯（含巢狀子資料夾、多個item）。 */

function readEntryFilesRecursive(entry, out, done){
  if(!entry){ done(); return; }
  if(entry.isFile){
    entry.file(function(file){
      out.push(file);
      done();
    }, function(err){
      console.warn('[拖曳上傳] 讀取檔案失敗，已跳過：'+entry.fullPath, err);
      done();
    });
    return;
  }
  if(entry.isDirectory){
    var reader = entry.createReader();
    var allEntries = [];
    function readBatch(){
      reader.readEntries(function(batch){
        if(!batch.length){
          if(!allEntries.length){ done(); return; }
          var pending = allEntries.length;
          allEntries.forEach(function(childEntry){
            readEntryFilesRecursive(childEntry, out, function(){
              pending--;
              if(pending<=0) done();
            });
          });
          return;
        }
        allEntries = allEntries.concat(batch);
        readBatch();
      }, function(err){
        console.warn('[拖曳上傳] 讀取子資料夾失敗，已跳過：'+entry.fullPath, err);
        done();
      });
    }
    readBatch();
    return;
  }
  done();
}

function readDroppedItems(items, onDone){
  var files = [];
  var list = Array.prototype.slice.call(items || []);
  if(!list.length){ onDone(files); return; }

  var pending = list.length;
  function oneDone(){
    pending--;
    if(pending<=0) onDone(files);
  }

  list.forEach(function(item){
    if(item.kind !== 'file'){ oneDone(); return; }
    var entry = (typeof item.webkitGetAsEntry === 'function') ? item.webkitGetAsEntry() : null;
    if(entry){
      readEntryFilesRecursive(entry, files, oneDone);
    } else {
      var f = item.getAsFile && item.getAsFile();
      if(f) files.push(f);
      oneDone();
    }
  });
}

/* 資料夾/zip共用的dropzone：拖進來的東西如果單一個檔案且是.zip，直接走
   onZip(file)；否則當作資料夾（一個或多個檔案/巢狀子資料夾）走onFiles(files)。*/
function bindFolderOrZipDropzone(zone, titleEl, onFiles, onZip){
  var defaultTitle = titleEl.textContent;
  ['dragenter','dragover'].forEach(function(evt){
    zone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.add('dropzone-active'); });
  });
  zone.addEventListener('dragleave', function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.remove('dropzone-active'); });
  zone.addEventListener('drop', function(e){
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('dropzone-active');

    var dt = e.dataTransfer;
    if(!dt) return;

    // 拖進來的剛好是單一個.zip檔（沒有items API可用的環境，或就是簡單拖一個檔案）
    var flat = dt.files ? Array.prototype.slice.call(dt.files) : [];
    if(flat.length === 1 && /\.zip$/i.test(flat[0].name)){ onZip(flat[0]); return; }

    if(!dt.items || !dt.items.length){
      if(!flat.length){
        alert('沒有偵測到拖曳的檔案，請改用點擊選擇資料夾。');
        return;
      }
      onFiles(flat);
      return;
    }

    titleEl.textContent = '讀取中…';
    readDroppedItems(dt.items, function(files){
      if(files.length === 1 && /\.zip$/i.test(files[0].name)){ onZip(files[0]); return; }
      var imageFiles = files.filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); });
      if(!files.length){
        alert('這個資料夾裡沒有讀到任何檔案，瀏覽器可能不支援拖曳資料夾，請改用點擊選擇資料夾。');
        titleEl.textContent = defaultTitle;
        return;
      }
      onFiles(files);
    });
  });
}
