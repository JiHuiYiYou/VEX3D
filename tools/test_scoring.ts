/**
 * 计分引擎的回归测试（Node 24 原生剥离类型，直接跑 .ts）。
 *
 *   node tools/test_scoring.ts
 *
 * scoring.ts 只有 type-only 的 import，所以可以被 node 直接加载。
 */
import { scoreField } from '../src/state/scoring.ts'
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

console.log('\n── 场景 2：同一个 Pin，把该象限 Toggle 设成红色 → 20 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles({ top: 'red' }))
  eq('红方 20 分（两个黄色端子各 10）', r.red, 20)
  eq('蓝方 0 分', r.blue, 0)
}

console.log('\n── 场景 3：Toggle 设为蓝色 → 蓝方 20 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles({ top: 'blue' }))
  eq('红方 0 分', r.red, 0)
  eq('蓝方 20 分', r.blue, 20)
}

console.log('\n── 场景 4：Toggle 设为黄色 → 黄色 Pin 不得分（手册 <SC5>a）──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow')] }, toggles({ top: 'yellow' }))
  eq('红方 0 分', r.red, 0)
  eq('蓝方 0 分', r.blue, 0)
}

console.log('\n── 场景 5：黄色 Pin 上面盖一个「下半是灰」的 Cup → 下半得分，上半被挡 → 10 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow'), cup('gray', 'clear')] }, toggles({ top: 'red' }))
  eq('红方 10 分（只有下半）', r.red, 10)
  eq('被挡的端子不计分', r.halves.filter((h) => h.placed && !h.scored).length, 1)
  eq('理由写明被不透明杯遮挡', r.halves.some((h) => h.reason.includes('不透明')), true)
}

console.log('\n── 场景 6：把 Cup 翻过来（下半变透明）→ 两个端子都得分 → 20 分 ──')
{
  const r = run({ 'g-n1': [pin('yellow', 'yellow'), cup('clear', 'gray')] }, toggles({ top: 'red' }))
  eq('红方 20 分', r.red, 20)
  eq('没有被挡的端子', r.halves.filter((h) => h.placed && !h.scored).length, 0)
}

console.log('\n── 场景 7：联盟桩里的蓝蓝 Pin → 按端子自身颜色算给蓝方（桩色不改变归属）──')
{
  const r = run({ 'g-r1': [pin('blue', 'blue')] }, toggles())
  eq('红方 0 分', r.red, 0)
  eq('蓝方 10 分（两个端子各 5 分）', r.blue, 10)
}

console.log('\n── 场景 8：红方桩里的红黄 Pin → 红半 5 分给红方，黄半归该象限 Toggle ──')
{
  const r = run({ 'g-r1': [pin('red', 'yellow')] }, toggles({ left: 'blue' }))
  eq('红方 5 分', r.red, 5)
  eq('蓝方 10 分（黄色被左象限 Toggle 拥有）', r.blue, 10)
}

console.log('\n── 场景 9：中场高桩里的黄黄 Pin，双方中场机器人都是 0 → 0 分（平局谁都不拥有）──')
{
  const r = run({ 'g-center': [pin('yellow', 'yellow')] }, toggles())
  eq('红方 0 分', r.red, 0)
  eq('蓝方 0 分', r.blue, 0)
}

console.log('\n── 场景 10：中场蓝方机器人更多 → 中场黄色 Pin 归蓝方 ──')
{
  const r = run({ 'g-center': [pin('yellow', 'yellow')] }, toggles(), { red: 0, blue: 1 })
  eq('蓝方 20 分', r.blue, 20)
}

console.log('\n── 场景 11：Pin 直接压在另一个 Pin 上（中间没有 Cup）→ 不算 placed ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), pin('red', 'red')] }, toggles())
  eq('只有最下面那个 Pin 的端子算 placed', r.halves.filter((h) => h.placed).length, 2)
  eq('上面那个 Pin 不计分', r.halves.filter((h) => h.scored).length, 2)
}

console.log('\n── 场景 12：Pin → 灰杯 → Pin：中间的灰杯同时挡住上面 Pin 的下半和下面 Pin 的上半 ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), cup('gray', 'gray'), pin('blue', 'blue')] }, toggles())
  eq('两个 Pin 的 4 个端子都 placed', r.halves.filter((h) => h.placed).length, 4)
  eq('被灰杯挡住的 2 个端子不得分', r.halves.filter((h) => h.placed && !h.scored).length, 2)
  eq('红方 5 分（红 Pin 的下半）', r.red, 5)
  eq('蓝方 5 分（蓝 Pin 的上半）', r.blue, 5)
}

console.log('\n── 场景 13：Pin → 透明杯 → Pin：透明杯不挡分，4 个端子全得分 ──')
{
  const r = run({ 'g-n1': [pin('red', 'red'), cup('clear', 'gray'), pin('blue', 'blue')] }, toggles())
  eq('4 个端子都得分', r.halves.filter((h) => h.scored).length, 4)
  eq('红方 10 分', r.red, 10)
  eq('蓝方 10 分', r.blue, 10)
}

console.log(failures === 0 ? '\n全部通过 ✅\n' : `\n${failures} 项失败 ❌\n`)
process.exit(failures === 0 ? 0 : 1)
