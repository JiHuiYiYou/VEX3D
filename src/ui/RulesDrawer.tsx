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
            <b>&lt;SC2&gt;</b> Pin 成为 placed 的条件：<i>与 goal 有嵌套</i>，或<i>与一个已 placed 的
            pin 啮合的 cup 有嵌套</i>；同一个 cup 半里最多放 1 个 pin。
          </p>
          <p>
            <b>&lt;SC3&gt;</b> 一个 placed 的 pin 可以有 1 个或 2 个<b>得分的半</b>。这个半
            <i>嵌在 cup 的透明半里</i>，或<i>未被 cup 覆盖</i>时计分 —— 被<b>不透明(灰)cup</b>挡住则不得分。
          </p>
          <p>
            <b>罩住关系</b>（CAD 实测）：cup 的<b>下半</b>罩住它<i>下面</i>那个 pin 的<b>上半</b>；
            cup 的<b>上半</b>罩住它<i>上面</i>那个 pin 的<b>下半</b>。
            <br />
            换句话说，<b>pin 的上半看它上面那个 cup 的下半，pin 的下半看它下面那个 cup 的上半</b>。
            <br />
            <b>goal 也挡分</b>：直接插在 goal 孔里的那个 pin，<b>下半整个埋在 goal 的 socket 里 → 不计分</b>。
          </p>
          <p>
            <b>拆卸</b>：得分物不能悬空 —— 拆掉一个，<b>它上面的 pin / cup 一并拆掉</b>。
          </p>
          <p>
            <b>摆放规则</b>：<i>pin 只能放在 cup 上，或直接放在 goal 上</i>；<i>cup 只能放在 pin 上</i>。
            所以合法的摞必然是 pin / cup / pin / cup 交替，其它组合一律拒绝。
            <br />
            <b>翻转</b>对 cup 来说很关键：cup 的上下两半分别是透明和不透明，翻过来就换了
            <i>哪一半在罩谁</i>，直接决定被罩住的那一半计不计分。
          </p>
          <p>
            <b>联盟归属</b>：红半 → 红方 5 分，蓝半 → 蓝方 5 分，黄半 → 拥有方 10 分。
            联盟 goal 的颜色<b>不改变</b>归属（手册 图 SC5-1 讲的是黄色半的归属）。
          </p>
          <p>
            <b>&lt;SC5&gt;</b> 区域内的黄色 pin 由<b>该区域 toggle</b> 的颜色决定归属；toggle
            设为黄色（没就位也一样）则双方都不拥有、不得分。中场高 goal 里的黄色 pin 由
            <b>中场机器人数量多</b>的一方拥有，相等则双方都不得分（左侧面板可以填机器人数）。
          </p>
          <p>
            <b>中场机器人</b>：赛局结束时<b>每台位于中场的机器人</b>给它的联队 <b>8 分</b>；
            同一批机器人数还决定中场的黄色 pin 归谁（见上一条）。
          </p>
          <p>
            <b>两种件的形状不一样</b>：pin = 两个半<b>翻边对翻边</b>（线轴，腰在中间）；
            cup = 两个半<b>杯口对杯口</b>（沙漏，两端敞口宽沿、中间 Ø59 细腰）。
            <b>翻转</b> = 交换上下两半：pin 换的是颜色，cup 换的是<i>哪一半在罩谁</i>。
          </p>
          <p className="muted">
            以上解读与官方手册（v0.1 中英文）逐条对照过。若官方 Q&amp;A 有更新，只需改{' '}
            <code>src/state/scoring.ts</code> 一处；计分板上 hover 任意 pin 可看到本次判定的理由。
          </p>
        </div>
      )}
    </section>
  )
}
