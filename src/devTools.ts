/**
 * 要不要把内部对象挂到 `window` 上（给端到端脚本用）。
 *
 * - **开发模式**：总是开（`tools/verify_ui.py` 就靠这些全局量检查内部状态）。
 * - **生产构建**：要显式加 `?debug=1` 才开。
 *
 * ★ 为什么要留这个开关：发布出去的站得能用**同一套 61 条断言**验一遍 ——
 *   资产路径对不对（GitHub Pages 挂在子路径下，最容易在这里翻车）、
 *   模型有没有加载、点 goal 放不放得上去… 这些只有跑一遍才算数。
 *   平时不开 → 不往 window 上挂任何东西。
 */
export const DEBUG =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')
