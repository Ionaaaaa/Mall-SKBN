'use strict';
/*
  product-module.js
  ------------------------------------------------------------
  曝品（商品圖）：位置/尺寸基準來自 cfg.artZone，實際錨點再疊上使用者微調的
  位置(slot.productOffsetX/Y)、縮放(slot.productScale)、旋轉(slot.productRot，角度)。

  ⚠ 圖片載入/輪廓註冊快取在 slot.__pmCache 上（key是productSrc），其他欄位
  改變重新渲染不會重新載入圖片，不會閃爍/跳動。main畫面小格子跟放大編輯
  畫面共用同一套互動邏輯(拖曳/縮放/旋轉/滾輪)，同一份slot資料兩邊同步。
  選取框/控制點預設不顯示，點一下商品本體才出現(slot.__pmSelected)。

  ⚠ 2026-09 新增：選取框四個角都可以拖曳縮放（不再只有右上角），還可以
  旋轉（選取框上方會多一個旋轉把手）。四個角的縮放邏輯是「拖哪個角、對角
  的角固定住」的標準做法（跟PowerPoint/Canva一樣），旋轉是繞著選取框中心
  轉，商品照片才會旋轉，陰影固定不跟著轉（陰影引擎本來就是這樣設計，見
  js/shadow-plugin.js的說明）。旋轉時的拖曳判定是先把滑鼠座標「反向旋轉」
  回商品本體沒轉之前的座標系，其餘判定邏輯完全不用因為旋轉而改寫。

  商品影子：slot.shadowAngle 四選一 'off'|'left'|'top'|'right'，物理效果
  完全沿用 js/shadow-plugin.js 那套引擎，商品本體一定自己手動畫，不假手
  ShadowPlugin，陰影開關/角度切換不會讓商品位置跳動。
*/
window.Modules = window.Modules || {};
window.Modules.product = {

  FIT_RATIO: 0.846,
  HANDLE_R: 6,
  ROTATE_HANDLE_R: 5,

  /* 券樣類素材（slot.materialTexts有值時，例如商城券*1配"$100"）：文字疊在
     券圖上一塊或多塊「看不見的文字範圍」(boxes，來自
     configs/material-text-style.js)裡，自動找出「剛好塞得進這個範圍」的
     最大字級——字數多自動縮小、字數少自動放大。多張券疊圖（例如商城券*2）
     每張券自己的位置各有一個box，同一段文字會分別畫進每一個box裡（跟你
     的設計稿一致：前後兩張券各自有自己的文字範圍跟旋轉角度）。
     $、%、折這幾個字會用比主要數字小一點的字級(symbolScale)，而且用同一條
     基線對齊（不是用置中對齊）——不然字級不同時，中文字型的置中點位置
     不一樣，符號看起來會忽高忽低。 */
  _drawMaterialText: function(ctx, slot, img, drawX, drawY, drawW, drawH){
    if(!slot.materialTexts || !slot.materialTexts.length) return;
    var style = (window.MATERIAL_TEXT_STYLE && window.MATERIAL_TEXT_STYLE.get)
      ? window.MATERIAL_TEXT_STYLE.get(slot.materialType)
      : { boxes:[{xRatio:0.31,yRatio:0.20,wRatio:0.59,hRatio:0.60,rotateDeg:0}], color:'#d0011b', fontWeight:700, symbolScale:0.72 };

    var boxes = style.boxes || [style]; // 向下相容：舊格式(單一box欄位直接寫在style上)也吃得下
    boxes.forEach(function(boxDef, i){
      // 換了種類、框變多了，還沒個別填過文字的框先沿用第一個框的文字，
      // 不會是空的——使用者可以再自己去改成不一樣的內容。
      var text = (slot.materialTexts[i] != null) ? slot.materialTexts[i] : slot.materialTexts[0];
      // 2026-09：畫出來的數字自動加千分位($1000 → $1,000)，輸入框裡的原始
      // 文字不動，使用者照原本方式輸入就好。
      if(text) text = Modules.product._formatThousands(Modules.product._autoCurrencySymbol(text));
      if(text) Modules.product._drawOneMaterialTextBox(ctx, text, style, boxDef, drawX, drawY, drawW, drawH);

      // 2026-09：boxDef.maskAfter = { points:[{xRatio,yRatio},...] }——這張券
      // (後方那張)的文字有一部分被前方的券擋住，畫完文字後，用券圖原圖把
      // 這個多邊形範圍疊回去，前方券的券面就會蓋住被擋住的那部分文字。
      // 一定要在「下一張券的文字」畫出來之前處理，前方券自己的文字才不會
      // 被這個遮罩蓋掉。多邊形座標是相對券圖本身寬高的比例(0~1)。
      if(boxDef.maskAfter && img){
        Modules.product._repaintPolygonRegion(ctx, img, boxDef.maskAfter.points, drawX, drawY, drawW, drawH);
      }

      // 畫完這張券的文字之後，如果後面還有下一張券，先把「下一張券自己的
      // 文字範圍」用券圖原圖清乾淨一次，這樣這張券的文字絕對不會蓋到下
      // 一張券要畫文字的地方——保護範圍直接用下一張券自己的box座標(我們
      // 本來就精確知道)，不用另外量一個獨立的遮罩範圍，也不會像之前
      // 手動量的範圍不小心把自己的文字蓋掉。
      var nextBox = boxes[i+1];
      if(nextBox && img){
        Modules.product._repaintBoxRegion(ctx, img, nextBox, drawX, drawY, drawW, drawH);
      }
    });
  },

  /* 2026-09：券樣文字如果「只有數字」(可帶千分位逗號/小數點，後面可接「起」)，
     沒有寫折、%、蝦幣、$ 這些單位，就當作是現金金額，畫的時候自動在前面補
     「$」(100→$100、1000→$1,000、500起→$500起)。只影響畫出來的結果，輸入框裡
     的原始文字不動，跟千分位是同一個做法。像「買1送1」「滿500折50」「8折」
     「500蝦幣」「免運」這種不是純數字的一律原樣，不會被亂加。 */
  _autoCurrencySymbol: function(text){
    var s = String(text).trim();
    return /^\d[\d,]*(?:\.\d+)?起?$/.test(s) ? '$' + s : text;
  },

  /* 千分位：連續數字加逗號(1000→1,000、1234567→1,234,567)；小數點後面的
     數字不動(1234.5678→1,234.5678)，已經有逗號的(1,000)每一段都不到4位
     數，不會被重複處理。$、%、折、蝦幣等非數字文字原樣保留。 */
  _formatThousands: function(text){
    return String(text).replace(/\d+(?:\.\d+)?/g, function(m){
      var p = m.split('.');
      p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return p.join('.');
    });
  },

  /* 把券圖原圖疊回一個多邊形範圍(maskAfter.points)——用來把「被前方券擋
     住的那部分文字」蓋回去。points是相對券圖寬高的比例座標。 */
  _repaintPolygonRegion: function(ctx, img, points, drawX, drawY, drawW, drawH){
    if(!points || points.length < 3) return;
    ctx.save();
    ctx.beginPath();
    points.forEach(function(p, k){
      var px = drawX + p.xRatio*drawW, py = drawY + p.yRatio*drawH;
      if(k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();
  },

  /* 把券圖原圖疊回某個box自己的(旋轉後的)矩形範圍——用來在畫下一張券的
     文字之前，先確保它要用的範圍是乾淨的、沒有被上一張券的文字蓋到。 */
  _repaintBoxRegion: function(ctx, img, boxDef, drawX, drawY, drawW, drawH){
    var cx = drawX + boxDef.xRatio*drawW + boxDef.wRatio*drawW/2;
    var cy = drawY + boxDef.yRatio*drawH + boxDef.hRatio*drawH/2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((boxDef.rotateDeg||0) * Math.PI/180);
    ctx.beginPath();
    ctx.rect(-boxDef.wRatio*drawW/2, -boxDef.hRatio*drawH/2, boxDef.wRatio*drawW, boxDef.hRatio*drawH);
    ctx.clip();
    // clip()已經把裁切範圍定住了(旋轉後的矩形)，接下來要轉回原本角度再畫
    // 原圖，這樣券圖本身不會跟著被畫歪，只有「看得到的範圍」是旋轉的。
    ctx.rotate(-(boxDef.rotateDeg||0) * Math.PI/180);
    ctx.translate(-cx, -cy);
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();
  },

  // 這幾個字/詞在券樣疊字裡要縮小一點畫（symbolScale控制縮小到多少倍）。
  // 「蝦」「幣」拆成兩個單字登記（不是合成一個"蝦幣"詞），比較簡單、之後
  // 這兩個字不管單獨出現在哪裡都會一起套用縮小規則。要加新的字/詞直接
  // 加進這個陣列就好（可以是單一字元，也可以是多字元的詞，底下的拆解
  // 邏輯兩種都吃得下），不用改其他程式碼。
  SYMBOL_TOKENS: ['蝦', '幣', '$', '%', '折'],

  // 自動縮放時故意不把box塞到滿版，留一點呼吸空間，不然字級抓到極限值會
  // 貼著框邊緣、看起來很擠（跟你確認過"字可以小一點/放大倍率少一點"）。
  MATERIAL_TEXT_FILL_RATIO: 0.85,

  /* 把文字拆成「符號段」跟「一般段」——逐字掃描，每個位置先檢查SYMBOL_TOKENS
     裡有沒有詞剛好從這裡開始匹配(最長優先，如果之後加了多字元的詞，
     要整組一起比對到，不能被拆成單字分開判斷)，符合就整個詞當一段跳過去；不符合就當
     一般文字，逐字累加到目前這段。 */
  _tokenizeMaterialText: function(text){
    var tokens = Modules.product.SYMBOL_TOKENS.slice().sort(function(a,b){ return b.length-a.length; });
    var segments = [];
    var i = 0;
    while(i < text.length){
      var matched = null;
      for(var t=0;t<tokens.length;t++){
        if(text.substr(i, tokens[t].length) === tokens[t]){ matched = tokens[t]; break; }
      }
      if(matched){
        if(segments.length && segments[segments.length-1].isSymbol){
          segments[segments.length-1].text += matched;
        } else {
          segments.push({ text: matched, isSymbol: true });
        }
        i += matched.length;
      } else {
        var ch = text[i];
        if(segments.length && !segments[segments.length-1].isSymbol){
          segments[segments.length-1].text += ch;
        } else {
          segments.push({ text: ch, isSymbol: false });
        }
        i += 1;
      }
    }
    return segments;
  },

  _drawOneMaterialTextBox: function(ctx, text, style, boxDef, drawX, drawY, drawW, drawH){
    var fullBox = {
      x: drawX + boxDef.xRatio*drawW,
      y: drawY + boxDef.yRatio*drawH,
      w: boxDef.wRatio*drawW,
      h: boxDef.hRatio*drawH
    };
    var fillRatio = Modules.product.MATERIAL_TEXT_FILL_RATIO;
    // 實際拿來「算字級」的box比顯示範圍小一點(fillRatio)，字才不會頂到邊緣；
    // 但「裁切範圍(clip)」還是用完整的fullBox——這是兩件不同的事：clip是
    // 保證文字絕對不會超出這個範圍畫到別的券上面(即使自動縮放算錯也一樣)，
    // fillRatio是讓算出來的字級本身就留一點餘裕、不要頂滿。
    var box = { x:fullBox.x, y:fullBox.y, w:fullBox.w*fillRatio, h:fullBox.h*fillRatio };
    box.x += (fullBox.w - box.w)/2;
    box.y += (fullBox.h - box.h)/2;

    // 拆成「符號段」跟「一般段」，符號段($、%、折、蝦、幣)用比較小的字級畫
    var segments = Modules.product._tokenizeMaterialText(text);

    var fontWeight = style.fontWeight || 700;
    var symbolScale = style.symbolScale || 1;
    var fontFamily = '"ShopeeNoto", "Noto Sans TC", sans-serif';

    function totalWidthAt(fontSize){
      var total = 0;
      segments.forEach(function(seg){
        var segSize = seg.isSymbol ? fontSize*symbolScale : fontSize;
        ctx.font = fontWeight+' '+segSize+'px '+fontFamily;
        total += ctx.measureText(seg.text).width;
      });
      return total;
    }

    var lo = 4, hi = box.h*1.4, best = lo;
    for(var iter=0; iter<20; iter++){
      var mid = (lo+hi)/2;
      var w = totalWidthAt(mid);
      if(w <= box.w && mid <= box.h){ best = mid; lo = mid; } else { hi = mid; }
    }

    // 主要字級(非符號段裡最大的那個，通常就是主要數字)的ascent/descent決定
    // 共用基線要放在哪裡，才能讓「整段文字的視覺範圍」剛好置中在box裡——
    // 全部用alphabetic基線畫、共用同一條基線，符號段字級雖然比較小，
    // 也會自然對齊在同一條基線上，不會有的高有的低。
    ctx.font = fontWeight+' '+best+'px '+fontFamily;
    var m = ctx.measureText('0'); // 用數字'0'量高度基準，比較穩定(不受實際文字內容的標點/字元差異影響)
    var ascent = (m.actualBoundingBoxAscent != null) ? m.actualBoundingBoxAscent : best*0.72;
    var descent = (m.actualBoundingBoxDescent != null) ? m.actualBoundingBoxDescent : best*0.14;
    var baselineY = (ascent - descent) / 2;

    var cx = fullBox.x + fullBox.w/2, cy = fullBox.y + fullBox.h/2;
    var totalW = totalWidthAt(best);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((boxDef.rotateDeg||0) * Math.PI/180);

    // 裁切在這一個框自己的(旋轉後的)矩形範圍內——不管自動縮放算出來的字級
    // 多大，文字都不可能畫出這個範圍去蓋到另一張券上面(這是你反映「第二張
    // 券的文字要能被遮住」的直接解法：與其精算另一張券的實際輪廓，不如
    // 保證自己絕對不超出自己的文字範圍)。
    ctx.beginPath();
    ctx.rect(-fullBox.w/2, -fullBox.h/2, fullBox.w, fullBox.h);
    ctx.clip();

    // 每個box可以自己指定color覆蓋掉style的共用顏色(例如「全站券*1+商城券*1」
    // 這種混合品牌的疊圖，兩張券要分開上色：全站橘/商城紅)，沒指定的box
    // 才照style的顏色畫，兩種情境都吃得下，不用把color硬性搬到box層級。
    ctx.fillStyle = boxDef.color || style.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    var curX = -totalW/2;
    segments.forEach(function(seg){
      var segSize = seg.isSymbol ? best*symbolScale : best;
      ctx.font = fontWeight+' '+segSize+'px '+fontFamily;
      var w = ctx.measureText(seg.text).width;
      ctx.fillText(seg.text, curX, baselineY);
      curX += w;
    });
    ctx.restore();
  },

  buildDom: function(el, slot, cfg, originX, originY, scale, onChange, onRequestPick, onSelect){
    var box = document.createElement('div');
    box.className = 'zone-box product-zone';
    Core.applyZoneStyle(box, cfg.artZone, originX, originY, scale);
    el.appendChild(box);
    Modules.product._buildInteractive(box, slot, cfg, scale, onRequestPick, onChange, onSelect);
  },

  /* 2026-09 改版：商品預設現在是「上下左右都置中」（之前只有水平置中，垂直
     是固定貼在接近底部94%的位置，很多長寬比的商品因此看起來偏下）。
     anchorX/anchorY現在代表「有色內容(tight box)的正中心」，不再是「貼地
     基準點」——貼地的y座標(給陰影用)另外算成groundY(=tight box的底邊)，
     不會因為改成置中就讓陰影變得沒有貼地感：陰影還是照tight box實際的
     底邊位置畫，只是「商品預設放哪裡」這件事改成置中，兩者分開處理。 */
  _computeFit: function(img, boxW, boxH, slot, trim){
    trim = trim || { top:0, bottom:0, left:0, right:0 };
    var fullW = img.width, fullH = img.height;
    var tightWRatio = Math.max(0.02, 1 - trim.left - trim.right);
    var tightHRatio = Math.max(0.02, 1 - trim.top - trim.bottom);
    var tightW0 = fullW * tightWRatio, tightH0 = fullH * tightHRatio;

    var fitRatio = Modules.product.FIT_RATIO * (slot.productScale || 1);
    var s = Math.min(boxW*fitRatio/tightW0, boxH*fitRatio/tightH0);

    var drawW = fullW*s, drawH = fullH*s;
    var anchorX = boxW/2 + (slot.productOffsetX||0) * boxW;
    var anchorY = boxH/2 + (slot.productOffsetY||0) * boxH;

    var contentCenterXFull = fullW * (trim.left + (1-trim.right)) / 2;
    var contentCenterYFull = fullH * (trim.top + (1-trim.bottom)) / 2;

    var drawX = anchorX - contentCenterXFull*s;
    var drawY = anchorY - contentCenterYFull*s;

    var tight = {
      x: drawX + trim.left*fullW*s,
      y: drawY + trim.top*fullH*s,
      w: tightW0*s,
      h: tightH0*s
    };

    return {
      x:anchorX, y:anchorY, w:drawW, h:drawH,
      drawX:drawX, drawY:drawY, drawW:drawW, drawH:drawH,
      tight: tight,
      groundY: tight.y + tight.h // 有色內容的實際底邊，陰影/接地效果用這個當基準，不是anchorY
    };
  },

  /* 商品/素材放進去的規則（已跟你確認過）：
     1. 預設不用放到全滿，但要撐到做圖區的指定高度(FIT_RATIO=0.90)，然後
        上下左右都置中放置。
     2. "有色範圍"(tight box，不含透明留白)真的會碰到CTA圓形才處理，不是
        用猜的去預先假設（細長型商品常常根本不會碰到，猜的話反而誤判）。
     3. 真的撞到才處理，順序是：先試著「只位移」剛好清開CTA；如果只位移
        會讓商品被推出畫布另一側，才「整體縮小」到剛好塞進(CTA跟畫布邊緣
        之間的)可用空間，並置中放在那個空間裡——縮小跟位移一起發生，不是
        縮小完全部商品都變超小，而是縮到剛好夠、不多不少。
     只在第一次載入這張圖時呼叫一次（見loadImage），不會蓋掉使用者事後
     自己調整過的位置/縮放。 */
  _maybeAvoidCta: function(slot, cfg, boxW, boxH, scale, img, trim){
    if(slot.productOffsetX) return;
    if(!cfg.ctaZone || !cfg.artZone) return;

    var az = cfg.artZone, cz = cfg.ctaZone;
    var czLocal = { x:(cz.x-az.x)*scale, y:(cz.y-az.y)*scale, w:cz.w*scale, h:cz.h*scale };

    var hypothetical = { productOffsetX:0, productOffsetY: slot.productOffsetY||0, productScale: slot.productScale||1 };
    var fit = Modules.product._computeFit(img, boxW, boxH, hypothetical, trim);
    var t = fit.tight;

    var margin = 6*scale;
    var overlapsX = (t.x < czLocal.x+czLocal.w+margin) && (t.x+t.w > czLocal.x-margin);
    var overlapsY = (t.y < czLocal.y+czLocal.h+margin) && (t.y+t.h > czLocal.y-margin);
    if(!overlapsX || !overlapsY) return; // 有色範圍根本沒碰到CTA，維持置中，不要動

    var czCenterX = czLocal.x + czLocal.w/2;
    var pushLeft = czCenterX > boxW/2; // CTA在右邊就往左推，反之往右推
    var leftEdgeMargin = 25*scale;  // 左邊最後不能直接貼邊，至少留25px（跟你確認過）
    var rightEdgeMargin = 15*scale; // 右邊維持原本15px，不用加大

    if(pushLeft){
      var availableW = czLocal.x - margin - leftEdgeMargin; // 畫布左邊(留25px)到CTA左邊(扣margin)的可用寬度
      var neededShift = (t.x+t.w) - (czLocal.x - margin);
      var newLeftEdge = t.x - neededShift;
      if(newLeftEdge >= leftEdgeMargin){
        // 只位移就清得開，而且離左邊還有安全距離——不用縮小
        slot.productOffsetX = -neededShift/boxW;
      } else {
        // 位移不夠(或會貼太近左邊)，縮小到剛好塞進可用空間，置中放好
        var shrinkFactor = Math.max(0.3, availableW / t.w);
        slot.productScale = (slot.productScale||1) * shrinkFactor;
        slot.productOffsetX = (leftEdgeMargin + availableW/2 - boxW/2) / boxW;
      }
    } else {
      var availableW2 = boxW - (czLocal.x+czLocal.w+margin) - rightEdgeMargin;
      var neededShift2 = (czLocal.x+czLocal.w+margin) - t.x;
      var newRightEdge = t.x+t.w + neededShift2;
      if(newRightEdge <= boxW-rightEdgeMargin){
        slot.productOffsetX = neededShift2/boxW;
      } else {
        var shrinkFactor2 = Math.max(0.3, availableW2 / t.w);
        slot.productScale = (slot.productScale||1) * shrinkFactor2;
        var windowCenterX = boxW - rightEdgeMargin - availableW2/2;
        slot.productOffsetX = (windowCenterX - boxW/2) / boxW;
      }
    }
  },

  _rotatePoint: function(x, y, cx, cy, deg){
    var rad = deg*Math.PI/180;
    var dx = x-cx, dy = y-cy;
    return { x: cx+dx*Math.cos(rad)-dy*Math.sin(rad), y: cy+dx*Math.sin(rad)+dy*Math.cos(rad) };
  },

  _buildInteractive: function(box, slot, cfg, scale, onRequestPick, onChange, onSelect){
    if(!slot.productSrc){
      box.innerHTML = '<span class="ph">曝品（點擊上傳）</span>';
      box.onclick = function(){ if(onSelect) onSelect(); onRequestPick(); };
      return;
    }
    var z = cfg.artZone;
    var boxW = z.w*scale, boxH = z.h*scale;
    var canvas = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boxW*dpr); canvas.height = Math.round(boxH*dpr);
    canvas.style.width = boxW+'px'; canvas.style.height = boxH+'px';
    canvas.style.cursor = 'grab';
    box.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); // 後面所有畫圖座標維持邏輯像素(boxW/boxH)不用改，這行讓它自動吃滿實際裝置解析度

    var img = null, registeredId = null, trim = null, lastFit = null, drag = null;
    var rotate = Modules.product._rotatePoint;

    function shadowOn(){ return !!(slot.shadowAngle && slot.shadowAngle !== 'off'); }
    function selected(){ return !!slot.__pmSelected; }
    function rot(){ return slot.productRot||0; }
    function pivot(fit){ var t=fit.tight; return { x:t.x+t.w/2, y:t.y+t.h/2 }; }

    function redraw(){
      ctx.clearRect(0,0,boxW,boxH);
      ctx.fillStyle = slot.bgColor || '#333';
      ctx.fillRect(0,0,boxW,boxH);
      if(!img) return;
      var fit = Modules.product._computeFit(img, boxW, boxH, slot, trim);
      lastFit = fit;
      var pv = pivot(fit);

      if(shadowOn() && registeredId){
        ShadowPlugin.setAngle(slot.shadowAngle);
        var shx = fit.x + (slot.shadowOffsetX||0)*boxW;
        var shy = fit.groundY + (slot.shadowOffsetY||0)*boxH;
        ShadowPlugin.renderScene(ctx, [{ id:registeredId, x:shx, y:shy, w:fit.w, h:fit.h }], true);
      }

      // 商品照片＋券樣文字：繞著選取框中心旋轉（陰影不轉，維持貼地）
      ctx.save();
      ctx.translate(pv.x, pv.y); ctx.rotate(rot()*Math.PI/180); ctx.translate(-pv.x, -pv.y);
      ctx.drawImage(img, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
      Modules.product._drawMaterialText(ctx, slot, img, fit.drawX, fit.drawY, fit.drawW, fit.drawH);
      ctx.restore();

      if(!selected()) return;

      var t = fit.tight;
      ctx.save();
      ctx.translate(pv.x, pv.y); ctx.rotate(rot()*Math.PI/180); ctx.translate(-pv.x, -pv.y);

      ctx.strokeStyle = '#EE4D2D';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6,4]);
      ctx.strokeRect(t.x, t.y, t.w, t.h);
      ctx.setLineDash([]);

      // 旋轉把手：選取框正上方一小段連線
      var handleOffset = Math.max(18, boxH*0.08);
      ctx.beginPath();
      ctx.moveTo(pv.x, t.y);
      ctx.lineTo(pv.x, t.y - handleOffset);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pv.x, t.y - handleOffset, Modules.product.ROTATE_HANDLE_R, 0, Math.PI*2);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.fill(); ctx.stroke();

      // 四個角的縮放控制點
      var corners = [[t.x,t.y],[t.x+t.w,t.y],[t.x,t.y+t.h],[t.x+t.w,t.y+t.h]];
      corners.forEach(function(c){
        ctx.beginPath();
        ctx.arc(c[0], c[1], Modules.product.HANDLE_R, 0, Math.PI*2);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1.5;
        ctx.fill(); ctx.stroke();
      });
      ctx.restore();
      // 陰影位置改用放大編輯視窗右側的滑桿調整（見editor-main.js），不再是
      // 畫布上一個獨立的小黑點——版位上同時有縮放控制點、旋轉把手、陰影
      // 把手，太多控制點擠在一起反而不好點準。
    }

    function loadImage(){
      var cache = slot.__pmCache;
      if(cache && cache.src === slot.productSrc && cache.img){
        img = cache.img; trim = cache.trim; registeredId = cache.id;
        redraw();
        return;
      }
      var im = new Image();
      im.onload = function(){
        img = im;
        var oldId = registeredId;
        registeredId = 'pm_'+Math.random().toString(36).slice(2);
        ShadowPlugin.registerProduct(registeredId, img, 'product').then(function(){
          trim = (ShadowPlugin._products[registeredId]||{}).trim;
          if(oldId) ShadowPlugin.removeProduct(oldId);
          slot.__pmCache = { src: slot.productSrc, img: img, trim: trim, id: registeredId };
          Modules.product._maybeAvoidCta(slot, cfg, boxW, boxH, scale, img, trim);
          redraw();
        });
      };
      im.src = slot.productSrc;
    }
    loadImage();

    function pointerPos(e){
      var rect = canvas.getBoundingClientRect();
      // 用邏輯尺寸(boxW/boxH)換算，不要用canvas.width/height——那個現在是
      // 乘上devicePixelRatio的實際緩衝區大小，跟畫圖用的邏輯座標系不是同一套。
      return { x:(e.clientX-rect.left) * (boxW/rect.width), y:(e.clientY-rect.top) * (boxH/rect.height) };
    }

    canvas.addEventListener('pointerdown', function(e){
      if(!lastFit) return;
      var raw = pointerPos(e);
      var pv = pivot(lastFit);
      var r = rot();
      var local = rotate(raw.x, raw.y, pv.x, pv.y, -r); // 反向旋轉，換算回商品本體沒轉之前的座標系

      if(!selected()){
        var t0 = lastFit.tight;
        if(local.x>=t0.x && local.x<=t0.x+t0.w && local.y>=t0.y && local.y<=t0.y+t0.h){
          slot.__pmSelected = true;
          slot.__lmSelected = false; // 換選商品圖，logo那邊的選取狀態要跟著清掉，理由同logo-module.js的對稱處理
          redraw();
          if(onSelect) onSelect();
          if(onChange) onChange(); // logo是獨立畫布，讓外層整個重畫一次讓logo的選取外框也同步消失，理由同logo-module.js
        }
        return;
      }

      var t = lastFit.tight;
      var handleOffset = Math.max(18, boxH*0.08);
      var rotHandleScreen = rotate(pv.x, t.y-handleOffset, pv.x, pv.y, r);
      if(Math.hypot(raw.x-rotHandleScreen.x, raw.y-rotHandleScreen.y) <= Modules.product.ROTATE_HANDLE_R*1.8){
        drag = { mode:'rotate', pivot:pv, startAngle:r, startPointerAngle: Math.atan2(raw.y-pv.y, raw.x-pv.x)*180/Math.PI };
        canvas.style.cursor = 'grab';
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      var cornerDefs = [
        { key:'tl', x:t.x,     y:t.y     },
        { key:'tr', x:t.x+t.w, y:t.y     },
        { key:'bl', x:t.x,     y:t.y+t.h },
        { key:'br', x:t.x+t.w, y:t.y+t.h }
      ];
      for(var i=0;i<cornerDefs.length;i++){
        var c = cornerDefs[i];
        var screenPt = rotate(c.x, c.y, pv.x, pv.y, r);
        if(Math.hypot(raw.x-screenPt.x, raw.y-screenPt.y) <= Modules.product.HANDLE_R*1.8){
          var fixedKey = { tl:'br', tr:'bl', bl:'tr', br:'tl' }[c.key];
          var fixedDef = cornerDefs.filter(function(cd){ return cd.key===fixedKey; })[0];
          drag = {
            mode:'resize', corner:c.key,
            fixedLocal: { x:fixedDef.x, y:fixedDef.y },
            startDraggedLocal: { x:c.x, y:c.y },
            startTightW: t.w, startTightH: t.h,
            startProductScale: slot.productScale||1,
            pivotAtStart: pv, rotAtStart: r
          };
          canvas.style.cursor = (c.key==='tl'||c.key==='br') ? 'nwse-resize' : 'nesw-resize';
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      if(local.x>=t.x && local.x<=t.x+t.w && local.y>=t.y && local.y<=t.y+t.h){
        drag = { mode:'move', startX:raw.x, startY:raw.y, startOffX:(slot.productOffsetX||0), startOffY:(slot.productOffsetY||0) };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
      } else {
        slot.__pmSelected = false;
        redraw();
      }
    });

    canvas.addEventListener('pointermove', function(e){
      if(!drag) return;
      var raw = pointerPos(e);

      if(drag.mode === 'move'){
        // 平移不受旋轉影響（不管商品轉幾度，往螢幕上的哪個方向拖，商品就往那個方向移動）
        slot.productOffsetX = drag.startOffX + (raw.x-drag.startX)/boxW;
        slot.productOffsetY = drag.startOffY + (raw.y-drag.startY)/boxH;

      } else if(drag.mode === 'resize'){
        var local = rotate(raw.x, raw.y, drag.pivotAtStart.x, drag.pivotAtStart.y, -drag.rotAtStart);
        var fx = drag.fixedLocal.x, fy = drag.fixedLocal.y;
        var distNow = Math.hypot(local.x-fx, local.y-fy);
        var distStart = Math.hypot(drag.startDraggedLocal.x-fx, drag.startDraggedLocal.y-fy);
        var scaleFactor = Math.max(0.1, distNow / Math.max(1, distStart));
        var newScale = Math.max(0.3, Math.min(4, drag.startProductScale*scaleFactor));
        var newW = drag.startTightW*scaleFactor, newH = drag.startTightH*scaleFactor;

        var isTop = (drag.corner==='tl'||drag.corner==='tr');
        var isRight = (drag.corner==='tr'||drag.corner==='br');
        var newTightX = isRight ? fx : fx-newW;
        var newTightY = isTop ? fy-newH : fy;
        var newAnchorX = newTightX+newW/2;
        var newAnchorY = newTightY+newH/2; // anchorY現在代表tight box的正中心(不再是貼地底邊)

        slot.productOffsetX = (newAnchorX-boxW/2)/boxW;
        slot.productOffsetY = (newAnchorY-boxH/2)/boxH;
        slot.productScale = newScale;

      } else if(drag.mode === 'rotate'){
        var curAngle = Math.atan2(raw.y-drag.pivot.y, raw.x-drag.pivot.x)*180/Math.PI;
        slot.productRot = drag.startAngle + (curAngle-drag.startPointerAngle);
      }
      redraw();
    });

    function endDrag(){
      if(drag){ drag = null; canvas.style.cursor = 'grab'; if(onChange) onChange(); }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // 滾輪縮放：只在已選取時生效，避免捲動頁面經過小格子時被誤觸縮放。
    canvas.addEventListener('wheel', function(e){
      if(!selected()) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.06 : 0.06;
      slot.productScale = Math.max(0.3, Math.min(4, (slot.productScale||1) + delta));
      redraw();
      if(onChange) onChange();
    }, { passive:false });
  },

  drawExport: function(ctx, cfg, slot, originX, originY, done){
    if(!slot.productSrc){ done(); return; }
    var z = cfg.artZone;
    var lx = z.x-originX, ly = z.y-originY;
    var img = new Image();
    img.onload = function(){
      var id = 'export_'+Math.random().toString(36).slice(2);
      ShadowPlugin.registerProduct(id, img, 'product').then(function(){
        var trim = (ShadowPlugin._products[id]||{}).trim;
        var fit = Modules.product._computeFit(img, z.w, z.h, slot, trim);
        var absAnchorX = lx+fit.x, absAnchorY = ly+fit.groundY;

        if(slot.shadowAngle && slot.shadowAngle !== 'off'){
          ShadowPlugin.setAngle(slot.shadowAngle);
          var shx = absAnchorX + (slot.shadowOffsetX||0)*z.w;
          var shy = absAnchorY + (slot.shadowOffsetY||0)*z.h;
          ShadowPlugin.renderScene(ctx, [{ id:id, x:shx, y:shy, w:fit.w, h:fit.h }], true);
        }

        var t = fit.tight;
        var pvX = lx+t.x+t.w/2, pvY = ly+t.y+t.h/2;
        ctx.save();
        // 商品範圍不能超出這一格的artZone——旋轉/縮放/拖曳都只在這個矩形內
        // 才看得到，裁到這個範圍之後才套旋轉，不會讓商品畫出去蓋到LOGO/文字。
        ctx.beginPath();
        ctx.rect(lx, ly, z.w, z.h);
        ctx.clip();
        ctx.translate(pvX, pvY); ctx.rotate((slot.productRot||0)*Math.PI/180); ctx.translate(-pvX, -pvY);
        ctx.drawImage(img, lx+fit.drawX, ly+fit.drawY, fit.drawW, fit.drawH);
        Modules.product._drawMaterialText(ctx, slot, img, lx+fit.drawX, ly+fit.drawY, fit.drawW, fit.drawH);
        ctx.restore();

        ShadowPlugin.removeProduct(id);
        done();
      });
    };
    img.onerror = done;
    img.src = slot.productSrc;
  }
};
