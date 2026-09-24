'use strict';
/*
  background-module.js
  ------------------------------------------------------------
  這一張卡片本身的底色（圓角矩形範圍，圓角/尺寸/位置都來自cfg.blockRect，
  這支不用管那些數字，Core已經把容器準備成正確的大小/圓角了，這裡只管上色）：
    1. buildDom()   —— 設定卡片容器背景色 + 一顆可以叫出系統色盤的小圓點
    2. drawExport() —— 匯出時把暫存canvas(卡片自己座標系，0,0起)整個塗滿背景色
                       （呼叫端已經clip好圓角範圍，這裡單純fillRect全滿即可）

  光暈（2026-09新增）：
    左右卡片（cfg.glowEnabled===true，中間KV版位是false不加）在背景色上方，
    疊一層置中在商品圖(artZone)後方的圓形光暈——同色相同飽和度、只是明度
    往白推一點的「淺一號」底色，中心亮、往外柔化到看不見，不能跑到文字區
    下面。這組參數(GLOW)是拿掉你自己用skbn-glow-test.html實測拖拉調出來的
    最終版本：
      - peakAlpha/k/sigma：你在檢測工具上調到覺得OK的數字
      - cx/cy：你在卡片(336x318本地座標)上拖光暈中心點調到的位置

    ⚠ DOM這邊(buildDom)故意「不」用固定px去定位光暈，改用一顆獨立的子
    div，位置/大小全部用百分比(相對這張卡片自己的寬高)去算——因為同一張
    卡片在「主畫面」跟「放大編輯」視窗裡，容器的實際CSS像素尺寸完全不同
    (是縮放過的)，之前用固定px算漸層中心，沒有正確對到實際顯示尺寸，
    導致光暈跑位、疊出一條很醜的斷層線。百分比是相對容器自己實際尺寸算的，
    不管容器被縮放成多大/多小，天生就會跟著等比例縮放，不用額外處理scale。
    canvas匯出(drawExport)是另一條路，畫在邏輯座標(336x318)、已經用
    ctx.scale()處理好解析度了，跟這裡的DOM百分比法無關，維持原本px寫法。

    光暈顏色用 ColorUtils.lightenForGlow()算，同一套公式套用在任何底色上，
    不是寫死的顏色，所以之後要是有人把某張卡片底色換掉，光暈色會自動跟著算。
*/
window.Modules = window.Modules || {};
window.Modules.background = (function(){

  // 光暈參數：卡片本地座標(336x318邏輯尺寸)。左右兩張卡片blockRect.w/h
  // 都是336x318，所以左右共用同一組數字沒問題；DOM那邊實際換算成百分比時
  // 一律用cfg.blockRect.w/h當分母，不是寫死336/318，版型尺寸以後如果改了
  // 這裡也不用跟著改。
  var GLOW = {
    peakAlpha: 0.66,   // 中心最深處的透明度
    k: 0.45,           // 光暈色 = 底色同色相同飽和度，明度往白推45%（lightenForGlow的k）
    // sigma原本用你在檢測工具調出來的63，但那個工具只畫了虛線框，沒有疊
    // 真正的LOGO白底跟文字——實測63在文字區下緣還留了約11%的殘留亮度，
    // 疊上LOGO那塊白底看起來就像「光跑到文字那邊」。收緊成42，中心/亮度/
    // 顏色都不變，文字區下緣的殘留亮度會壓到1.3%以下，肉眼看不到。
    sigma: 42,         // 高斯柔化半徑（水平垂直同值，圓形光暈）
    cx: 159,           // 光暈中心 x（卡片本地座標）
    cy: 224,           // 光暈中心 y（卡片本地座標）
    outerFactor: 3,    // 漸層外緣半徑 = sigma * outerFactor（3倍sigma處已經趨近0，當作截止點）
    steps: 10          // 漸層分成幾段color-stop去逼近高斯曲線
  };
  var GLOW_R = GLOW.sigma * GLOW.outerFactor; // 漸層外緣半徑（邏輯px）

  // 依高斯公式 alpha = peakAlpha * exp(-(r/sigma)^2/2) 算出一串 {pos(0~1), alpha} 色標，
  // pos是漸層半徑的比例(0=中心, 1=外緣GLOW_R)，radial-gradient/canvas的
  // radial gradient都是用「半徑比例」在描述色標位置，用這組分段點可以逼近平滑的高斯曲線。
  function buildGlowStops(){
    var stops = [];
    for(var i=0;i<=GLOW.steps;i++){
      var t = i / GLOW.steps;
      var r = t * GLOW_R;
      var a = GLOW.peakAlpha * Math.exp(-(r*r)/(2*GLOW.sigma*GLOW.sigma));
      stops.push({ pos:t, alpha: Math.max(0, a) });
    }
    return stops;
  }

  function glowStopsCss(lrgb){
    return buildGlowStops().map(function(s){
      return 'rgba('+lrgb.r+','+lrgb.g+','+lrgb.b+','+s.alpha.toFixed(3)+') '+(s.pos*100).toFixed(1)+'%';
    }).join(', ');
  }

  // 建立光暈子div並定位(只在建立時算一次——位置/大小不會因為底色改變而變)。
  // ⚠ 故意「不」把光暈鎖在artZone的框框裡裁切：商品照片幾乎會填滿整個
  // artZone，跟光暈鎖同一個框等於兩個範圍完全重疊，商品一蓋上去光暈就會
  // 整個消失不見（真的發生過，商品放上去光暈完全不見了）。改成只靠柔化
  // 範圍(sigma)本身自然淡出去保證不碰文字——sigma=42已經算過，文字區
  // 下緣殘留亮度壓在1.3%以下、logo區更低，肉眼看不到——這樣光暈才能在
  // 商品沒蓋到的地方(商品周圍、artZone邊緣)繼續看得見，不會被商品整個蓋死。
  // 全部用百分比相對cfg.blockRect算，容器不管被縮放成多大都會自動對齊，
  // 不需要外部再傳scale進來。
  function makeGlowEl(cfg){
    var cardW = cfg.blockRect.w, cardH = cfg.blockRect.h;
    var glowEl = document.createElement('div');
    glowEl.className = 'skbn-bg-glow';
    glowEl.style.position = 'absolute';
    glowEl.style.left = (GLOW.cx / cardW * 100).toFixed(3) + '%';
    glowEl.style.top = (GLOW.cy / cardH * 100).toFixed(3) + '%';
    glowEl.style.width = (GLOW_R * 2 / cardW * 100).toFixed(3) + '%';
    glowEl.style.height = (GLOW_R * 2 / cardH * 100).toFixed(3) + '%';
    glowEl.style.transform = 'translate(-50%,-50%)';
    glowEl.style.borderRadius = '50%';
    glowEl.style.pointerEvents = 'none'; // 不能擋住商品圖的拖曳/縮放操作
    return glowEl;
  }

  function paintGlowEl(glowEl, baseHex){
    var lightHex = ColorUtils.lightenForGlow(baseHex, GLOW.k);
    var lrgb = ColorUtils.hexToRgb(lightHex);
    // ⚠ 一定要寫明 closest-side，不然CSS預設的漸層終點是farthest-corner
    // (盒子對角，比盒子邊緣遠sqrt(2)倍)，我的色標是照「0%=中心、100%=盒子
    // 邊緣(=GLOW_R)」算的，沒指定size的話，100%這個色標會被硬擠到對角線
    // 更遠的地方，實際到盒子邊緣時漸層都還沒退到透明就被盒子邊界整個切斷，
    // 變成一條很明顯的斷層線（就是你看到的那個）。closest-side讓漸層終點
    // 剛好對齊盒子邊緣，跟色標的0~100%定義一致，才會真的柔化到看不見。
    glowEl.style.background = 'radial-gradient(circle closest-side, ' + glowStopsCss(lrgb) + ')';
  }

  return {

    buildDom: function(el, slot, cfg, onChange, expanded, scale){
      // 注意：el 本身的 position(絕對定位 for主畫面 / relative for放大modal)
      // 是 core.js 依用途先設定好的容器，這裡絕對不能動 el.style.position，
      // 不然會把主畫面舞台裡的絕對定位蓋掉，卡片就會全部跑位（曾經踩過這個雷）。
      var baseHex = slot.bgColor || cfg.defaultColor || '#333';
      el.style.backgroundColor = baseHex;
      el.style.backgroundImage = 'none';
      el.style.overflow = 'hidden';

      var glowEl = null;
      if(cfg.glowEnabled){
        glowEl = makeGlowEl(cfg);
        paintGlowEl(glowEl, baseHex);
        // 一定要在logo/tag/product/cta/text之前插入——buildSlotContent保證
        // background.buildDom最先被呼叫，這裡append完才輪到其他Module，
        // 所以光暈天生就墊在最底層，不會蓋到LOGO/商品/文字；商品圖疊在
        // 光暈上面、蓋住中心那部分是預期內、正常的，商品周圍露出來的
        // 部分才是光暈真正看得到的地方。
        el.appendChild(glowEl);
      }

      if(expanded) return; // 放大編輯視窗右側已經有專門的背景色選色器，這裡不重複放

      var swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = slot.bgColor || cfg.defaultColor;

      var colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'colorpick';
      colorInput.value = /^#[0-9a-f]{6}$/i.test(slot.bgColor||'') ? slot.bgColor : '#333333';
      // ⚠ 拖曳選色時瀏覽器的色盤會連續觸發'input'事件(每移動一點就一次)，如果
      // 這裡面呼叫onChange()（main畫面是renderAll，會把整個#main砍掉重建），
      // colorInput這個DOM節點自己就被砍掉了——原生色盤是「錨定」在這個input
      // 元素上的，錨點消失瀏覽器就會自動把色盤關掉，變成「一拖曳就關閉」。
      // 'input'只做「輕量、不砍DOM」的視覺同步（包含光暈顏色跟著即時重算，
      // 位置/大小是固定的百分比不用重算），真正會整個重繪的onChange()
      // 改成綁在'change'——那個只在使用者放開/關閉色盤時才觸發一次，這時候
      // colorInput已經功成身退，砍掉重建完全沒問題。
      colorInput.oninput = function(){
        slot.bgColor = colorInput.value;
        el.style.backgroundColor = slot.bgColor;
        if(glowEl) paintGlowEl(glowEl, slot.bgColor);
        swatch.style.background = slot.bgColor;
      };
      colorInput.onchange = function(){ onChange(); };
      swatch.onclick = function(){ colorInput.click(); };

      el.appendChild(swatch);
      el.appendChild(colorInput);
    },

    drawExport: function(ctx, cfg, slot){
      var baseHex = slot.bgColor || cfg.defaultColor || '#333';
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      if(cfg.glowEnabled){
        var lightHex = ColorUtils.lightenForGlow(baseHex, GLOW.k);
        var lrgb = ColorUtils.hexToRgb(lightHex);
        var grad = ctx.createRadialGradient(GLOW.cx, GLOW.cy, 0, GLOW.cx, GLOW.cy, GLOW_R);
        buildGlowStops().forEach(function(s){
          grad.addColorStop(s.pos, 'rgba('+lrgb.r+','+lrgb.g+','+lrgb.b+','+s.alpha.toFixed(3)+')');
        });
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    }
  };
})();
