「系統元素」資料庫：LOGO 圖檔放這裡，依活動類型分三個子資料夾：
  festival/       造節
  site-wide-sale/ 全站大促
  common/         常用建檔
放圖之後，記得到 ../data/asset-library.json 的 systemElements 底下對應分類補一筆
{ id, brand, name, type, path }，type 固定填 "logo"。

（掛標／CTA不放在這裡——它們是全站共用的固定白/紅版兩張圖，放在
shared/ 子資料夾，見 shared/README.txt 跟 ../configs/shared-elements.js）
