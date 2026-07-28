/* ============================================================
 * config.js —— 合心 站点配置（GitHub Pages + 后端代理版）
 * ------------------------------------------------------------
 * 页面托管在 GitHub Pages（公开仓，仅代码无秘密），
 * 数据接口走后端云函数（令牌在服务器端，不在此处）。
 *   - API_BASE    ：后端接口绝对地址
 *   - APP_PASSWORD：进入密码（前端校验 + 后端校验，双重保护）
 *
 * 后端地址可切换：
 *   1) Netlify（默认）：https://hexin-diary.netlify.app/api
 *      优点：已部署，无需额外操作；缺点：国内部分网络访问困难。
 *   2) 腾讯云 CloudBase（推荐国内使用）
 *      部署 cloudbase/hexin-api.zip 后，把下面的 API_BASE 改成：
 *      https://<你的环境ID>.<地域>.app.tcloudbase.com/api
 *      并在 CloudBase 函数环境变量里设置同样的 APP_PASSWORD。
 *
 * 想改进入密码时，前端这里和后端环境变量都要改且保持一致。
 * ============================================================ */
window.APP_CONFIG = {
  API_BASE: 'https://hexin-diary.netlify.app/api',
  APP_PASSWORD: 'hearts'
};
