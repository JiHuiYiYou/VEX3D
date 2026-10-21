/**
 * 官方开局布局（「摆场」预设）
 * 
 * 数据来自官方手册的俯视示意图 `2D俯视示意图.png`，用图里 4 根黄色 toggle
 * 标定后逐个读出来的 —— 抠图脚本：`tools/extract_setup.py`。
 * 
 * · goal 上：4 个中立 goal + 中场 goal 各插一根黄/黄 pin，4 个联盟 goal 空着
 * · 场地散件：站在垫子上的 cup（有的里面插着 pin）
 * · 墙边：北/南墙内侧各 2 组 (cup, pin, cup)
 * · 装填区：红/蓝胶带里各 10 行 (cup + pin)，外加几个躺平的 pin
 *
 * 散件**不参与计分**（手册只算 goal 里的 pin 和中场的机器人）。
 */
import type { LooseItem } from '@/state/store'
import type { StackItem } from '@/state/scoring'

export const INITIAL_SETUP_BUILD = 'override-0.1-2026-04-28'

/** goal 上开局就有的得分物 */
export const INITIAL_GOAL_STACKS: Record<string, StackItem[]> = {
  'g-n1': [{ id: 'g-n1-0', kind: 'pin', halves: ['yellow', 'yellow'] }],
  'g-n2': [{ id: 'g-n2-0', kind: 'pin', halves: ['yellow', 'yellow'] }],
  'g-n3': [{ id: 'g-n3-0', kind: 'pin', halves: ['yellow', 'yellow'] }],
  'g-n4': [{ id: 'g-n4-0', kind: 'pin', halves: ['yellow', 'yellow'] }],
  'g-center': [{ id: 'g-center-0', kind: 'pin', halves: ['yellow', 'yellow'] }],
}

