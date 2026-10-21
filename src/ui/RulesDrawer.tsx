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
            <b>罩住关系</b>（CAD 实测）：Cup 的<b>下半</b>罩住它<i>下面</i>那个 Pin 的<b>上半</b>；
            Cup 的<b>上半</b>罩住它<i>上面</i>那个 Pin 的<b>下半</b>。
            <br />
            换句话说，<b>Pin 的上半看它上面那个 Cup 的下半，Pin 的下半看它下面那个 Cup 的上半</b>。
            <br />
            <b>Goal 也挡分</b>：直接插在桩孔里的那个 Pin，<b>下半整个埋在桩的 socket 里 → 不计分</b>。
          </p>
          <p>
            <b>拆卸</b>：得分物不能悬空 —— 拆掉一个，<b>它上面的 Pin / Cup 一并拆掉</b>。
          </p>
          <p>
            <b>摆放规则</b>：<i>Pin 只能放在 Cup 上，或直接放在 Goal 上</i>；<i>Cup 只能放在 Pin 上</i>。
            所以合法的摞必然是 Pin / Cup / Pin / Cup 交替，其它组合一律拒绝。
            <br />
            <b>翻转</b>对 Cup 来说很关键：Cup 的上下两半分别是透明和不透明，翻过来就换了
            <i>哪一半在罩谁</i>，直接决定被罩住的那一端子计不计分。
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
            <b>两种件的形状不一样</b>：Pin = 两个半体<b>翻边对翻边</b>（线轴，腰在中间）；
            Cup = 两个半体<b>杯口对杯口</b>（沙漏，两端敞口宽沿、中间 Ø59 细腰）。
            <b>翻转</b> = 交换上下两半：Pin 换的是颜色，Cup 换的是<i>哪一半在罩谁</i>。
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
