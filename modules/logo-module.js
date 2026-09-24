'use strict';
/*
  logo-module.js
  ------------------------------------------------------------
  LOGO：位置/尺寸基準來自 cfg.logoZone，實際顯示範圍依 slot.logoShape 決定
  （見 effectiveZone()）：'wide'(沿用版位橫版寬度) | 'square'(置中正方形)。

  三種顯示模式（slot.logoMode）：
    'original' —— 原圖，contain置中
    'fill'     —— 滿版填滿：cover-fit塞滿整個範圍
    'trim'     —— 裁切＋色底：跟前兩者不一樣，是「固定的膠囊色塊」＋
                  「在色塊裡可以自由捲動/縮放的LOGO原圖」，兩者分開處理：
                    - 色塊（形狀/大小/顏色）永遠固定＝整個範圍(effectiveZone)
                      的膠囊形狀，套用 slot.logoBgColor
                    - LOGO原圖(slot.logoRaw，不是烤好的合成圖！)可以用滾輪/
                      拖曳自由調整在色塊裡的位置跟大小(slot.logoOffsetX/Y/
                      logoScale)，色塊本身完全不會被使用者的縮放/拖曳影響
                  第一次切成trim模式時，會自動偵測LOGO的「有內容範圍」
                  （裁掉透明留白）跟建議底色，算出一個看起來置中/填滿的
                  初始縮放，之後使用者自己調整過就不會再被覆蓋。

  互動：點一下LOGO會出現選取框，可以拖曳移動、滾輪縮放、拖右下角控制點
  縮放。main畫面小格子跟放大編輯畫面共用同一套邏輯跟同一份slot資料。
  圖片載入結果快取在 slot.__lmCache，其他欄位改變不會重新載入圖片。
*/
window.Modules = window.Modules || {};
window.Modules.logo = {

  HANDLE_R: 8,
  FIT_RATIO: 0.82, // trim模式下，偵測到的內容框預設縮放時留的呼吸空間

  /* 依 slot.logoShape 算出這一格LOGO實際可用的範圍（畫布絕對座標）。 */
  effectiveZone: function(cfg, slot){
    var z = Modules.logo._baseZone(cfg, slot);
    if(slot.logoShape === 'square'){
      var side = Math.min(z.w, z.h);
      return { x: z.x + (z.w-side)/2, y: z.y + (z.h-side)/2, w: side, h: side };
    }
    return z;
  },

  /* 掛標關閉時（slot.tagVariant==='off'，見editor-import.js的Excel「無」判斷
     或使用者手動關掉），LOGO維持原本logoZone的寬高不變，水平移動去置中
     ——等於往左移動，填補掉關掉的掛標留下的空間。水平置中要用「整張卡片」
     (cfg.blockRect)的寬度當基準，不能用掛標+LOGO兩個原本範圍加起來的寬度
     算：這兩個範圍在卡片裡本來就不是對稱的（掛標貼齊卡片左邊、LOGO右邊
     離卡片邊緣還留了一截空白），拿它們加起來的寬度置中，置中出來的結果
     一樣會偏移，要對齊卡片本身才會是視覺上真的正中間。垂直方向維持原本
     logoZone的y、再往下微調 CENTER_SHIFT_DOWN_PX（視覺上置中後你覺得再
     往下一點點比較好看，已跟你確認過的px數）。沒有tagZone的格子（例如
     中間）或掛標還開著時，維持原本的logoZone不動。 */
  CENTER_SHIFT_DOWN_PX: 4,

  _baseZone: function(cfg, slot){
    var z = cfg.logoZone;
    if(!cfg.tagZone || slot.tagVariant !== 'off') return z;
    var card = cfg.blockRect || z;
    return { x: card.x + (card.w-z.w)/2, y: z.y + Modules.logo.CENTER_SHIFT_DOWN_PX, w: z.w, h: z.h };
  },

  /* 三種模式各自的「基準縮放」算法：'fill'用cover-fit、'trim'用內容框
     contain-fit再乘FIT_RATIO留呼吸空間、'original'用內容框contain-fit。
     都是拿「偵測到的內容框」(contentW/H，見_detectLogoContent)當基準，
     不是整張圖的原始尺寸——PNG四周常有透明留白，拿「整張圖」當基準會讓
     logo本體看起來偏一邊、填不滿範圍（已跟你確認過的bug）；還沒偵測過時
     由呼叫端(_computeLogoFit)退回用整張圖尺寸當基準。_computeLogoFit跟
     _detectLogoContent(算初始置中位移時)共用同一套，兩邊算出來的比例
     才會一致。 */
  _baseScaleForMode: function(mode, zoneW, zoneH, contentW, contentH){
    if(mode === 'fill') return Math.max(zoneW/contentW, zoneH/contentH);
    if(mode === 'trim') return Modules.logo.FIT_RATIO * Math.min(zoneW/contentW, zoneH/contentH);
    return Math.min(zoneW/contentW, zoneH/contentH);
  },

  /* 算出LOGO原圖在zone本地座標系(0,0=zone左上角)裡的實際繪製矩形，疊上
     logoScale倍率跟logoOffsetX/Y位移。 */
  _computeLogoFit: function(img, zoneW, zoneH, slot){
    var contentW = slot.__logoContentW || img.width;
    var contentH = slot.__logoContentH || img.height;
    var baseScale = Modules.logo._baseScaleForMode(slot.logoMode, zoneW, zoneH, contentW, contentH);
    var scale = baseScale * (slot.logoScale || 1);
    var drawW = img.width*scale, drawH = img.height*scale;
    var centerX = zoneW/2 + (slot.logoOffsetX||0)*zoneW;
    var centerY = zoneH/2 + (slot.logoOffsetY||0)*zoneH;
    return { drawX: centerX-drawW/2, drawY: centerY-drawH/2, drawW:drawW, drawH:drawH, centerX:centerX, centerY:centerY };
  },

  /* 掃描圖片找「有內容(不透明)」的範圍，順便抓底色建議值。三種顯示模式都會
     呼叫這支（不只trim）——PNG四周常有透明留白，不管哪種模式都要照實際
     內容框去算縮放/置中，才不會「整張圖」含留白一起被當基準，導致logo
     看起來偏一邊或填不滿範圍。只在第一次換了新的logoRaw時才會重算
     （slot.__trimInitFor記錄目前這份計算結果是對應哪個logoRaw，換圖或
     還沒算過才重算），算完之後使用者自己調整logoScale/Offset就不會再被
     蓋掉。 */
  _detectLogoContent: function(slot, zoneW, zoneH, cb){
    if(slot.__trimInitFor === slot.logoRaw && slot.__logoContentW){ cb(); return; }
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function(){
      try{
        var SCAN = 300;
        var sc = Math.min(1, SCAN / Math.max(img.naturalWidth, img.naturalHeight));
        var sw = Math.max(1, Math.round(img.naturalWidth*sc)), sh = Math.max(1, Math.round(img.naturalHeight*sc));
        var c = document.createElement('canvas'); c.width=sw; c.height=sh;
        var cctx = c.getContext('2d');
        cctx.drawImage(img, 0, 0, sw, sh);
        var d = cctx.getImageData(0,0,sw,sh).data;
        var x0=sw,y0=sh,x1=0,y1=0,found=false,thresh=10;
        for(var y=0;y<sh;y++){
          for(var x=0;x<sw;x++){
            if(d[(y*sw+x)*4+3] > thresh){
              if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; found=true;
            }
          }
        }
        if(!found){ x0=0;y0=0;x1=sw-1;y1=sh-1; }
        var contentW = (x1-x0+1)/sw*img.naturalWidth;
        var contentH = (y1-y0+1)/sh*img.naturalHeight;
        var contentCx = (x0+x1+1)/2/sw*img.naturalWidth;
        var contentCy = (y0+y1+1)/2/sh*img.naturalHeight;

        // 底色建議：PNG(有透明背景)固定白色；非PNG(例如JPG，本來就沒有透明
        // 背景、四周一定是某個實色)吸取「四邊」(不是四個角的單一像素點)的
        // 底色平均，比較不會被邊角剛好一小塊留白影響。
        // 2026-09修бug：這裡原本只在slot.logoBgColor還沒設過值時才會抓色
        // (if(!slot.logoBgColor))，導致「換了一張新LOGO圖」時，如果這一格
        // 之前已經有底色（不管是舊圖留下的白色、還是舊圖抓到的邊緣色），
        // 新圖永遠不會重新偵測、只會繼續沿用舊值——你反映的「換成JPG還是
        // 白底、沒有自動吸四周顏色」就是這裡造成的。這個if本身是多餘的：
        // 這整段本來就只在「換了新的logoRaw、還沒偵測過」時才會跑到
        // (上面有__trimInitFor===slot.logoRaw的判斷擋掉重複偵測)，所以
        // 底色本來就該跟著每一次換圖重新判斷，不用另外判斷「有沒有值」。
        var isPNG = /^data:image\/png/i.test(slot.logoRaw) || /\.png($|\?)/i.test(slot.logoRaw);
        slot.logoBgColor = isPNG ? '#ffffff' : Modules.logo._sampleEdgeColor(img);

        // 存「內容框的原圖尺寸」，不是存算好的縮放值——縮放值每次渲染時
        // 用當下zone的實際大小現算(見_computeLogoFit)，main畫面/放大編輯
        // 視窗才會維持同樣的比例。
        slot.__logoContentW = contentW;
        slot.__logoContentH = contentH;
        // 用「當下這個模式」的基準縮放去算初始置中位移，跟_computeLogoFit
        // 實際渲染時用同一套算法(_baseScaleForMode)，才不會算出來的置中
        // 位移跟畫面上真正用的縮放對不起來。
        var fitScale = Modules.logo._baseScaleForMode(slot.logoMode, zoneW, zoneH, contentW, contentH);
        var contentOffsetFullX = (contentCx - img.naturalWidth/2) * fitScale;
        var contentOffsetFullY = (contentCy - img.naturalHeight/2) * fitScale;
        slot.logoOffsetX = -contentOffsetFullX/zoneW;
        slot.logoOffsetY = -contentOffsetFullY/zoneH;
        slot.logoScale = 1;
        slot.__trimInitFor = slot.logoRaw;
      }catch(e){
        console.warn('[logo-module] 偵測LOGO內容框失敗，改用整張圖預設', e);
        slot.__logoContentW = img.naturalWidth;
        slot.__logoContentH = img.naturalHeight;
        slot.__trimInitFor = slot.logoRaw;
      }
      cb();
    };
    img.onerror = function(){ slot.__trimInitFor = slot.logoRaw; cb(); };
    img.src = slot.logoRaw;
  },

  /* 強制白色：把LOGO整個變成白色剪影(保留原本的透明形狀，實心部分全部
     填白)——用source-in合成技巧，不需要另外準備白色版的圖檔。快取在
     slot.__logoWhiteCanvas上，key是原圖來源，圖片沒換就不用重算。
     JPG(沒有透明背景，整張都是不透明矩形)套用這個效果只會變成一整塊白色
     矩形——這是本來就沒有去背資料的先天限制，不是bug，通常「強制白色」
     本來就該搭配PNG去背的LOGO使用才有意義。 */
  _getWhiteVersion: function(slot, img, srcKey){
    if(slot.__logoWhiteCanvas && slot.__logoWhiteFor === srcKey) return slot.__logoWhiteCanvas;
    var c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    var cctx = c.getContext('2d');
    cctx.drawImage(img, 0, 0, c.width, c.height);
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, c.width, c.height);
    slot.__logoWhiteCanvas = c;
    slot.__logoWhiteFor = srcKey;
    return c;
  },

  /* 統一的畫LOGO邏輯：一般模式直接畫原圖，強制白色時改畫白色剪影版本，
     兩處(互動預覽)呼叫這支都是同一套邏輯，不會有一邊套用一邊沒套用。 */
  _drawLogoImage: function(ctx, slot, img, srcKey, dx, dy, dw, dh){
    var src = slot.logoForceWhite ? Modules.logo._getWhiteVersion(slot, img, srcKey) : img;
    ctx.drawImage(src, dx, dy, dw, dh);
  },

  buildDom: function(el, slot, cfg, originX, originY, scale, onChange, onRequestPick, onSelect){
    var zone = Modules.logo.effectiveZone(cfg, slot);
    var box = document.createElement('div');
    box.className = 'zone-box logo-zone';
    Core.applyZoneStyle(box, zone, originX, originY, scale);
    el.appendChild(box);

    if(!slot.logoSrc){
      box.innerHTML = '<span class="ph">LOGO</span>';
      box.onclick = function(){ if(onSelect) onSelect(); onRequestPick(); };
      return;
    }

    Modules.logo._detectLogoContent(slot, zone.w, zone.h, function(){
      Modules.logo._buildInteractive(box, slot, zone, scale, onRequestPick, onChange, onSelect);
    });
  },

  _buildInteractive: function(box, slot, zone, scale, onRequestPick, onChange, onSelect){
    var boxW = zone.w*scale, boxH = zone.h*scale;
    var canvas = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boxW*dpr); canvas.height = Math.round(boxH*dpr);
    canvas.style.width = boxW+'px'; canvas.style.height = boxH+'px';
    canvas.style.cursor = 'grab';
    box.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); // 後面所有畫圖座標維持邏輯像素(boxW/boxH)，這行讓它吃滿實際裝置解析度

    var img = null, lastFit = null, drag = null;
    function selected(){ return !!slot.__lmSelected; }

    function redraw(){
      ctx.clearRect(0,0,boxW,boxH);

      if(slot.logoMode === 'trim'){
        // 固定的膠囊色塊：形狀/大小/顏色完全不受使用者拖曳/縮放影響，
        // 一律是整個範圍(zone)的膠囊形狀。
        ctx.save();
        Modules.logo._roundRectPath(ctx, 0, 0, boxW, boxH, boxH/2);
        ctx.fillStyle = slot.logoBgColor || '#ffffff';
        ctx.fill();
        ctx.clip(); // LOGO原圖只會在膠囊範圍內看得到，色塊本身不會被蓋住/改變
        if(img){
          var fit = Modules.logo._computeLogoFit(img, boxW, boxH, slot);
          lastFit = fit;
          Modules.logo._drawLogoImage(ctx, slot, img, slot.logoRaw, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
        }
        ctx.restore();
      } else {
        if(!img) return;
        var fit2 = Modules.logo._computeLogoFit(img, boxW, boxH, slot);
        lastFit = fit2;
        ctx.save();
        ctx.beginPath(); ctx.rect(0,0,boxW,boxH); ctx.clip();
        Modules.logo._drawLogoImage(ctx, slot, img, slot.logoSrc, fit2.drawX, fit2.drawY, fit2.drawW, fit2.drawH);
        ctx.restore();
      }

      if(!selected() || !lastFit) return;
      var fit = lastFit;
      ctx.save();
      ctx.strokeStyle = '#EE4D2D';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5,3]);
      ctx.strokeRect(fit.drawX, fit.drawY, fit.drawW, fit.drawH);
      ctx.restore();

      var hx = fit.drawX+fit.drawW, hy = fit.drawY+fit.drawH;
      ctx.save();
      ctx.beginPath();
      ctx.arc(hx, hy, Modules.logo.HANDLE_R, 0, Math.PI*2);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    function loadImage(){
      var src = (slot.logoMode === 'trim') ? slot.logoRaw : slot.logoSrc;
      var cache = slot.__lmCache;
      if(cache && cache.src === src && cache.img){
        img = cache.img;
        redraw();
        return;
      }
      var im = new Image();
      im.onload = function(){
        img = im;
        slot.__lmCache = { src: src, img: im };
        redraw();
      };
      im.onerror = function(){
        box.innerHTML = '<span class="ph">LOGO圖片找不到（資料庫路徑還沒放檔案，需手動上傳/選擇）</span>';
      };
      im.src = src;
    }
    loadImage();

    function pointerPos(e){
      var rect = canvas.getBoundingClientRect();
      return { x:(e.clientX-rect.left) * (boxW/rect.width), y:(e.clientY-rect.top) * (boxH/rect.height) };
    }

    canvas.addEventListener('pointerdown', function(e){
      if(!lastFit) return;
      var p = pointerPos(e);

      if(!selected()){
        slot.__lmSelected = true;
        slot.__pmSelected = false; // 換選logo，商品圖那邊的選取狀態要跟著清掉，不然商品圖會卡在「已選取」，之後點商品圖不會再觸發onSelect，畫面看起來像沒反應(這是你反映的bug)
        redraw();
        if(onSelect) onSelect();
        // 商品圖canvas是獨立的畫布，不會因為這裡redraw()自動跟著更新，商品圖
        // 上舊的選取框會卡著繼續顯示——呼叫onChange()讓外層整個重畫一次，
        // 兩邊選取外框才會同步(onChange本來就是「狀態變了、重畫」的既有機制，
        // 不用另外加新的溝通管道)。
        if(onChange) onChange();
        return;
      }

      var hx = lastFit.drawX+lastFit.drawW, hy = lastFit.drawY+lastFit.drawH;
      if(Math.hypot(p.x-hx, p.y-hy) <= Modules.logo.HANDLE_R*1.8){
        var curScale = slot.logoScale||1;
        drag = {
          mode:'resize', anchorX: lastFit.centerX, anchorY: lastFit.centerY,
          unitHalfW: (lastFit.drawW/2)/curScale, unitHalfH: (lastFit.drawH/2)/curScale
        };
        canvas.style.cursor = 'nwse-resize';
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      var f = lastFit;
      if(p.x>=f.drawX && p.x<=f.drawX+f.drawW && p.y>=f.drawY && p.y<=f.drawY+f.drawH){
        drag = { mode:'move', startX:p.x, startY:p.y, startOffX:(slot.logoOffsetX||0), startOffY:(slot.logoOffsetY||0) };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
      } else {
        slot.__lmSelected = false;
        redraw();
      }
    });
    canvas.addEventListener('pointermove', function(e){
      if(!drag) return;
      var p = pointerPos(e);
      if(drag.mode === 'move'){
        slot.logoOffsetX = drag.startOffX + (p.x-drag.startX)/boxW;
        slot.logoOffsetY = drag.startOffY + (p.y-drag.startY)/boxH;
      } else if(drag.mode === 'resize'){
        var scaleFromW = (p.x-drag.anchorX) / drag.unitHalfW;
        var scaleFromH = (p.y-drag.anchorY) / drag.unitHalfH;
        slot.logoScale = Math.max(0.3, (scaleFromW+scaleFromH)/2);
      }
      redraw();
    });
    function endDrag(){
      if(drag){ drag = null; canvas.style.cursor = 'grab'; if(onChange) onChange(); }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('wheel', function(e){
      if(!selected()) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.08 : 0.08;
      slot.logoScale = Math.max(0.3, (slot.logoScale||1) + delta);
      redraw();
      if(onChange) onChange();
    }, { passive:false });
  },

  /* trim模式不再「烤圖」——直接沿用原圖(logoRaw)當logoSrc，色塊+裁切效果
     改在渲染時即時合成（見_buildInteractive/drawExport），這樣使用者才能
     事後自由調整LOGO在色塊裡的位置/大小，不會被鎖死成一張固定的合成圖。 */
  applyProcessing: function(slot, cb){
    if(!slot.logoRaw){ slot.logoSrc = null; cb(); return; }
    slot.logoSrc = slot.logoRaw;
    cb();
  },

  /* 吸取「四邊」底色（不是四個角的單一像素）：沿著上下左右四條邊，各取
     一排內縮一點點的取樣點（避免剛好卡到邊緣鋸齒/壓縮雜訊），取中位數
     當底色——中位數比平均值更不容易被LOGO圖案剛好貼到某一邊的情況拉歪。 */
  _sampleEdgeColor: function(img){
    try{
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      var insetX = Math.max(1, Math.round(w*0.02));
      var insetY = Math.max(1, Math.round(h*0.02));
      var N = 12;
      var rs = [], gs = [], bs = [];
      function sample(x, y){
        x = Math.max(0, Math.min(w-1, Math.round(x)));
        y = Math.max(0, Math.min(h-1, Math.round(y)));
        var d = ctx.getImageData(x, y, 1, 1).data;
        rs.push(d[0]); gs.push(d[1]); bs.push(d[2]);
      }
      for(var i=0;i<N;i++){
        var t = i/(N-1);
        sample(insetX + t*(w-2*insetX), insetY);          // 上緣
        sample(insetX + t*(w-2*insetX), h-1-insetY);       // 下緣
        sample(insetX, insetY + t*(h-2*insetY));           // 左緣
        sample(w-1-insetX, insetY + t*(h-2*insetY));       // 右緣
      }
      function median(arr){
        arr = arr.slice().sort(function(a,b){ return a-b; });
        var m = Math.floor(arr.length/2);
        return arr.length%2 ? arr[m] : Math.round((arr[m-1]+arr[m])/2);
      }
      return 'rgb('+median(rs)+','+median(gs)+','+median(bs)+')';
    }catch(e){ return '#ffffff'; }
  },

  _roundRectPath: function(ctx,x,y,w,h,r){
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  },

  drawExport: function(ctx, cfg, slot, originX, originY, done){
    if(!slot.logoSrc){ done(); return; }
    var zone = Modules.logo.effectiveZone(cfg, slot);
    var zx = zone.x-originX, zy = zone.y-originY;

    function draw(img){
      ctx.save();
      if(slot.logoMode === 'trim'){
        Modules.logo._roundRectPath(ctx, zx, zy, zone.w, zone.h, zone.h/2);
        ctx.fillStyle = slot.logoBgColor || '#ffffff';
        ctx.fill();
        ctx.clip();
      } else {
        ctx.beginPath();
        ctx.rect(zx, zy, zone.w, zone.h);
        ctx.clip();
      }
      var fit = Modules.logo._computeLogoFit(img, zone.w, zone.h, slot);
      Modules.logo._drawLogoImage(ctx, slot, img, (slot.logoMode==='trim'?slot.logoRaw:slot.logoSrc), zx+fit.drawX, zy+fit.drawY, fit.drawW, fit.drawH);
      ctx.restore();
      done();
    }

    // 匯出時務必先確定內容框已經偵測過(slot.__logoContentW)，若這一格還
    // 沒被畫過(例如剛匯入還沒展開看過畫面)，先做一次偵測，確保匯出結果
    // 跟預覽一致的比例（baseScale是現算的，見_computeLogoFit）。三種模式
    // 都要偵測，不只trim——理由同_computeLogoFit上面的註解。
    Modules.logo._detectLogoContent(slot, zone.w, zone.h, function(){
      var img = new Image();
      img.onload = function(){ draw(img); };
      img.onerror = done;
      img.src = (slot.logoMode === 'trim') ? slot.logoRaw : slot.logoSrc;
    });
  }
};
