/* ============================================================
 * config.js —— 合心 站点配置（GitHub Pages + CloudBase 云数据库）
 * ------------------------------------------------------------
 * 页面托管在 GitHub Pages（公开仓，仅代码无秘密）。
 * 数据走腾讯云 CloudBase 云数据库（免费版即可，Web SDK 直连，
 *   绕开免费版 HTTP 云函数网关的 INVALID_ENV 坑）。
 *   - CLOUDBASE_ENV：云开发环境 ID（控制台「环境总览」复制，形如 tooth-xxxx）
 *   - APP_PASSWORD ：进入密码（前端校验；云数据库集合权限另设）
 *
 * 已弃用的后端方案（踩坑记录）：
 *   Netlify 函数（国内被墙）/ CloudBase HTTP 网关（免费版 INVALID_ENV）
 *   / Cloudflare Workers（workers.dev 国内连 VPN 都打不开）
 *   / LeanCloud（2026-01-12 起停服，新用户无法建应用）
 * ============================================================ */
window.APP_CONFIG = {
  CLOUDBASE_ENV: 'tooth-d2gr87yw44bc61b7',
  APP_PASSWORD: 'hearts',
  // 高德地图 Key（国内合规地图，推荐）。
  // 正式上线前请到 https://lbs.amap.com 控制台申请「Web端(JS API)」Key 与「安全密钥」，
  // 分别替换下方 AMAP_KEY 与 AMAP_SECURITY 占位符（2.0 版本必须配安全密钥）。
  AMAP_KEY: '9c1e381b996a5f2dab98a47f621d333d',
  AMAP_SECURITY: '0d114543903c17d67976845808c929f8'
};
