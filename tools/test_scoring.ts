/**
 * 计分引擎的回归测试（Node 24 原生剥离类型，直接跑 .ts）。
 *
 *   node tools/test_scoring.ts
 *
 * scoring.ts 只有 type-only 的 import，所以可以被 node 直接加载。
 */
import { scoreField, checkPlacement } from '../src/state/scoring.ts'
import type { StackItem } from '../src/state/scoring.ts'

type Goal = Parameters<typeof scoreField>[0]['goals'][number]
type Toggles = Parameters<typeof scoreField>[0]['toggles']

let failures = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`)
}

const goal = (id: string, quadrant: Goal['quadrant'], alliance: 'red' | 'blue' | null): Goal =>
  ({
    id,
    variant: alliance === 'red' ? 'alliance-red' : alliance === 'blue' ? 'alliance-blue' : 'neutral-short',
    position: [0, 0, 0],
    rotationY: 0,
    quadrant,
    alliance,
    height: 146.5,
    baseRadius: 90,
    topRadius: 56,
    socket: { x: 0, y: 0, z: 134.5, radius: 22, depth: 45 },
  }) as Goal

const pin = (a: string, b: string): StackItem => ({
  id: `pin-${a}-${b}`,
  kind: 'pin',
  halves: [a, b] as StackItem extends { kind: 'pin'; halves: infer H } ? H : never,
})
const cup = (lower: 'clear' | 'gray', upper: 'clear' | 'gray'): StackItem => ({
  id: `cup-${lower}-${upper}`,
  kind: 'cup',
  halves: [lower, upper],
})

const G = {
  n1: goal('g-n1', 'top', null), // 上象限中立桩
  r1: goal('g-r1', 'left', 'red'), // 左象限红方桩
  mid: goal('g-center', 'midfield', null), // 中场中立高桩
}

const toggles = (o: Partial<Toggles> = {}): Toggles => ({
  top: 'yellow',
  right: 'yellow',
  bottom: 'yellow',
  left: 'yellow',
  ...o,
})

const run = (stacks: Record<string, StackItem[]>, t: Toggles, midfield = { red: 0, blue: 0 }) =>
  scoreField({ stacks, toggles: t, goals: [G.n1, G.r1, G.mid], midfieldCounts: midfield })

console.log('\n── 场景 1：中立桩上的黄黄 Pin，Toggle 是黄色 → 谁都不拥有 → 0 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles())
  eq('红方 0 分', r.red, 0)
  eq('蓝方 0 分', r.blue, 0)
  eq('两个端子都是 placed', r.halves.filter((h) => h.placed).length, 2)
  eq('但都没得分（黄色没人拥有）', r.halves.filter((h) => h.scored).length, 0)
}

console.log('\n── 场景 2：同一个 Pin，把该象限 Toggle 设成红色 → 只有上半得分 10 分（下半插在桩孔里被挡住）──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles({ top: 'red' }))
  eq('红方 10 分（只有上半那半个黄端子）', r.red, 10)
  eq('蓝方 0 分', r.blue, 0)
  eq('下半的理由写明被 goal 挡住', r.halves.some((h) => h.reason.includes('被 goal 挡住')), true)
}

console.log('\n── 场景 3：Toggle 设为蓝色 → 蓝方 10 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles({ top: 'blue' }))
  eq('红方 0 分', r.red, 0)
  eq('蓝方 10 分', r.blue, 10)
}

console.log('\n── 场景 4：Toggle 设为黄色 → 黄色 Pin 不得分（手册 <SC5>a）──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles({ top: 'yellow' }))
  eq('红方 0 分', r.red, 0)
  eq('蓝方 0 分', r.blue, 0)
}

console.log('\n── 场景 5：黄色 Pin 上面盖一个「下半是灰」的 Cup → 上半被灰杯挡住，下半被桩挡住 → 0 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow'), cup('gray', 'clear')] }, toggles({ top: 'red' }))
  eq('红方 0 分', r.red, 0)
  eq('两个端子都不计分', r.halves.filter((h) => h.placed && !h.scored).length, 2)
  eq('理由写明被不透明杯遮挡', r.halves.some((h) => h.reason.includes('不透明')), true)
}

console.log('\n── 场景 6：把 Cup 翻过来（下半变透明）→ 上半在透明半里照常得分 → 10 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow'), cup('clear', 'gray')] }, toggles({ top: 'red' }))
  eq('红方 10 分', r.red, 10)
  eq('只有下半（被桩挡住）不计分', r.halves.filter((h) => h.placed && !h.scored).length, 1)
}

console.log('\n── 场景 7：联盟桩里的蓝蓝 Pin → 按端子自身颜色算给蓝方（桩色不改变归属）──')
{
  const r = run({ 'g-r1': [pin('blue', 'blue')] }, toggles())
  eq('红方 0 分', r.red, 0)
  eq('蓝方 5 分（只有上半那半个蓝端子）', r.blue, 5)
}

console.log('\n── 场景 8：红方桩里的红黄 Pin（下半红 / 上半黄）→ 下半被桩挡住；上半黄归左象限 Toggle ──')
{
  const r = run({ 'g-r1': [pin('red', 'yellow')] }, toggles({ left: 'blue' }))
  eq('红方 0 分（下半的红端子被桩挡住）', r.red, 0)
  eq('蓝方 10 分（上半的黄端子被左象限 Toggle 拥有）', r.blue, 10)
}

console.log('\n── 场景 9：中场高桩里的黄黄 Pin，双方中场机器人都是 0 → 0 分（平局谁都不拥有）──')
{
  const r = run({ 'g-center': [pin('yellow', 'yellow')] }, toggles())
  eq('红方 0 分', r.red, 0)
  eq('蓝方 0 分', r.blue, 0)
}

console.log('\n── 场景 10：中场蓝方机器人更多 → 中场黄色 Pin 归蓝方（下半被桩挡住，只剩上半）──')
{
  const r = run({ 'g-center': [pin('yellow', 'yellow')] }, toggles(), { red: 0, blue: 1 })
  eq('黄半 10 分 + 1 台中场机器人 8 分 = 蓝方 18 分', r.blue, 18)
  eq('机器人得分 8 分', r.robotPoints.blue, 8)
}

console.log('\n── 场景 11：Pin 直接压在另一个 Pin 上（中间没有 Cup）→ 不算 placed ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), pin('red', 'red')] }, toggles())
  eq('只有最下面那个 Pin 的端子算 placed', r.halves.filter((h) => h.placed).length, 2)
  eq('只有下面那个 Pin 的上半得分（下半被桩挡住）', r.halves.filter((h) => h.scored).length, 1)
}

console.log('\n── 场景 12：Pin → 灰杯 → Pin：灰杯挡住上面 Pin 的下半、下面 Pin 的上半，加上桩挡住最底下的下半 ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), cup('gray', 'gray'), pin('blue', 'blue')] }, toggles())
  eq('两个 Pin 的 4 个端子都 placed', r.halves.filter((h) => h.placed).length, 4)
  eq('3 个端子不得分（2 个被灰杯挡 + 1 个被桩挡）', r.blocked, 3)
  eq('红方 0 分（红 Pin 两半都被挡）', r.red, 0)
  eq('蓝方 5 分（蓝 Pin 的上半）', r.blue, 5)
}

console.log('\n── 场景 13：Pin → 杯（下半透明/上半灰）→ Pin：下半透明 → 下面 Pin 的上半照样得分；上半灰 → 上面 Pin 的下半被挡 ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), cup('clear', 'gray'), pin('blue', 'blue')] }, toggles())
  eq('2 个端子得分', r.halves.filter((h) => h.scored).length, 2)
  eq('2 个端子被挡（1 个灰半 + 1 个桩）', r.blocked, 2)
  eq('红方 5 分（下面那个 Pin 的上半，在透明半里）', r.red, 5)
  eq('蓝方 5 分（上面那个 Pin 只剩上半）', r.blue, 5)
}

console.log('\n── 场景 14：同一个摞把 Cup 翻过来（下半灰/上半透明）→ 挡的那一半也换了人 ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), cup('gray', 'clear'), pin('blue', 'blue')] }, toggles())
  eq('2 个端子得分', r.halves.filter((h) => h.scored).length, 2)
  eq('2 个端子被挡（1 个灰半 + 1 个桩）', r.blocked, 2)
  eq('红方 0 分（红 Pin 两半都被挡）', r.red, 0)
  eq('蓝方 10 分（上面那个 Pin 的两半）', r.blue, 10)
}

console.log('\n── 场景 15：五层交替摞 Pin→Cup→Pin→Cup→Pin ──')
{
  const r = run(
    {
      'g-n1': [
        pin('red', 'red'),
        cup('clear', 'gray'),
        pin('blue', 'blue'),
        cup('gray', 'clear'),
        pin('red', 'red'),
      ],
    },
    toggles(),
  )
  eq('6 个端子都 placed', r.halves.filter((h) => h.placed).length, 6)
  eq('3 个端子得分', r.halves.filter((h) => h.scored).length, 3)
  eq('3 个端子被挡（2 个灰半 + 1 个桩）', r.blocked, 3)
  eq('红方 15 分（最底下那个红 Pin 只剩上半）', r.red, 15)
  eq('蓝方 0 分（中间蓝 Pin 两半都被挡）', r.blue, 0)
}

console.log('\n── 场景 16：黄色 Pin 放在 Cup 上（黄色归属仍按 Toggle 算）──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow'), cup('clear', 'gray')] }, toggles({ top: 'red' }))
  eq('红方 10 分（只有上半那个黄半，在透明半里）', r.red, 10)
}

console.log('\n── 场景 17：Cup 直接放在 Goal 上（非法摞）→ 引擎不炸、也不计分 ──')
{
  const r = run({ 'g-n1': [cup('clear', 'gray')] }, toggles())
  eq('没有任何端子', r.halves.length, 0)
  eq('红方 0 分', r.red, 0)
  eq('蓝方 0 分', r.blue, 0)
}

console.log('\n── 场景 18：每台位于中场的机器人 8 分（赛局结束时在中场）──')
{
  // 中场放一个黄 pin：红方 1 台 vs 蓝方 2 台 → 蓝方机器人数多
  const r = run({ 'g-center': [pin('yellow', 'yellow')] }, toggles(), { red: 1, blue: 2 })
  eq('蓝方 2 台机器人 = 16 分', r.robotPoints.blue, 16)
  eq('红方 1 台机器人 = 8 分', r.robotPoints.red, 8)
  eq('蓝方总分 16 + 10（黄半）= 26', r.blue, 26)
  eq('红方总分 8 + 0 = 8', r.red, 8)
}

console.log('\n── 场景 19：没有中场的机器人 → 不加机器人分 ──')
{
  const r = run({ 'g-n1': [pin('red', 'red')] }, toggles(), { red: 0, blue: 0 })
  eq('双方机器人 0 分', r.robotPoints.red + r.robotPoints.blue, 0)
}

console.log('\n── 场景 20：中场机器人数每方最多 2 台（每方只有 2 台机器人）──')
{
  const r = run({ 'g-center': [pin('yellow', 'yellow')] }, toggles(), { red: 2, blue: 2 })
  eq('红方 2 台 = 16 分', r.robotPoints.red, 16)
  eq('蓝方 2 台 = 16 分', r.robotPoints.blue, 16)
}

console.log('\n── 摆放合法性：Pin 只能放 Cup 上或直接放桩上，Cup 只能放 Pin 上 ──')
{
  eq('空桩上放 Pin → 合法', checkPlacement('pin', []).ok, true)
  eq('空桩上放 Cup → 拒绝', checkPlacement('cup', []).ok, false)
  eq('拒绝理由提到 cup', checkPlacement('cup', []).reason.includes('cup'), true)
  eq('Pin 上放 Cup → 合法', checkPlacement('cup', [pin('red', 'red')]).ok, true)
  eq('Pin 上放 Pin → 拒绝', checkPlacement('pin', [pin('red', 'red')]).ok, false)
  eq('Cup 上放 Pin → 合法', checkPlacement('pin', [pin('red', 'red'), cup('clear', 'gray')]).ok, true)
  eq('Cup 上放 Cup → 拒绝', checkPlacement('cup', [pin('red', 'red'), cup('clear', 'gray')]).ok, false)
  eq('三摞（顶上是 Pin）再放 Cup → 合法', checkPlacement('cup', [pin('red', 'red'), cup('clear', 'gray'), pin('blue', 'blue')]).ok, true)
  eq('三摞（顶上是 Pin）再放 Pin → 拒绝', checkPlacement('pin', [pin('red', 'red'), cup('clear', 'gray'), pin('blue', 'blue')]).ok, false)
}

console.log(failures === 0 ? '\n全部通过 ✅\n' : `\n${failures} 项失败 ❌\n`)
process.exit(failures === 0 ? 0 : 1)
