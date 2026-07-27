/* ============================================================
 * config.js —— 合心 站点配置（GitHub Pages + Netlify 后端版）
 * ------------------------------------------------------------
 * 页面托管在 GitHub Pages（公开仓，仅代码无秘密），
 * 数据接口走已在线的 Netlify 函数（令牌在服务器端，不在此处）。
 *   - API_BASE    ：后端接口绝对地址（Netlify 无服务器函数）
 *   - APP_PASSWORD：进入密码（前端校验 + 后端校验，双重保护）
 *
 * 想改进入密码时，两处都要改且保持一致：
 *   1) 这里把 APP_PASSWORD 改成你们俩约定的词
 *   2) 在 Netlify 后台 Site settings → Environment variables 改
 *      APP_PASSWORD = 同一个词
 * ============================================================ */
window.APP_CONFIG = {
  API_BASE: 'https://hexin-diary.netlify.app/api',
  APP_PASSWORD: 'hearts'
};