/** 场上所有不在 goal 里的得分物 */
export const INITIAL_LOOSE: LooseItem[] = [
  { id: 'loose-0', kind: 'pin', halves: ['yellow', 'yellow'], x: -574, y: 1716 },
  { id: 'loose-1', kind: 'pin', halves: ['yellow', 'yellow'], x: 582, y: 1716 },
  { id: 'loose-2', kind: 'pin', halves: ['yellow', 'yellow'], x: -574, y: -1697 },
  { id: 'loose-3', kind: 'pin', halves: ['yellow', 'yellow'], x: 583, y: -1696 },
  { id: 'loose-4', kind: 'cup', halves: ['clear', 'gray'], x: -1168, y: 1206 },
  { id: 'loose-5', kind: 'pin', halves: ['yellow', 'red'], x: -1168, y: 1206, z: 164 },
  { id: 'loose-6', kind: 'cup', halves: ['clear', 'gray'], x: -1701, y: 736 },
  { id: 'loose-7', kind: 'pin', halves: ['yellow', 'yellow'], x: -1701, y: 736, z: 164 },
  { id: 'loose-8', kind: 'cup', halves: ['clear', 'gray'], x: 1687, y: 736 },
  { id: 'loose-9', kind: 'pin', halves: ['yellow', 'yellow'], x: 1687, y: 736, z: 164 },
  { id: 'loose-10', kind: 'cup', halves: ['clear', 'gray'], x: -588, y: 618 },
  { id: 'loose-11', kind: 'cup', halves: ['clear', 'gray'], x: -1701, y: 526 },
  { id: 'loose-12', kind: 'cup', halves: ['clear', 'gray'], x: 1687, y: 526 },
  { id: 'loose-13', kind: 'cup', halves: ['clear', 'gray'], x: -1700, y: 340 },
  { id: 'loose-14', kind: 'cup', halves: ['clear', 'gray'], x: 1688, y: 340 },
  { id: 'loose-15', kind: 'cup', halves: ['clear', 'gray'], x: -1701, y: -423 },
  { id: 'loose-16', kind: 'pin', halves: ['yellow', 'yellow'], x: -1701, y: -423, z: 164 },
  { id: 'loose-17', kind: 'cup', halves: ['clear', 'gray'], x: 1687, y: -423 },
  { id: 'loose-18', kind: 'pin', halves: ['yellow', 'yellow'], x: 1687, y: -423, z: 164 },
  { id: 'loose-19', kind: 'cup', halves: ['clear', 'gray'], x: 583, y: -541 },
  { id: 'loose-20', kind: 'pin', halves: ['yellow', 'red'], x: 583, y: -541, z: 164 },
  { id: 'loose-21', kind: 'cup', halves: ['clear', 'gray'], x: -1700, y: -629 },
  { id: 'loose-22', kind: 'cup', halves: ['clear', 'gray'], x: 1688, y: -629 },
  { id: 'loose-23', kind: 'cup', halves: ['clear', 'gray'], x: -1701, y: -816 },
  { id: 'loose-24', kind: 'cup', halves: ['clear', 'gray'], x: 1687, y: -816 },
  { id: 'loose-25', kind: 'cup', halves: ['clear', 'gray'], x: 1159, y: -1122 },
  { id: 'loose-26', kind: 'pin', halves: ['yellow', 'red'], x: 1159, y: -1122, z: 164 },
  { id: 'loose-27', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: 860 },
  { id: 'loose-28', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: 860 },
  { id: 'loose-29', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: 860 },
  { id: 'loose-30', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: 860 },
  { id: 'loose-31', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: 689 },
  { id: 'loose-32', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: 689 },
  { id: 'loose-33', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: 689 },
  { id: 'loose-34', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: 689 },
  { id: 'loose-35', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: 517 },
  { id: 'loose-36', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: 517 },
  { id: 'loose-37', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: 517 },
  { id: 'loose-38', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: 517 },
  { id: 'loose-39', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: 343 },
  { id: 'loose-40', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: 343 },
  { id: 'loose-41', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: 343 },
  { id: 'loose-42', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: 343 },
  { id: 'loose-43', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: 172 },
  { id: 'loose-44', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: 172 },
  { id: 'loose-45', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: 172 },
  { id: 'loose-46', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: 172 },
  { id: 'loose-47', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: 0 },
  { id: 'loose-48', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: 0 },
  { id: 'loose-49', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: 0 },
  { id: 'loose-50', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: 0 },
  { id: 'loose-51', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: -173 },
  { id: 'loose-52', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: -173 },
  { id: 'loose-53', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: -173 },
  { id: 'loose-54', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: -173 },
  { id: 'loose-55', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: -346 },
  { id: 'loose-56', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: -346 },
  { id: 'loose-57', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: -346 },
  { id: 'loose-58', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: -346 },
  { id: 'loose-59', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: -517 },
  { id: 'loose-60', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: -517 },
  { id: 'loose-61', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: -517 },
  { id: 'loose-62', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: -517 },
  { id: 'loose-63', kind: 'cup', halves: ['clear', 'gray'], x: -2632, y: -689 },
  { id: 'loose-64', kind: 'pin', halves: ['red', 'yellow'], x: -2445, y: -689 },
  { id: 'loose-65', kind: 'pin', halves: ['blue', 'yellow'], x: 2436, y: -689 },
  { id: 'loose-66', kind: 'cup', halves: ['clear', 'gray'], x: 2608, y: -689 },
  { id: 'loose-67', kind: 'pin', halves: ['red', 'yellow'], x: -2200, y: 1177 },
  { id: 'loose-68', kind: 'pin', halves: ['red', 'yellow'], x: -2200, y: 0 },
  { id: 'loose-69', kind: 'pin', halves: ['red', 'yellow'], x: -2200, y: -1159 },
  { id: 'loose-70', kind: 'pin', halves: ['blue', 'yellow'], x: 2180, y: 26 },
  { id: 'loose-71', kind: 'pin', halves: ['blue', 'yellow'], x: 2180, y: -1100 },
]
