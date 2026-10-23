'use strict';
/*
  js/tour.js — 新手導覽（2026-10）
  ------------------------------------------------------------
  第一次開啟編輯器時，自動載入一份範例工單，一步一步把畫面上的功能打亮、
  旁邊出現說明框，使用者按「下一步」看完即可（不用真的操作）。
  頂部列會多一顆「使用教學」按鈕，之後可以隨時重看。

  完全獨立的一支檔案：不改editor-main.js / editor.html 以外的任何東西，
  只呼叫既有的全域函式（runImportFlow、openExpandModal、selectModalTab、
  closeModal、renderAll、closePopup、openImportModal…）。

  範例資料：tour/tour-sample-data.js（window.TOUR_SAMPLE，工單＋素材都內嵌
  成base64，file://直接開也讀得到）。

  第一次開啟的判斷：localStorage 的 TOUR_KEY。網址加 ?tour 會強制再跑一次。

  ── 步驟設定 ──
  STEPS 每一步：
    target : CSS選擇器 / 回傳元素(或元素陣列)的函式 / null(畫面正中間的說明框)
    title, body : 說明框內容（body可以寫HTML）
    before : (選填) 進到這一步之前要做的事，例如打開放大編輯視窗、切分頁；
             可以回傳Promise
    place  : (選填) 'right'|'left'|'top'|'bottom'，偏好的說明框位置
    pad    : (選填) 打亮框比元素外擴幾px，預設6
  要改文字/增減步驟只改STEPS，不用碰下面的引擎。
*/
(function(){

  var TOUR_KEY = 'skbn_tour_seen_v1';

  /* ══════════════════ 小工具 ══════════════════ */
  function $(sel){ return document.querySelector(sel); }
  function visible(el){ if(!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function waitFor(fn, timeout){
    var t0 = Date.now();
    return new Promise(function(resolve){
      (function poll(){
        var v = null; try{ v = fn(); }catch(e){}
        if(v || Date.now() - t0 > (timeout||4000)) return resolve(v);
        setTimeout(poll, 60);
      })();
    });
  }
  function byText(sel, text){
    var list = document.querySelectorAll(sel);
    for(var i=0;i<list.length;i++){ if(list[i].textContent.trim() === text && visible(list[i])) return list[i]; }
    return null;
  }
  function blockOf(bannerIdx, key){ // 主畫面第N組的左/中/右那一格
    var cards = document.querySelectorAll('#main .banner-card');
    var card = cards[bannerIdx]; if(!card) return null;
    var blocks = card.querySelectorAll('.block');
    return blocks[{ left:0, mid:1, right:2 }[key]] || null;
  }
  function visibleObjPanel(){
    var list = document.querySelectorAll('.modal-objects .obj-panel');
    for(var i=0;i<list.length;i++){ if(visible(list[i])) return list[i]; }
    return null;
  }
  function fieldOf(sel){ var el = $(sel); return el ? (el.closest('.field') || el) : null; }
  function openModalFor(bannerIdx, key, tab, fresh){
    return function(){
      var same = window._modalCtx && _modalCtx.banner === STATE.banners[bannerIdx] && _modalCtx.key === key;
      // fresh：草稿裡的商品已經被換掉(素材資料庫那步換成券樣)，就重開一次，回到原本的商品
      if(same && fresh && _modalCtx.slot.productSrc !== _modalCtx.realSlot.productSrc){ closeModal(); same = false; }
      if(!same){
        openExpandModal(STATE.banners[bannerIdx], key);
      }
      return waitFor(function(){ return $('#modal-stage-inner canvas'); }, 4000).then(function(){
        // 已經在這個分頁就不要再切一次：selectModalTab會把左右兩欄整個重畫，
        // 畫面會閃一下、打亮框也會跟著跳
        if(tab && !(window._modalCtx && _modalCtx.activeTab === tab)){ selectModalTab(tab); return wait(250); }
        return null;
      });
    };
  }
  function ensureModalClosed(){ if(document.getElementById('modal-overlay')) closeModal(); return wait(150); }


  /* ══════════════════ 示範動畫（假游標＋實際操作）══════════════════
     有anim的步驟，說明框出現後會一直重複播放：畫面上出現一個假游標，
     示範「正在操作」的樣子。商品縮放/旋轉、換掛標是真的去觸發編輯器的
     操作（改的是放大編輯視窗的草稿，導覽不會按確認，所以不會存回去）；
     匯入工單那段只是畫面效果，不會真的匯入。
     換步驟/結束時用animToken作廢正在跑的動畫。 */
  var animToken = 0, cursorEl = null, chipEl = null;
  var ABORT = { tourAbort:true };

  function makeCursor(){
    if(cursorEl) return;
    cursorEl = document.createElement('div');
    cursorEl.id = 'tour-cursor';
    cursorEl.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2v22l6-6 4.5 9.5 4-2L13 16h9z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="tour-ripple"></span>';
    root.appendChild(cursorEl);
    chipEl = document.createElement('div');
    chipEl.id = 'tour-chip';
    root.appendChild(chipEl);
  }
  function hideCursor(){ if(cursorEl){ cursorEl.style.opacity = '0'; } if(chipEl){ chipEl.style.opacity = '0'; } }

  function Anim(token){
    var self = this, x = window.innerWidth*0.6, y = window.innerHeight*0.7, chipOn = false;
    function alive(){ if(token !== animToken || !active) throw ABORT; }
    function place(){
      cursorEl.style.transform = 'translate('+x+'px,'+y+'px)';
      if(chipOn) chipEl.style.transform = 'translate('+(x+16)+'px,'+(y+20)+'px)';
    }
    self.show = function(px, py){ alive(); x = px; y = py; place(); cursorEl.style.opacity = '1'; };
    self.wait = function(ms){ return new Promise(function(res, rej){ setTimeout(function(){ try{ alive(); res(); }catch(e){ rej(e); } }, ms); }); };
    /* 平滑移動；onStep(x,y)每一幀呼叫一次（拖曳時拿來送pointermove） */
    self.move = function(tx, ty, ms, onStep){
      alive();
      var sx = x, sy = y, t0 = performance.now();
      return new Promise(function(res, rej){
        (function frame(now){
          try{ alive(); }catch(e){ return rej(e); }
          var k = Math.min(1, (now - t0)/(ms||600)); var e = k<.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;
          x = sx + (tx-sx)*e; y = sy + (ty-sy)*e; place();
          if(onStep) onStep(x, y);
          if(k < 1) requestAnimationFrame(frame); else res();
        })(t0);
      });
    };
    self.ripple = function(){
      var r = cursorEl.querySelector('.tour-ripple');
      r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
    };
    self.chip = function(html){ chipEl.innerHTML = html; chipOn = true; chipEl.style.opacity = '1'; place(); };
    self.dropChip = function(){ chipOn = false; chipEl.style.opacity = '0'; };
    self.pos = function(){ return { x:x, y:y }; };
  }

  function center(el){ var r = el.getBoundingClientRect(); return { x:r.left + r.width/2, y:r.top + r.height/2, r:r }; }

  function startAnim(){
    var token = ++animToken;
    var step = STEPS[idx];
    if(!step || !step.anim) { hideCursor(); return; }
    makeCursor();
    var a = new Anim(token);
    (function loopAnim(){
      Promise.resolve().then(function(){ return step.anim(a); })
        .then(function(){ if(step.animOnce) throw ABORT; return a.wait(1400); })
        .then(loopAnim)
        .catch(function(e){ if(e !== ABORT) console.warn('[tour anim]', e); if(token === animToken) hideCursor(); });
    })();
  }
  function stopAnim(){ animToken++; hideCursor(); }

  /* ── 匯入工單：把Excel、素材資料夾拖進視窗，按確認匯入（只是畫面效果）── */
  var ICON_XLS = '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="2" fill="#1d7a45"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="1.6"/></svg>';
  var ICON_DIR = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 4a1 1 0 011-1h3.5l1.5 1.5h6a1 1 0 011 1V12a1 1 0 01-1 1h-11a1 1 0 01-1-1z" fill="#f2b33d"/></svg>';
  function resetImportZones(){
    [['#zone-excel','#zone-excel-title','拖曳 Excel 工單到這裡'],['#zone-folder','#zone-folder-title','上傳這批素材資料夾（LOGO／曝品，可選）']].forEach(function(z){
      var el = $(z[0]); if(!el) return;
      el.classList.remove('dropzone-success','dropzone-active');
      var t = $(z[1]); if(t) t.textContent = z[2];
    });
    var b = $('#confirm-import-btn'); if(b) b.style.transform = '';
  }
  function animImport(a){
    var panel = $('#popup-overlay .popup-panel'), ze = $('#zone-excel'), zf = $('#zone-folder'), btn = $('#confirm-import-btn');
    if(!panel || !ze || !zf || !btn) return a.wait(500);
    resetImportZones();
    var pr = panel.getBoundingClientRect();
    var start = { x: pr.right + 60, y: pr.top + pr.height*0.35 };
    var e = center(ze), f = center(zf), c = center(btn);
    a.show(start.x, start.y);
    a.chip(ICON_XLS+'<span>11.1-11.7美術工單.xlsx</span>');
    return a.wait(350)
      .then(function(){ return a.move(e.x, e.y, 900, function(x, y){ ze.classList.toggle('dropzone-active', x < e.r.right && y > e.r.top && y < e.r.bottom); }); })
      .then(function(){ return a.wait(200); })
      .then(function(){ a.dropChip(); a.ripple(); ze.classList.remove('dropzone-active'); ze.classList.add('dropzone-success'); var t = $('#zone-excel-title'); if(t) t.textContent = '已選擇：11.1-11.7美術工單.xlsx'; return a.wait(500); })
      .then(function(){ return a.move(start.x, start.y + 40, 600); })
      .then(function(){ a.chip(ICON_DIR+'<span>去背_PNG</span>'); return a.wait(250); })
      .then(function(){ return a.move(f.x, f.y, 900, function(x, y){ zf.classList.toggle('dropzone-active', x < f.r.right && y > f.r.top && y < f.r.bottom); }); })
      .then(function(){ return a.wait(200); })
      .then(function(){ a.dropChip(); a.ripple(); zf.classList.remove('dropzone-active'); zf.classList.add('dropzone-success'); var t = $('#zone-folder-title'); if(t) t.textContent = '已讀取 23 張素材圖片'; return a.wait(600); })
      .then(function(){ return a.move(c.x, c.y, 700); })
      .then(function(){ a.ripple(); btn.style.transition = 'transform .12s'; btn.style.transform = 'scale(.94)'; return a.wait(140); })
      .then(function(){ btn.style.transform = ''; return a.wait(1200); })
      .then(function(){ resetImportZones(); });
  }

  /* ── 商品-編輯：真的對商品畫布送pointer事件，示範拖曳（吸到中間）、縮放、旋轉 ── */
  function prodCanvas(){ return $('#modal-stage-inner .product-zone canvas'); }
  function firePtr(type, x, y){
    var c = prodCanvas(); if(!c) return;
    // 假的pointer沒辦法setPointerCapture(瀏覽器會丟錯)，這張畫布暫時換成什麼都不做
    if(!c.__tourStub){ c.setPointerCapture = function(){}; c.releasePointerCapture = function(){}; c.__tourStub = true; }
    c.dispatchEvent(new PointerEvent(type, { clientX:x, clientY:y, pointerId:7, pointerType:'mouse', isPrimary:true, bubbles:true, cancelable:true, button:0, buttons:(type === 'pointerup' ? 0 : 1) }));
  }
  function prodGeom(){
    var c = prodCanvas(), slot = window._modalCtx && _modalCtx.slot;
    if(!c || !slot || !slot.__pmCache || !slot.__pmCache.img) return null;
    var r = c.getBoundingClientRect(), W = parseFloat(c.style.width), H = parseFloat(c.style.height), k = r.width / W;
    var fit = Modules.product._computeFit(slot.__pmCache.img, W, H, slot, slot.__pmCache.trim), t = fit.tight;
    var cx = r.left + (t.x + t.w/2)*k, cy = r.top + (t.y + t.h/2)*k;
    return { cx:cx, cy:cy, br:{ x:r.left + (t.x+t.w)*k, y:r.top + (t.y+t.h)*k }, rotR:(t.h/2 + Math.max(18, H*0.08))*k };
  }
  function resetProduct(){
    var slot = _modalCtx.slot;
    slot.productOffsetX = 0; slot.productOffsetY = 0; slot.productScale = 1; slot.productRot = 0;
    slot.__pmSelected = true; slot.__lmSelected = false;
    refreshModalStage();
  }
  function animProduct(a){
    if(!window._modalCtx) return a.wait(500);
    resetProduct();
    var g;
    return a.wait(400).then(function(){
      g = prodGeom(); if(!g) throw ABORT;
      a.show(g.cx + 120, g.cy + 90);
      return a.move(g.cx, g.cy, 600);
    })
    // 1) 拖曳：往右上拖出去，再拖回來，靠近正中間會吸住、參考線變紅
    .then(function(){ a.ripple(); firePtr('pointerdown', g.cx, g.cy); return a.move(g.cx + 70, g.cy - 30, 800, function(x, y){ firePtr('pointermove', x, y); }); })
    .then(function(){ return a.wait(250); })
    .then(function(){ return a.move(g.cx + 2, g.cy + 1, 800, function(x, y){ firePtr('pointermove', x, y); }); })
    .then(function(){ return a.wait(500); })
    .then(function(){ var p = a.pos(); firePtr('pointerup', p.x, p.y); return a.wait(350); })
    // 2) 縮放：拖右下角的控制點，放大再縮回來
    .then(function(){ g = prodGeom(); if(!g) throw ABORT; return a.move(g.br.x, g.br.y, 600); })
    .then(function(){ a.ripple(); firePtr('pointerdown', g.br.x, g.br.y); return a.move(g.br.x + 40, g.br.y + 28, 800, function(x, y){ firePtr('pointermove', x, y); }); })
    .then(function(){ return a.wait(300); })
    .then(function(){ return a.move(g.br.x, g.br.y, 700, function(x, y){ firePtr('pointermove', x, y); }); })
    .then(function(){ var p = a.pos(); firePtr('pointerup', p.x, p.y); return a.wait(350); })
    // 3) 旋轉：拖上方的小圓點轉 30°，再轉回 0°（靠近 0° 會吸住）
    .then(function(){
      g = prodGeom(); if(!g) throw ABORT;
      var hx = g.cx, hy = g.cy - g.rotR;
      return a.move(hx, hy, 600).then(function(){
        a.ripple(); firePtr('pointerdown', hx, hy);
        var ang = { v:-90 };
        function arc(to, ms){
          var from = ang.v, t0 = null;
          return a.move(a.pos().x, a.pos().y, ms, function(){
            if(t0 === null) t0 = performance.now();
            var k = Math.min(1, (performance.now() - t0)/ms); var e = k<.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;
            ang.v = from + (to - from)*e;
            var rad = ang.v*Math.PI/180, px = g.cx + g.rotR*Math.cos(rad), py = g.cy + g.rotR*Math.sin(rad);
            cursorEl.style.transform = 'translate('+px+'px,'+py+'px)';
            firePtr('pointermove', px, py);
          });
        }
        return arc(-60, 900).then(function(){ return a.wait(300); }).then(function(){ return arc(-91, 800); }).then(function(){
          var rad = -91*Math.PI/180; firePtr('pointerup', g.cx + g.rotR*Math.cos(rad), g.cy + g.rotR*Math.sin(rad));
          return a.wait(300);
        });
      });
    })
    .then(function(){ return a.move(g.cx + 120, g.cy + 90, 600); })
    .then(function(){ hideCursor(); return a.wait(600); });
  }




  /* 券樣/免運車這類素材不需要影子（匯入工單時素材本來就預設關影子），
     導覽裡從資料庫換成素材後也一起關掉，點右側影子的「關」，畫面跟設定同步 */
  function shadowOff(){
    var b = $('#f-shadow-angle .angle-btn[data-angle="off"]');
    if(b && window._modalCtx && _modalCtx.slot.shadowAngle !== 'off') b.click();
  }
  /* ── 素材資料庫：點「瀏覽資料庫」→ 點免運車 → 再點一次「瀏覽資料庫」→ 點商城優惠券x2，
     讓使用者看到換素材就是「打開、點一下」兩個動作，會重複播放 ── */
  var COUPON_PATH = 'artwork/site-wide-sale/mall_product-coupon-x2.png';
  function findLibCard(text){
    var cards = document.querySelectorAll('.library-face .lib-card');
    for(var i=0;i<cards.length;i++){ if(cards[i].textContent.indexOf(text) >= 0) return cards[i]; }
    return null;
  }
  function animPickCoupon(a){
    if(!window._modalCtx || !$('#f-prod-browse')) return a.wait(500);
    if(typeof closeLibraryDrawer === 'function') closeLibraryDrawer();
    var st = center($('#modal-stage-inner'));
    a.show(st.x, st.y + 120);
    function pick(text){
      var b = $('#f-prod-browse'); if(!b) return a.wait(300);
      var c = center(b);
      return a.move(c.x, c.y, 800)
        .then(function(){ a.ripple(); b.click(); return a.wait(700); })
        .then(function(){
          var card = findLibCard(text); if(!card) return a.wait(300);
          card.scrollIntoView({ block:'nearest' });
          var k = center(card);
          return a.move(k.x, k.y, 900).then(function(){ a.ripple(); card.click(); shadowOff(); return a.wait(300); });
        })
        .then(function(){ return a.move(st.x + 40, st.y + 60, 600); })
        .then(function(){ return a.wait(1200); });
    }
    return pick('免運車')
      .then(function(){ return pick('商城優惠券x2'); })
      .then(function(){ hideCursor(); return a.wait(600); });
  }

  /* ── 素材庫-編輯：在兩個券樣文字框裡打字，券面金額跟著變 ── */
  function animCouponText(a){
    var inputs = document.querySelectorAll('.modal-objects .f-material-text');
    if(!inputs.length) return a.wait(500);
    var texts = ['$100', '$200'];
    function typeInto(input, text){
      var c = center(input);
      return a.move(c.x + 40, c.y, 650).then(function(){
        a.ripple(); input.focus();
        input.value = ''; input.dispatchEvent(new Event('input'));
        var p = a.wait(250);
        text.split('').forEach(function(ch){
          p = p.then(function(){ input.value += ch; input.dispatchEvent(new Event('input')); return a.wait(220); });
        });
        return p.then(function(){ return a.wait(600); });
      });
    }
    var first = center(inputs[0]);
    a.show(first.x + 120, first.y + 80);
    var p = Promise.resolve();
    Array.prototype.forEach.call(inputs, function(inp, i){
      p = p.then(function(){ var el = document.querySelectorAll('.modal-objects .f-material-text')[i]; return el ? typeInto(el, texts[i] || '$100') : null; });
    });
    return p.then(function(){ var el = document.activeElement; if(el && el.blur) el.blur(); return a.move(first.x + 120, first.y + 80, 500); })
            .then(function(){ hideCursor(); return a.wait(500); });
  }

  /* ── LOGO：這格LOGO如果是缺檔的，先示範從下拉選單補一個，再依序切換顯示方式、顏色 ── */
  var TOUR_LOGO_PICK = 'brand-flagship_logo'; // 補缺檔時挑的LOGO（資料庫裡的「品牌旗艦」）
  function animLogo(a){
    if(!window._modalCtx || !$('#f-logo-mode')) return a.wait(500);
    var slot = _modalCtx.slot;
    function btn(sel){ return $(sel); }
    function clickBtn(sel, pause){
      var b = btn(sel); if(!b) return a.wait(200);
      var c = center(b);
      return a.move(c.x, c.y, 600).then(function(){ a.ripple(); b.click(); return a.wait(pause || 1000); });
    }
    var first = center($('#f-logo-mode'));
    a.show(first.x + 80, first.y + 90);
    var p = Promise.resolve();
    if(!slot.logoRaw){
      p = p.then(function(){
        var sel = $('#f-logo-lib'); if(!sel) return;
        var c = center(sel);
        return a.move(c.x, c.y, 700).then(function(){
          a.ripple();
          var opts = Array.prototype.slice.call(sel.options).filter(function(o){ return o.value; });
          var pick = opts.filter(function(o){ return o.value.indexOf(TOUR_LOGO_PICK) >= 0; })[0] || opts[0];
          if(pick){ sel.value = pick.value; sel.dispatchEvent(new Event('change')); }
          return a.wait(1300);
        });
      });
    }
    var origMode, origWhite;
    p = p.then(function(){ origMode = slot.logoMode || 'original'; origWhite = slot.logoForceWhite ? '1' : '0'; });
    ['trim', 'fill', 'original'].forEach(function(m){
      p = p.then(function(){ return clickBtn('#f-logo-mode .angle-btn[data-mode="'+m+'"]', 1100); });
    });
    p = p.then(function(){ return clickBtn('#f-logo-white .angle-btn[data-white="1"]', 1100); })
         .then(function(){ return clickBtn('#f-logo-white .angle-btn[data-white="0"]', 900); })
         .then(function(){ if(origMode !== 'original') return clickBtn('#f-logo-mode .angle-btn[data-mode="'+origMode+'"]', 600); })
         .then(function(){ if(origWhite !== '0') return clickBtn('#f-logo-white .angle-btn[data-white="'+origWhite+'"]', 600); })
         .then(function(){ var c = center($('#f-logo-mode')); return a.move(c.x + 80, c.y + 90, 500); })
         .then(function(){ hideCursor(); return a.wait(400); });
    return p;
  }


  /* ── LOGO資料庫：點「瀏覽資料庫」→ 點一個LOGO套用上去（只播一次，套用後的樣子會一路帶到最後）── */
  var TOUR_LOGO_APPLY = '美妝保健館';
  function animPickLogo(a){
    var b = $('#f-logo-browse'); if(!b || !window._modalCtx) return a.wait(500);
    if(typeof closeLibraryDrawer === 'function') closeLibraryDrawer();
    var st = center($('#modal-stage-inner')), c = center(b);
    a.show(st.x, st.y + 120);
    return a.wait(400)
      .then(function(){ return a.move(c.x, c.y, 800); })
      .then(function(){ a.ripple(); b.click(); return a.wait(700); })
      .then(function(){
        var card = findLibCard(TOUR_LOGO_APPLY);
        if(!card) return a.wait(300);
        if(!visible(card)){ // 這個LOGO在收合起來的分類裡（預設只展開造節）→ 先點開那個分類
          var grid = card.closest('.lib-grid'), t = grid && grid.previousElementSibling;
          if(t) t.click();
        }
        card.scrollIntoView({ block:'center' });
        return a.wait(300).then(function(){ var k = center(card); return a.move(k.x, k.y, 900); })
          .then(function(){ a.ripple(); card.click(); return a.wait(400); });
      })
      .then(function(){ return a.move(st.x + 40, st.y - 80, 600); })
      .then(function(){ hideCursor(); return a.wait(300); });
  }


  /* ── 確認並關閉：游標按下確認，改好的結果套用回主畫面，打亮那一格 ── */
  function animConfirm(a){
    var b = $('#f-confirm-close'); if(!b) return a.wait(300);
    var c = center(b);
    a.show(c.x - 140, c.y - 120);
    return a.wait(500)
      .then(function(){ return a.move(c.x, c.y, 800); })
      .then(function(){ a.ripple(); return a.wait(200); })
      .then(function(){
        // 選取狀態不要一起存回主畫面（不然主畫面那格會一直帶著選取框）
        if(window._modalCtx){ _modalCtx.slot.__pmSelected = false; _modalCtx.slot.__lmSelected = false; }
        b.click(); demoConfirmed = true; hideCursor();
        var blk = blockOf(1, 'left'); if(blk) blk.scrollIntoView({ block:'center' });
        return a.wait(300); });
  }

  /* ── 掛標：依序點白→紅→關，最後回到原本的設定 ── */
  function animTag(a){
    var wrap = $('#f-tag-variant'); if(!wrap || !window._modalCtx) return a.wait(500);
    var orig = _modalCtx.slot.tagVariant || 'auto';
    var seq = ['white', 'red', 'off', orig];
    function btnOf(v){ return wrap.querySelector('.angle-btn[data-variant="'+v+'"]'); }
    var first = center(btnOf(seq[0]));
    a.show(first.x + 60, first.y + 70);
    var p = Promise.resolve();
    seq.forEach(function(v){
      p = p.then(function(){ var b = btnOf(v); var c = center(b); return a.move(c.x, c.y, 650).then(function(){ a.ripple(); b.click(); return a.wait(1100); }); });
    });
    return p.then(function(){ var c = center(btnOf(orig)); return a.move(c.x + 60, c.y + 70, 500); }).then(function(){ hideCursor(); return a.wait(400); });
  }

  /* ══════════════════ 步驟 ══════════════════ */
  var STEPS = [
    { target:null, intro:true,
      title:'歡迎使用 SKBN 編輯器 👋',
      body:'帶你 2 分鐘上手！' },

    { target:'#popup-overlay .popup-panel', place:'right',
      before:function(){ openImportModal(); return waitFor(function(){ return $('#confirm-import-btn'); }, 2000); },
      after:function(){ closePopup(); return wait(100); },
      anim:animImport,
      title:'匯入工單',
      body:'放入 Excel 與素材，自動生成排版配色。' },

    { target:'#list-panel', place:'right',
      title:'製作物列表',
      body:'點擊快速跳轉各天製作物。' },

    { target:'#side-panel', place:'left',
      title:'提示與警示',
      body:'自動檢查缺檔、超字與禁用語。' },

    { target:function(){ return document.querySelector('#main .banner-card'); }, place:'bottom',
      title:'一組 = 一天',
      body:'對應工單的左、中、右三格。' },

    { target:function(){ return blockOf(1, 'left'); }, place:'right', pad:4,
      title:'一格裡的元素',
      body:'包含掛標、LOGO、主標、商品與 CTA。' },

    { target:function(){ var b = blockOf(1, 'left'); return b ? b.querySelector('.expand-btn') : null; },
      before:function(){ var b = blockOf(1, 'left'); var x = b && b.querySelector('.expand-btn'); if(x) x.style.display = 'flex'; },
      after:function(){ var b = blockOf(1, 'left'); var x = b && b.querySelector('.expand-btn'); if(x) x.style.display = ''; },
      place:'right', pad:6,
      title:'編輯',
      body:'點右下角進入細部編輯。' },

    /* ── 放大編輯視窗：11/2 左（倩碧，商品圖） ── */
    /* ── 放大編輯視窗：從頭到尾都用 11/2 左（倩碧）這一格 ── */
    { target:'.modal-panel', place:'bottom', pad:2,
      before:openModalFor(1, 'left', 'product', true),
      title:'放大編輯視窗',
      body:'方向鍵可做細部微調。' },

    { target:'.modal-objects .import-status-sm', place:'right',
      before:openModalFor(1, 'left', 'product', true),
      title:'狀態說明',
      body:'檢視匯入狀況（如背景色指定狀態）。' },

    { target:function(){ return visibleObjPanel(); }, place:'right',
      before:openModalFor(1, 'left', 'product', true),
      title:'曝品圖',
      body:'更換商品、去背或選用資料庫素材。' },

    { target:'#modal-stage-inner', place:'right', pad:-8,
      before:openModalFor(1, 'left', 'product', true),
      anim:animProduct,
      title:'商品-編輯',
      body:'自由拖曳、縮放與旋轉。' },

    { target:function(){
        var t = byText('.modal-settings .side-section-title', '商品影子');
        var r = $('#f-shadow-reset');
        return (t && r) ? [t, r] : null; },
      place:'left',
      before:openModalFor(1, 'left', 'product', true),
      title:'商品-影子',
      body:'可微調光影角度，或一鍵重設。' },

    /* ── 券樣：同一格，示範從素材資料庫連換兩個素材（免運車 → 商城優惠券x2），再改券面金額 ── */
    { target:'.modal-panel', place:'bottom', pad:2,
      before:openModalFor(1, 'left', 'product', true),
      after:function(){ if(typeof closeLibraryDrawer === 'function') closeLibraryDrawer(); return wait(150); },
      anim:animPickCoupon,
      title:'素材資料庫',
      body:'內建券樣、免運車、限時特賣等常用素材，點一下就換上。' },

    { target:function(){ var a = visibleObjPanel(), b = $('#modal-stage-inner'); return (a && b) ? [a, b] : null; }, place:'right', pad:2,
      before:function(){
        return Promise.resolve(openModalFor(1, 'left', 'product')()).then(function(){
          var slot = _modalCtx.slot;
          if(slot.materialType !== '商城券*2'){ pickProductOrMaterialForSlot(slot, COUPON_PATH); refreshModalStage(); refreshMaterialTextFieldsUI(slot); syncProductLibrarySelect(slot); }
          shadowOff();
          return wait(400);
        });
      },
      anim:animCouponText,
      // 打字動畫還沒播完就按下一步時，直接補成完整金額，最後套用回主畫面的樣子才會是對的
      after:function(){
        if(!window._modalCtx) return;
        var slot = _modalCtx.slot;
        if(slot.materialType === '商城券*2' && (slot.materialTexts||[]).join('/') !== '$100/$200'){
          slot.materialTexts = ['$100', '$200']; refreshModalStage(); refreshMaterialTextFieldsUI(slot);
        }
        var el = document.activeElement; if(el && el.blur) el.blur();
      },
      title:'素材庫-編輯',
      body:'券樣素材可直接修改券面金額文字。' },

    /* ── 11/6 左（LOGO 比對不到的那一格） ── */
    { target:function(){ var a = visibleObjPanel(), b = $('#modal-stage-inner'); return (a && b) ? [a, b] : null; }, place:'right', pad:2,
      before:openModalFor(1, 'left', 'logo'),
      anim:animLogo,
      title:'LOGO',
      body:'換樣式、改純白或補齊缺檔。' },

    { target:'.modal-panel', place:'bottom', pad:2,
      before:openModalFor(1, 'left', 'logo'),
      after:function(){ if(typeof closeLibraryDrawer === 'function') closeLibraryDrawer(); return wait(150); },
      anim:animPickLogo, animOnce:true,
      title:'LOGO資料庫',
      body:'內建大促與造節專用 LOGO。' },

    { target:function(){ var a = visibleObjPanel(), b = $('#modal-stage-inner'); return (a && b) ? [a, b] : null; }, place:'right', pad:2,
      before:openModalFor(1, 'left', 'tag'),
      anim:animTag,
      title:'掛標',
      body:'可切換樣式，關閉時 LOGO 自動置中。' },

    { target:function(){ return document.getElementById('modal-overlay') ? $('#f-confirm-close') : blockOf(1, 'left'); },
      place:'left',
      before:openModalFor(1, 'left', 'tag'),
      anim:animConfirm, animOnce:true,
      title:'確認並關閉',
      body:'儲存修改並返回主畫面。' },

    /* ── 回主畫面 ── */
    { target:function(){ return byText('.topbar .tbtn', '整包下載'); }, place:'bottom',
      before:ensureModalClosed,
      title:'整包下載',
      body:'一鍵打包全套圖片，下載前自動檢查警示。' },

    { target:'#tour-launch-btn', place:'bottom',
      title:'導覽結束 🎉',
      body:'點「完成」開始製作本週工單！' }
  ];

  /* ══════════════════ 樣式 ══════════════════ */
  var CSS =
    '#tour-root{position:fixed;inset:0;z-index:100000;pointer-events:none;font-family:inherit;}'+
    '#tour-block{position:fixed;inset:0;pointer-events:auto;background:transparent;}'+
    '#tour-spot{position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.62);border:2px solid var(--accent,#EE4D2D);'+
      'transition:left .25s,top .25s,width .25s,height .25s,opacity .2s;pointer-events:none;}'+
    '#tour-spot.tour-none{width:0!important;height:0!important;left:50%!important;top:50%!important;border-width:0;}'+
    '#tour-card{position:fixed;width:340px;max-width:calc(100vw - 24px);background:#232326;color:#f0f0f0;border:1px solid #3a3a3f;'+
      'border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px 18px 14px;pointer-events:auto;'+
      'transition:left .25s,top .25s;}'+
    '#tour-card .tour-step{font-size:11px;color:var(--accent,#EE4D2D);font-weight:700;letter-spacing:.04em;margin-bottom:6px;}'+
    '#tour-card .tour-title{font-size:16px;font-weight:700;margin-bottom:8px;}'+
    '#tour-card .tour-body{font-size:13px;line-height:1.75;color:#d4d4d8;}'+
    '#tour-card .tour-body b{color:#fff;}'+
    '#tour-card .tour-dim{color:#9a9aa2;font-size:12px;}'+
    '#tour-card .tour-bar{height:3px;background:#3a3a3f;border-radius:2px;margin:14px 0 12px;overflow:hidden;}'+
    '#tour-card .tour-bar i{display:block;height:100%;background:var(--accent,#EE4D2D);transition:width .25s;}'+
    '#tour-card .tour-foot{display:flex;align-items:center;gap:8px;}'+
    '#tour-card .tour-skip{background:none;border:0;color:#9a9aa2;font-size:12px;cursor:pointer;padding:6px 0;margin-right:auto;}'+
    '#tour-card .tour-skip:hover{color:#fff;}'+
    '#tour-card .tour-btn{border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;border:1px solid #3a3a3f;background:transparent;color:#f0f0f0;}'+
    '#tour-card .tour-btn:hover{border-color:var(--accent,#EE4D2D);}'+
    '#tour-card .tour-btn.primary{background:var(--accent,#EE4D2D);border-color:var(--accent,#EE4D2D);color:#fff;}'+
    '#tour-card .tour-btn[disabled]{opacity:.35;cursor:default;}'+
    '#tour-card.tour-intro{width:420px;text-align:center;padding:26px 28px 20px;}'+
    '#tour-card.tour-intro .tour-step,#tour-card.tour-intro .tour-bar,#tour-card.tour-intro .tour-skip,#tour-card.tour-intro .tour-prev{display:none;}'+
    '#tour-card .tour-art{display:none;}'+
    '#tour-card.tour-intro .tour-art{display:block;margin:0 auto 16px;width:300px;max-width:100%;}'+
    '#tour-card.tour-intro .tour-title{font-size:20px;margin-bottom:10px;}'+
    '#tour-card.tour-intro .tour-body{font-size:13.5px;}'+
    '#tour-card .tour-later{display:none;}'+
    '#tour-card.tour-intro .tour-later{display:inline-block;}'+
    '#tour-card.tour-intro .tour-foot{justify-content:center;margin-top:20px;gap:10px;}'+
    '#tour-card.tour-intro .tour-next{padding:9px 22px;font-size:13px;}'+
    '#tour-card.tour-intro .tour-later{padding:9px 16px;font-size:13px;}'+
    '#tour-card .tour-meta{display:none;}'+
    '#tour-card.tour-intro .tour-meta{display:block;margin-top:12px;font-size:11.5px;color:#7d7d85;}'+
    '#tour-cursor{position:fixed;left:0;top:0;width:26px;height:30px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:3;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));}'+
    '#tour-cursor svg{position:absolute;left:-3px;top:-2px;}'+
    '#tour-cursor .tour-ripple{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid #fff;opacity:0;}'+
    '#tour-cursor .tour-ripple.go{animation:tourRipple .45s ease-out;}'+
    '@keyframes tourRipple{from{transform:scale(.3);opacity:.9;}to{transform:scale(1.4);opacity:0;}}'+
    '#tour-chip{position:fixed;left:0;top:0;opacity:0;transition:opacity .15s;pointer-events:none;z-index:2;display:flex;align-items:center;gap:6px;'+
      'background:#fff;color:#222;font-size:12px;padding:6px 10px;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.35);white-space:nowrap;}'+
    '#tour-loading{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#232326;color:#f0f0f0;'+
      'border:1px solid #3a3a3f;border-radius:12px;padding:18px 24px;font-size:13px;pointer-events:auto;}';

  /* 開場那一步的插圖：簡化的左中右三格＋選取框/參考線＋滑鼠，不是真的品牌素材 */
  var ART = '<svg class="tour-art" viewBox="0 0 300 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="6" y="14" width="288" height="96" rx="10" fill="#fff"/><rect x="14" y="22" width="84" height="80" rx="8" fill="#d0011b"/><rect x="104" y="20" width="92" height="84" rx="8" fill="#ee4d2d"/><rect x="202" y="22" width="84" height="80" rx="8" fill="#0054a4"/><rect x="14" y="22" width="26" height="12" rx="2" fill="#fff" opacity=".95"/><rect x="46" y="25" width="44" height="9" rx="4.5" fill="#fff"/><rect x="26" y="42" width="60" height="8" rx="2" fill="#fff" opacity=".9"/><rect x="24" y="60" width="36" height="30" rx="4" fill="#fff" opacity=".85"/><circle cx="80" cy="74" r="9" fill="#111"/><path d="M78 70v8l6-4z" fill="#fff"/><rect x="118" y="28" width="64" height="9" rx="2" fill="#fff"/><rect x="124" y="42" width="52" height="8" rx="2" fill="#fff" opacity=".9"/><rect x="116" y="60" width="44" height="30" rx="4" fill="#fff" opacity=".85" transform="rotate(-8 138 75)"/><circle cx="178" cy="76" r="9" fill="#111"/><path d="M176 72v8l6-4z" fill="#fff"/><rect x="202" y="22" width="26" height="12" rx="2" fill="#fff" opacity=".95"/><rect x="234" y="25" width="44" height="9" rx="4.5" fill="#fff"/><rect x="214" y="42" width="60" height="8" rx="2" fill="#fff" opacity=".9"/><rect x="214" y="58" width="30" height="34" rx="4" fill="#fff" opacity=".85"/><circle cx="268" cy="74" r="9" fill="#111"/><path d="M266 70v8l6-4z" fill="#fff"/><rect x="102" y="18" width="96" height="88" rx="10" stroke="#5ab8ff" stroke-width="2" stroke-dasharray="5 4"/><path d="M150 18v88M102 62h96" stroke="#ff2d2d" stroke-width="1.5"/><path d="M206 96l0 22 6-6 4 9 4-2-4-9h8z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  /* ══════════════════ 引擎 ══════════════════ */
  var root, spot, card, idx = 0, active = false, raf = 0, snapshot = null, curTargets = null, busy = false;

  function build(){
    if(root) return;
    var st = document.createElement('style'); st.id = 'tour-style'; st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'tour-root';
    root.innerHTML = '<div id="tour-block"></div><div id="tour-spot" class="tour-none"></div>'+
      '<div id="tour-card">'+ART+'<div class="tour-step"></div><div class="tour-title"></div><div class="tour-body"></div>'+
      '<div class="tour-bar"><i></i></div><div class="tour-foot">'+
      '<button class="tour-skip" type="button">跳過導覽</button>'+
      '<button class="tour-btn tour-later" type="button">先不用，直接開始工作</button>'+
      '<button class="tour-btn tour-prev" type="button">上一步</button>'+
      '<button class="tour-btn primary tour-next" type="button">下一步</button></div>'+
      '<div class="tour-meta">共 '+STEPS.length+' 步・之後隨時可以按右上角「使用教學」重看</div></div>';
    document.body.appendChild(root);
    spot = root.querySelector('#tour-spot'); card = root.querySelector('#tour-card');
    card.querySelector('.tour-skip').onclick = function(){ end(); };
    card.querySelector('.tour-later').onclick = function(){ end(); };
    card.querySelector('.tour-prev').onclick = function(){ go(idx - 1); };
    card.querySelector('.tour-next').onclick = function(){ if(idx >= STEPS.length - 1) end(); else go(idx + 1); };
  }

  function resolveTargets(step){
    var t = step.target;
    if(!t) return null;
    var v = (typeof t === 'function') ? t() : document.querySelector(t);
    var arr = Array.isArray(v) ? v : [v];
    arr = arr.filter(function(el){ return el && visible(el); });
    return arr.length ? arr : null;
  }

  function unionRect(els){
    var x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    els.forEach(function(el){ var r = el.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
    return { left:x0, top:y0, right:x1, bottom:y1, width:x1-x0, height:y1-y0 };
  }

  function layout(){
    if(!active) return;
    var step = STEPS[idx], vw = window.innerWidth, vh = window.innerHeight, M = 12;
    // 示範動畫會讓編輯器重畫畫面，打亮的元素可能被換掉：被換掉就重新抓一次
    if(curTargets && (step.anim || curTargets.some(function(el){ return !el.isConnected; }))){
      var re = resolveTargets(step); if(re) curTargets = re;
    }
    var cw = card.offsetWidth, ch = card.offsetHeight, x, y;
    // 沒有要打亮的東西(開場/結尾說明)：整個畫面直接蓋一層暗色
    root.querySelector('#tour-block').style.background = curTargets ? 'transparent' : 'rgba(0,0,0,.62)';
    if(!curTargets){
      spot.classList.add('tour-none');
      x = (vw - cw)/2; y = (vh - ch)/2;
    } else {
      var pad = (step.pad != null) ? step.pad : 6;
      var r = unionRect(curTargets);
      var sx = Math.max(4, r.left - pad), sy = Math.max(4, r.top - pad);
      var sw = Math.min(vw - 4, r.right + pad) - sx, sh = Math.min(vh - 4, r.bottom + pad) - sy;
      spot.classList.remove('tour-none');
      spot.style.left = sx+'px'; spot.style.top = sy+'px'; spot.style.width = sw+'px'; spot.style.height = sh+'px';
      var gap = 14;
      var room = { right: vw - (sx+sw) - gap - M, left: sx - gap - M, bottom: vh - (sy+sh) - gap - M, top: sy - gap - M };
      var order = [step.place || 'right', 'right', 'left', 'bottom', 'top'];
      var place = null;
      for(var i=0;i<order.length;i++){
        var p = order[i];
        if((p === 'right' || p === 'left') && room[p] >= cw){ place = p; break; }
        if((p === 'top' || p === 'bottom') && room[p] >= ch){ place = p; break; }
      }
      if(place === 'right'){ x = sx + sw + gap; y = sy + sh/2 - ch/2; }
      else if(place === 'left'){ x = sx - gap - cw; y = sy + sh/2 - ch/2; }
      else if(place === 'bottom'){ x = sx + sw/2 - cw/2; y = sy + sh + gap; }
      else if(place === 'top'){ x = sx + sw/2 - cw/2; y = sy - gap - ch; }
      else { x = vw - cw - M; y = vh - ch - M; } // 哪邊都放不下：右下角
    }
    card.style.left = Math.max(M, Math.min(vw - cw - M, x))+'px';
    card.style.top = Math.max(M, Math.min(vh - ch - M, y))+'px';
  }

  /* 換步驟的過程中(busy)不重新排版：這段時間舊的打亮目標可能已經被編輯器
     重畫掉(位置變成0,0)、或新步驟的位置偏好已經換了，排版的話打亮框/說明框
     會先往別的方向跑一下才到新位置。等新目標找到再一次排好。 */
  function loop(){ if(!busy) layout(); raf = requestAnimationFrame(loop); }

  function go(n){
    if(busy || n < 0 || n >= STEPS.length) return;
    busy = true;
    stopAnim();
    restoreDemoSlotIfNeeded(n);
    var prev = STEPS[idx];
    Promise.resolve(prev && prev.after && idx !== n ? prev.after() : null).then(function(){
      idx = n;
      var step = STEPS[idx];
      return Promise.resolve(step.before ? step.before() : null);
    }).then(function(){
      var step = STEPS[idx];
      return step.target ? waitFor(function(){ return resolveTargets(step); }, 4000) : null;
    }).then(function(targets){
      curTargets = targets;
      if(targets && targets[0]){
        // 先捲到看得到（放大編輯視窗右側設定欄會自己捲動，按鈕可能被藏在下面）
        targets[targets.length-1].scrollIntoView({ block:'nearest' });
        targets[0].scrollIntoView({ block:'nearest' });
        var r = unionRect(targets);
        if(r.top < 60 || r.bottom > window.innerHeight - 20) targets[0].scrollIntoView({ block:'center' });
      }
      var step = STEPS[idx];
      card.querySelector('.tour-step').textContent = (idx+1)+' / '+STEPS.length;
      card.querySelector('.tour-title').textContent = step.title;
      card.querySelector('.tour-body').innerHTML = step.body;
      card.querySelector('.tour-bar i').style.width = ((idx+1)/STEPS.length*100)+'%';
      card.querySelector('.tour-prev').disabled = (idx === 0);
      card.classList.toggle('tour-intro', !!step.intro);
      card.querySelector('.tour-next').textContent = step.intro ? '開始導覽' : ((idx === STEPS.length - 1) ? '完成' : '下一步');
      layout();
      busy = false;
      startAnim();
    }).catch(function(e){ console.warn('[tour]', e); busy = false; });
  }

  function onKey(e){
    if(!active) return;
    // 導覽進行中，鍵盤一律攔下來，不讓編輯器的方向鍵/Ctrl+Z去動到範例資料
    e.stopPropagation(); e.stopImmediatePropagation();
    if(e.key === 'ArrowRight' || e.key === 'Enter'){ e.preventDefault(); card.querySelector('.tour-next').click(); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); go(idx - 1); }
    else if(e.key === 'Escape'){ e.preventDefault(); end(); }
  }


  /* 「確認並關閉」那步會真的把改好的內容存回11/2左（讓主畫面看到最後的樣子）。
     之後如果按「上一步」回到前面的步驟，先把這一格還原成匯入時的樣子 */
  var demoConfirmed = false, demoSlotSnapshot = null;
  function confirmStepIndex(){ for(var i=0;i<STEPS.length;i++){ if(STEPS[i].anim === animConfirm) return i; } return -1; }
  function restoreDemoSlotIfNeeded(n){
    if(!demoConfirmed || !demoSlotSnapshot || n >= confirmStepIndex()) return;
    var real = STATE.banners[1] && STATE.banners[1].left; if(!real) return;
    Object.keys(real).forEach(function(k){ if(!(k in demoSlotSnapshot)) delete real[k]; });
    Object.assign(real, cloneSlotForEdit(demoSlotSnapshot));
    demoConfirmed = false;
    if(document.getElementById('modal-overlay')) closeModal(); else renderAll();
  }

  /* ══════════════════ 範例資料 ══════════════════ */
  function b64File(b64, name, type){
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
    return new File([u], name, { type: type || '' });
  }
  function hasUserData(){
    return (STATE.banners||[]).some(function(b){
      return ['left','mid','right'].some(function(k){ var s = b[k]; return s && (s.productSrc || s.logoRaw || s.title); });
    });
  }
  function loadSample(){
    var S = window.TOUR_SAMPLE;
    if(!S){ alert('找不到導覽用的範例資料（tour/tour-sample-data.js）。'); return Promise.reject(); }
    closePopup();
    var excel = b64File(S.excel, S.excelName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    var files = S.files.map(function(f){ return b64File(f.b64, f.name, f.type); });
    ImportProgress.open();
    runImportFlow(excel, files);
    return waitFor(function(){
      return !document.getElementById('popup-overlay') && document.querySelector('#main .banner-card .block');
    }, 60000).then(function(){ return wait(600); });
  }

  /* ══════════════════ 開始 / 結束 ══════════════════ */
  function start(){
    if(active) return;
    snapshot = hasUserData() ? { banners: STATE.banners, warnings: STATE.warnings } : null;
    if(document.getElementById('modal-overlay')) closeModal();
    loadSample().then(function(){
      demoConfirmed = false;
      demoSlotSnapshot = (STATE.banners[1] && STATE.banners[1].left) ? cloneSlotForEdit(STATE.banners[1].left) : null;
      build();
      root.style.display = '';
      active = true; idx = 0; curTargets = null;
      document.addEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf); loop();
      go(0);
    }).catch(function(){});
  }

  function end(){
    if(!active) return;
    stopAnim();
    var step = STEPS[idx];
    if(step && step.after) step.after();
    active = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    if(root) root.style.display = 'none';
    try{ localStorage.setItem(TOUR_KEY, '1'); }catch(e){}
    if(document.getElementById('modal-overlay')) closeModal();
    // 範例資料清掉；導覽前原本有在做的工單就還原回去
    BatchAssets.clear();
    if(snapshot){
      STATE.banners = snapshot.banners; STATE.warnings = snapshot.warnings || [];
      snapshot = null;
      renderAll();
    } else {
      STATE.banners = [emptyBanner(), emptyBanner(), emptyBanner(), emptyBanner()];
      STATE.warnings = [];
      renderAll();
      openImportModal();
    }
  }

  /* ══════════════════ 頂部列「使用教學」按鈕＋第一次自動開始 ══════════════════ */
  function addLaunchButton(){
    var bar = document.querySelector('.topbar-right');
    if(!bar || document.getElementById('tour-launch-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'tbtn'; btn.id = 'tour-launch-btn'; btn.type = 'button';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 113 1.5c-.7.4-1.2.8-1.2 1.6M8 11.6v.1"/></svg>使用教學';
    btn.onclick = start;
    bar.insertBefore(btn, bar.firstChild);
  }

  function seen(){ try{ return localStorage.getItem(TOUR_KEY) === '1'; }catch(e){ return false; } }

  addLaunchButton();
  if(!seen() || /[?&]tour\b/.test(location.search)){
    // editor-main.js啟動時已經跳出匯入視窗，第一次開啟改成先跑導覽（start會把它關掉）
    setTimeout(start, 300);
  }

  window.SkbnTour = { start: start, end: end, steps: STEPS };
})();
