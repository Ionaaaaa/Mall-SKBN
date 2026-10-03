'use strict';
/*
  image-shrink.js
  ------------------------------------------------------------
  圖片進到編輯器之前先縮小（2026-10）。

  為什麼需要：BD丟圖區的原圖常常非常大（實際量過 5000×5000 的 PNG、
  10697×6766 的 JPG），但編輯器裡最大的作圖區只有 462×214，輸出放大2倍也
  只需要大約 924×428。原本是整張原圖轉成dataURL存進slot、每次重畫都從原圖
  縮下來畫，結果：
    - 拖曳時每動一下滑鼠都要把幾千px的原圖重畫一次（還要再算一次陰影）
    - 一張5000×5000的圖解開後佔約95MB記憶體，強制白色還會再多一張同樣大的
    - 還原紀錄比對、草稿存檔都要處理十幾MB的字串
  所以整份工單匯入後編輯會卡。

  做法：長邊超過 MAX_SIDE 的圖，等比例縮到長邊 = MAX_SIDE 再存；沒超過的
  原封不動（不重新壓縮、不改格式）。
    - JPG 縮完還是 JPG（品質0.92）；其他格式(PNG/WebP)縮完一律存成 PNG，
      去背的透明背景會保留
    - GIF/SVG 不處理（GIF可能是動圖，SVG是向量圖）
    - 讀不出來、縮圖失敗 → 直接用原圖，不會因為縮圖把整個流程卡掉
  一次只處理一張（排隊），避免好幾張大圖同時解開把記憶體吃光。

  用的地方：這批素材資料夾/zip（batch-assets.js）、手動上傳（editor-state.js
  的 Assets.pickImage）。資料庫裡的固定素材（system-elements/、artwork/）
  是用路徑載入的，不經過這裡。
*/
var ImageShrink = (function(){
  // 長邊上限。輸出最大只需要約924px，1600留了一些餘裕給放大/裁切。
  var MAX_SIDE = 1600;
  var JPEG_QUALITY = 0.92;

  var queue = [], busy = false;

  function shrinkDataUrl(dataUrl, cb){
    queue.push({ dataUrl: dataUrl, cb: cb });
    pump();
  }

  function pump(){
    if(busy) return;
    var job = queue.shift();
    if(!job) return;
    busy = true;
    run(job.dataUrl, function(out){
      busy = false;
      try{ job.cb(out); }catch(e){ console.error(e); }
      pump();
    });
  }

  /* 把還在排隊、還沒開始處理的全部丟掉（它們的callback不會被呼叫）。給
     「不等了，先用已讀完的素材匯入」用，見batch-assets.js的finishNow。 */
  function clearQueue(){ queue = []; }

  function run(dataUrl, done){
    if(typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0){ done(dataUrl); return; }
    if(/^data:image\/(gif|svg)/i.test(dataUrl)){ done(dataUrl); return; }
    var img = new Image();
    img.onload = function(){
      var w = img.naturalWidth, h = img.naturalHeight;
      var longSide = Math.max(w, h);
      if(!longSide || longSide <= MAX_SIDE){ done(dataUrl); return; }
      try{
        var sc = MAX_SIDE / longSide;
        var tw = Math.max(1, Math.round(w*sc)), th = Math.max(1, Math.round(h*sc));
        var c = document.createElement('canvas');
        c.width = tw; c.height = th;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, tw, th);
        var isJpeg = /^data:image\/jpe?g/i.test(dataUrl);
        var out = isJpeg ? c.toDataURL('image/jpeg', JPEG_QUALITY) : c.toDataURL('image/png');
        done((out && out.indexOf('data:image/') === 0 && out.length > 100) ? out : dataUrl);
      }catch(e){
        console.warn('[image-shrink] 縮圖失敗，改用原圖', e);
        done(dataUrl);
      }
    };
    img.onerror = function(){ done(dataUrl); };
    img.src = dataUrl;
  }

  return { shrinkDataUrl: shrinkDataUrl, clearQueue: clearQueue, MAX_SIDE: MAX_SIDE };
})();
