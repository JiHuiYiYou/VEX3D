import { useState } from 'react'

/** 规则说明抽屉：把本工具采用的规则原文和解读摊开，方便逐条核对 */
export function RulesDrawer() {
  const [open, setOpen] = useState(false)
  return (
    <section className="panel panel-rules">
      <button className="rules-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '收起规则说明' : '规则说明（本工具采用的解读）'}
      </button>
      {open && (
        <div className="rules-body">
          <p>
            <b>&lt;SC2&gt;</b> Pin 成为 placed 的条件：<i>与 Goal 有嵌套</i>，或<i>与一个已 placed 的
            Pin 啮合的 Cup 有嵌套</i>；同一个 Cup 半体里最多放 1 个 Pin。
          </p>
          <p>
            <b>&lt;SC3&gt;</b> 一个 placed 的 Pin 可以有 1 个或 2 个<b>得分端子</b>。端子
            <i>嵌在 Cup 的透明半体里</i>，或<i>未被 Cup 覆盖</i>时计分 —— 被<b>不透明(灰)杯</b>挡住则不得分。
          </p>
          <p>
            <b>联盟归属</b>：红端子→红方 5 分，蓝端子→蓝方 5 分，黄端子→拥有方 10 分。
            联盟桩的颜色<b>不改变</b>端子的归属（手册 图SC5-1 讲的是黄色端子的归属）。
          </p>
          <p>
            <b>&lt;SC5&gt;</b> 象限内的黄色 Pin 由<b>该象限 Toggle</b> 的颜色决定归属；Toggle
            设为黄色（没就位也一样）则双方都不拥有、不得分。中场高桩里的黄色 Pin 由
            <b>中场机器人数量多</b>的一方拥有，相等则双方都不得分。
          </p>
          <p>
            <b>翻转</b>：Pin = 两个半体（各红/蓝/黄），Cup = 透明半 + 灰半。翻转 = 交换上下两半。
            翻转 Cup 会改变它是用透明半还是灰半罩住下方的 Pin —— 直接影响那一半是否计分。
          </p>
          <p className="muted">
            以上解读与官方手册（v0.1 中英文）逐条对照过。若官方 Q&amp;A 有更新，只需改{' '}
            <code>src/state/scoring.ts</code> 一处；计分板上 hover 任意端子可看到本次判定的理由。
          </p>
        </div>
      )}
    </section>
  )
}
