'use strict';
/*
  background-module.js
  ------------------------------------------------------------
  這一張卡片本身的底色（圓角矩形範圍，圓角/尺寸/位置都來自cfg.blockRect，
  這支不用管那些數字，Core已經把容器準備成正確的大小/圓角了，這裡只管上色）：
    1. buildDom()   —— 設定卡片容器背景色 + 一顆可以叫出系統色盤的小圓點
    2. drawExport() —— 匯出時把暫存canvas(卡片自己座標系，0,0起)整個塗滿背景色
                       （呼叫端已經clip好圓角範圍，這裡單純fillRect全滿即可）
*/
window.Modules = window.Modules || {};
window.Modules.background = {

  buildDom: function(el, slot, cfg, onChange, expanded){
    // 注意：el 本身的 position(絕對定位 for主畫面 / relative for放大modal)
    // 是 core.js 依用途先設定好的容器，這裡絕對不能動 el.style.position，
    // 不然會把主畫面舞台裡的絕對定位蓋掉，卡片就會全部跑位（曾經踩過這個雷）。
    el.style.background = slot.bgColor || cfg.defaultColor || '#333';
    el.style.overflow = 'hidden';

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
    // 'input'只做「輕量、不砍DOM」的視覺同步，真正會整個重繪的onChange()
    // 改成綁在'change'——那個只在使用者放開/關閉色盤時才觸發一次，這時候
    // colorInput已經功成身退，砍掉重建完全沒問題。
    colorInput.oninput = function(){
      slot.bgColor = colorInput.value;
      el.style.background = slot.bgColor;
      swatch.style.background = slot.bgColor;
    };
    colorInput.onchange = function(){ onChange(); };
    swatch.onclick = function(){ colorInput.click(); };

    el.appendChild(swatch);
    el.appendChild(colorInput);
  },

  drawExport: function(ctx, cfg, slot){
    ctx.fillStyle = slot.bgColor || cfg.defaultColor || '#333';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
};
