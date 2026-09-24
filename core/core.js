'use strict';
/*
  core.js —— 調度核心
  ------------------------------------------------------------
  真實版型是「一張 1200x360 白底畫布，裡面疊三張各自導圓角的卡片（左中右），
  卡片位置/尺寸、LOGO/掛標/CTA/商品/主標文字 各自的座標，全部來自
  configs/skbn-layout.js（window.SKBN_LAYOUT），這支檔案完全不寫死任何數字。

  提供組裝方式：
    buildBannerStage()：main畫面用，一次畫出整張1200x360（縮小顯示），
    三個卡片都在同一個舞台裡，跟實際輸出視覺一致。商品/LOGO直接在這個畫面
    上就能拖曳/縮放/旋轉；點版位右下角的小圖示會另外開「放大編輯」視窗
    （buildBlockStage()）處理品牌/主標文字/背景色/陰影角度等其餘設定。

  匯出（renderBannerToCanvas）畫的也是同一張1200x360白底 + 三張圓角卡片，
  每張卡片用 clip 限制範圍，圖片/文字都不會畫出卡片圓角之外。
*/
var Core = (function(){

  var SLOT_KEYS = ['left','mid','right'];

  function layoutFor(key){ return SKBN_LAYOUT.slots[key]; }

  /* 把一個 zone(x,y,w,h，畫布絕對座標) 換算成某個容器內的絕對定位樣式。
     originX/originY = 這個容器對應到畫布座標系的左上角在哪裡（main畫面是0,0；
     放大modal是該卡片blockRect的x,y，因為modal只顯示這張卡片自己的座標系）。
     scale = 顯示縮放倍率。 */
  function applyZoneStyle(el, zone, originX, originY, scale){
    el.style.position = 'absolute';
    el.style.left = ((zone.x - originX) * scale) + 'px';
    el.style.top = ((zone.y - originY) * scale) + 'px';
    el.style.width = (zone.w * scale) + 'px';
    el.style.height = (zone.h * scale) + 'px';
  }

  /* 組一張卡片(一個version:left/mid/right)的DOM內容，塞進呼叫端準備好的容器(el)裡。
     el 必須已經是「這張卡片」大小的容器（呼叫端負責定位/裁圓角）。
     originX/originY/scale：見 applyZoneStyle。 */
  function buildSlotContent(el, slot, key, originX, originY, scale, hooks){
    hooks = hooks || {};
    var cfg = layoutFor(key);
    var onChange = hooks.onChange || function(){};
    // 分開成三個各自的onSelect(而不是共用一個)，是因為放大編輯視窗要知道
    // 使用者點的到底是logo/商品/掛標的哪一個，才能自動切換左側對應的分頁
    // （見editor-main.js）；main畫面沒有分頁概念，不傳這幾個hook也完全
    // 沒差(預設是no-op)。
    var onSelectLogo = hooks.onSelectLogo || function(){};
    var onSelectProduct = hooks.onSelectProduct || function(){};
    var onSelectTag = hooks.onSelectTag || function(){};

    Modules.background.buildDom(el, slot, cfg, onChange, hooks.expanded);

    Modules.logo.buildDom(el, slot, cfg, originX, originY, scale, onChange, function(){
      (hooks.onRequestLogoPick || function(){})();
    }, onSelectLogo);

    if(cfg.tagZone){
      Modules.tag.buildDom(el, slot, cfg, originX, originY, scale, onChange, onSelectTag);
    }

    Modules.product.buildDom(el, slot, cfg, originX, originY, scale, onChange, function(){
      (hooks.onRequestProductPick || function(){})();
    }, onSelectProduct);

    Modules.cta.buildDom(el, slot, cfg, originX, originY, scale, onChange);

    Modules.text.buildDom(el, slot, cfg, originX, originY, scale, onChange);
  }

  /* main畫面：一次畫出整張1200x360白底舞台（縮小顯示），三張卡片都在裡面。
     stageWidthPx：舞台顯示寬度(px)，決定縮放倍率；高度依畫布比例自動算。
     onExpand(key) 由呼叫端決定「點放大」要做什麼（開modal）。 */
  function buildBannerStage(banner, stageWidthPx, hooks){
    hooks = hooks || {};
    var scale = stageWidthPx / SKBN_LAYOUT.canvas.w;
    var stage = document.createElement('div');
    stage.className = 'banner-stage';
    stage.style.width = stageWidthPx + 'px';
    stage.style.height = (SKBN_LAYOUT.canvas.h * scale) + 'px';

    SLOT_KEYS.forEach(function(key){
      var cfg = layoutFor(key);
      var slot = banner[key];
      var block = document.createElement('div');
      block.className = 'block';
      var r = cfg.blockRect;
      block.style.left = (r.x*scale)+'px';
      block.style.top = (r.y*scale)+'px';
      block.style.width = (r.w*scale)+'px';
      block.style.height = (r.h*scale)+'px';
      block.style.borderRadius = (r.radius*scale)+'px';

      // 注意：zone-box 是塞進 block 裡面的子元素，block 自己就是
      // position:absolute（=它的子元素的定位基準點），所以這裡的原點
      // 一定要傳「這張卡片自己的 blockRect.x/y」，不能傳 0,0——
      // 0,0 只有在 zone-box 是直接掛在整張1200畫布容器下面時才對。
      buildSlotContent(block, slot, key, r.x, r.y, scale, {
        onChange: hooks.onChange,
        onRequestLogoPick: function(){ (hooks.onRequestPick||function(){})(key,'logo'); },
        onRequestProductPick: function(){ (hooks.onRequestPick||function(){})(key,'product'); },
        // main畫面同時顯示好幾個banner、每個banner又有三格，「選取一個就把
        // 其他全部取消選取」這件事牽涉到「別的slot」，logo/product模組自己
        // 只知道自己這一格的slot，不知道其他banner的存在，所以這裡把slot
        // 本身也傳出去，交給呼叫端(editor-main.js)決定怎麼清掉別的slot。
        onSelectLogo: function(){ (hooks.onSelectLogo||function(){})(slot); },
        onSelectProduct: function(){ (hooks.onSelectProduct||function(){})(slot); }
      });

      var expandBtn = document.createElement('button');
      expandBtn.className = 'expand-btn';
      expandBtn.title = '放大編輯這一格';
      expandBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>';
      expandBtn.onclick = function(e){ e.stopPropagation(); (hooks.onExpand||function(){})(key); };
      block.appendChild(expandBtn);

      stage.appendChild(block);
    });

    return stage;
  }

  /* 放大編輯modal：只顯示一張卡片，用卡片自己的寬高當顯示尺寸(可再乘一個放大倍率)。 */
  function buildBlockStage(slot, key, displayScaleMul, hooks){
    hooks = hooks || {};
    var cfg = layoutFor(key);
    var r = cfg.blockRect;
    var scale = (displayScaleMul || 1);
    var block = document.createElement('div');
    block.className = 'block block-modal';
    block.style.width = (r.w*scale)+'px';
    block.style.height = (r.h*scale)+'px';
    block.style.borderRadius = (r.radius*scale)+'px';

    buildSlotContent(block, slot, key, r.x, r.y, scale, {
      onChange: hooks.onChange,
      expanded: true,
      onRequestLogoPick: hooks.onRequestLogoPick,
      onRequestProductPick: hooks.onRequestProductPick,
      onSelectLogo: hooks.onSelectLogo,
      onSelectProduct: hooks.onSelectProduct,
      onSelectTag: hooks.onSelectTag
    });

    return block;
  }

  function roundRectPath(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  /* 匯出一組 banner（left/mid/right）成一張 1200x360 canvas，畫完呼叫 cb(canvas)。
     ⚠ 三張卡片是各自畫在「獨立的暫存canvas」上（座標系用卡片自己的0,0，
     不是整張畫布的絕對座標），畫完才貼回主畫布——刻意不用「同一個ctx輪流
     save()/clip()/restore()」，因為三張卡片的圖片是非同步載入，主ctx的
     save/restore是一個堆疊，三張卡片同時在跑的話，先restore的不一定是
     先save的那個，會把裁切範圍搞混。各自獨立的暫存canvas就不會有這個問題。
     暫存canvas本身還沒畫到的地方是透明的，貼回主畫布時，白底畫布會透出來，
     圓角以外的部分自然就是白的，不用另外做圓角遮罩。 */
  /* 匯出解析度倍率：邏輯版面還是1200x360，但實際輸出的圖檔是這個倍率放大
     （預設2倍=2400x720），LOGO/商品這種細節多的素材才會夠銳利。你說過
     檔案可以大一點沒關係，只要清晰——這裡就是拿檔案大小換清晰度的地方，
     要調整倍率只要改這個數字，其餘程式碼都不用動(全部用邏輯座標畫圖，
     這裡統一ctx.scale()放大)。 */
  var EXPORT_SCALE = 2;

  function renderBannerToCanvas(banner, cb){
    var W = SKBN_LAYOUT.canvas.w, H = SKBN_LAYOUT.canvas.h;
    var canvas = document.createElement('canvas');
    canvas.width = W*EXPORT_SCALE; canvas.height = H*EXPORT_SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    var remainSlots = SLOT_KEYS.length;
    SLOT_KEYS.forEach(function(key){
      var cfg = layoutFor(key);
      var slot = banner[key];
      var r = cfg.blockRect;

      var tmp = document.createElement('canvas');
      tmp.width = r.w*EXPORT_SCALE; tmp.height = r.h*EXPORT_SCALE;
      var tctx = tmp.getContext('2d');
      tctx.scale(EXPORT_SCALE, EXPORT_SCALE);

      tctx.save();
      roundRectPath(tctx, 0, 0, r.w, r.h, r.radius);
      tctx.clip();

      Modules.background.drawExport(tctx, cfg, slot, r.x, r.y);

      // 依序畫（不是同時平行），確保疊放順序穩定：LOGO/掛標 → 商品 → CTA。
      // 之前是平行非同步(forEach同時發射)，實際畫的順序取決於圖片載入完成的
      // 先後，不是陣列順序——商品圖上傳後常常比CTA晚完成載入，反而蓋掉CTA。
      // 依序執行(前一步done()了才執行下一步)才能保證CTA一定畫在商品上面。
      var steps = [
        function(next){ Modules.logo.drawExport(tctx, cfg, slot, r.x, r.y, next); },
        function(next){ if(cfg.tagZone) Modules.tag.drawExport(tctx, cfg, slot, r.x, r.y, next); else next(); },
        function(next){ Modules.product.drawExport(tctx, cfg, slot, r.x, r.y, next); },
        function(next){ Modules.cta.drawExport(tctx, cfg, slot, r.x, r.y, next); }
      ];
      var stepIdx = 0;
      function runNextStep(){
        if(stepIdx >= steps.length){ finishSlot(); return; }
        var step = steps[stepIdx++];
        step(runNextStep);
      }
      runNextStep();

      function finishSlot(){
        Modules.text.drawExport(tctx, cfg, slot, r.x, r.y);
        tctx.restore();
        ctx.drawImage(tmp, r.x, r.y, r.w, r.h); // 明確指定目的地邏輯尺寸，跟tmp實際的高解析度像素數對得起來
        remainSlots--;
        if(remainSlots === 0) cb(canvas);
      }
    });
  }

  return {
    SLOT_KEYS: SLOT_KEYS,
    layoutFor: layoutFor,
    applyZoneStyle: applyZoneStyle,
    buildBannerStage: buildBannerStage,
    buildBlockStage: buildBlockStage,
    renderBannerToCanvas: renderBannerToCanvas
  };
})();
