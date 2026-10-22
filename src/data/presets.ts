/**
 * 官方开局布局（「摆场」预设）
 *
 * 数据来自 **官方 Field CAD** 里那 63 根 pin + 56 个 cup 的开局摆法
 * （`tools/extract_field.py` 导出的 `field.json` → `startObjects`），
 * 由 `tools/extract_setup.py` 转成本文件。
 *
 * 这份摆法跟官方 VEXcode VR Playground 的 GPS 坐标表逐点吻合（最大 5.5 mm），
 * 得分物数量也跟官方清单一致：场上 37 根 pin + 36 个 cup，
 * 红/蓝装填区 26 根 pin + 20 个 cup。
 *
 * · goal 上：4 个中立 goal + 中场高 goal 各插一根黄/黄 pin，4 个联盟 goal 空着
 * · 场上：8 个落位各一组 cup + 插在 cup 里的 pin，4 个落位只有 cup；
 *   四面墙各 2 组 (cup, 插着 pin 的 cup, cup)；4 个斜角落位周围各躺着 4 根 pin
 * · 装填区：红方 10 组 (cup + 红/黄 pin) + 2 根预装，蓝方对称
 *
 * 散件**不参与计分**（手册只算 goal 里的 pin 和中场的机器人）。
 */
import type { LooseItem } from '@/state/store'
import type { StackItem } from '@/state/scoring'

export const INITIAL_SETUP_BUILD = 'official-cad-2026-04-26'

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
  { id: 'setup-0', kind: 'pin', halves: ['blue', 'red'], x: -598.06, y: 0.0, nested: true },
  { id: 'setup-1', kind: 'pin', halves: ['blue', 'red'], x: 0.0, y: -598.06, nested: true },
  { id: 'setup-2', kind: 'pin', halves: ['red', 'blue'], x: -0.0, y: 598.06, nested: true },
  { id: 'setup-3', kind: 'pin', halves: ['red', 'blue'], x: 598.06, y: -0.0, nested: true },
  { id: 'setup-4', kind: 'pin', halves: ['yellow', 'yellow'], x: -1743.1, y: -598.06, nested: true },
  { id: 'setup-5', kind: 'pin', halves: ['yellow', 'yellow'], x: -1196.12, y: -1196.12, nested: true },
  { id: 'setup-8', kind: 'pin', halves: ['yellow', 'red'], x: -1196.12, y: 1078.6, axis: [0.0, -0.966, 0.2584] },
  { id: 'setup-9', kind: 'pin', halves: ['yellow', 'red'], x: -1313.63, y: 1196.12, axis: [-0.966, 0.0, 0.2584] },
  { id: 'setup-10', kind: 'pin', halves: ['yellow', 'blue'], x: -1196.12, y: 1313.63, axis: [0.0, 0.966, 0.2584] },
  { id: 'setup-11', kind: 'pin', halves: ['yellow', 'blue'], x: -1078.6, y: 1196.12, axis: [0.966, -0.0, 0.2584] },
  { id: 'setup-12', kind: 'pin', halves: ['yellow', 'red'], x: -598.06, y: 480.33, axis: [0.0, -0.966, 0.2584] },
  { id: 'setup-13', kind: 'pin', halves: ['yellow', 'red'], x: -715.79, y: 598.06, axis: [-0.966, 0.0, 0.2584] },
  { id: 'setup-14', kind: 'pin', halves: ['yellow', 'blue'], x: -598.06, y: 715.79, axis: [0.0, 0.966, 0.2584] },
  { id: 'setup-15', kind: 'pin', halves: ['yellow', 'blue'], x: -480.33, y: 598.06, axis: [0.966, -0.0, 0.2584] },
  { id: 'setup-16', kind: 'pin', halves: ['yellow', 'red'], x: 1078.6, y: -1196.12, axis: [-0.966, 0.0, 0.2584] },
  { id: 'setup-17', kind: 'pin', halves: ['yellow', 'red'], x: 480.33, y: -598.06, axis: [-0.966, 0.0, 0.2584] },
  { id: 'setup-18', kind: 'pin', halves: ['yellow', 'red'], x: 1196.12, y: -1313.63, axis: [-0.0, -0.966, 0.2584] },
  { id: 'setup-19', kind: 'pin', halves: ['yellow', 'blue'], x: 1313.63, y: -1196.12, axis: [0.966, -0.0, 0.2584] },
  { id: 'setup-20', kind: 'pin', halves: ['yellow', 'blue'], x: 1196.12, y: -1078.6, axis: [0.0, 0.966, 0.2584] },
  { id: 'setup-21', kind: 'pin', halves: ['yellow', 'red'], x: 598.06, y: -715.79, axis: [-0.0, -0.966, 0.2584] },
  { id: 'setup-22', kind: 'pin', halves: ['yellow', 'blue'], x: 715.79, y: -598.06, axis: [0.966, -0.0, 0.2584] },
  { id: 'setup-23', kind: 'pin', halves: ['yellow', 'blue'], x: 598.06, y: -480.33, axis: [0.0, 0.966, 0.2584] },
  { id: 'setup-24', kind: 'pin', halves: ['yellow', 'yellow'], x: -1743.1, y: 598.06, nested: true },
  { id: 'setup-25', kind: 'pin', halves: ['yellow', 'yellow'], x: -598.06, y: 1743.1, nested: true },
  { id: 'setup-26', kind: 'pin', halves: ['yellow', 'yellow'], x: 1743.1, y: 598.06, nested: true },
  { id: 'setup-27', kind: 'pin', halves: ['yellow', 'yellow'], x: 598.06, y: -1743.1, nested: true },
  { id: 'setup-28', kind: 'pin', halves: ['yellow', 'yellow'], x: 598.06, y: 1743.1, nested: true },
  { id: 'setup-29', kind: 'pin', halves: ['yellow', 'yellow'], x: 1743.1, y: -598.06, nested: true },
  { id: 'setup-30', kind: 'pin', halves: ['yellow', 'yellow'], x: -598.06, y: -1743.1, nested: true },
  { id: 'setup-31', kind: 'pin', halves: ['yellow', 'yellow'], x: -598.06, y: -598.06, nested: true },
  { id: 'setup-35', kind: 'pin', halves: ['yellow', 'yellow'], x: 598.06, y: 598.06, nested: true },
  { id: 'setup-36', kind: 'pin', halves: ['yellow', 'yellow'], x: 1196.12, y: 1196.12, nested: true },
  { id: 'setup-37', kind: 'pin', halves: ['yellow', 'red'], x: -2250.0, y: -1200.0 },
  { id: 'setup-38', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: -40.25 },
  { id: 'setup-39', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: -120.75 },
  { id: 'setup-40', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: -201.25 },
  { id: 'setup-41', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: -281.75 },
  { id: 'setup-42', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: -362.25 },
  { id: 'setup-43', kind: 'pin', halves: ['yellow', 'red'], x: -2250.0, y: 1200.0 },
  { id: 'setup-44', kind: 'pin', halves: ['yellow', 'blue'], x: 2250.0, y: -1200.0 },
  { id: 'setup-45', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: -40.25 },
  { id: 'setup-46', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: -120.75 },
  { id: 'setup-47', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: -201.25 },
  { id: 'setup-48', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: -281.75 },
  { id: 'setup-49', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: -362.25 },
  { id: 'setup-50', kind: 'pin', halves: ['yellow', 'blue'], x: 2250.0, y: 1200.0 },
  { id: 'setup-51', kind: 'pin', halves: ['yellow', 'yellow'], x: -2250.0, y: -0.0 },
  { id: 'setup-52', kind: 'pin', halves: ['yellow', 'yellow'], x: 2250.0, y: 0.0 },
  { id: 'setup-53', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: 40.25 },
  { id: 'setup-54', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: 120.75 },
  { id: 'setup-55', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: 201.25 },
  { id: 'setup-56', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: 281.75 },
  { id: 'setup-57', kind: 'pin', halves: ['yellow', 'red'], x: -2350.0, y: 362.25 },
  { id: 'setup-58', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: 40.25 },
  { id: 'setup-59', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: 120.75 },
  { id: 'setup-60', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: 201.25 },
  { id: 'setup-61', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: 281.75 },
  { id: 'setup-62', kind: 'pin', halves: ['yellow', 'blue'], x: 2350.0, y: 362.25 },
  { id: 'setup-63', kind: 'cup', halves: ['gray', 'clear'], x: -598.06, y: 0.0 },
  { id: 'setup-64', kind: 'cup', halves: ['gray', 'clear'], x: 0.0, y: -598.06 },
  { id: 'setup-65', kind: 'cup', halves: ['gray', 'clear'], x: -0.0, y: 598.06 },
  { id: 'setup-66', kind: 'cup', halves: ['gray', 'clear'], x: 598.06, y: -0.0 },
  { id: 'setup-67', kind: 'cup', halves: ['clear', 'gray'], x: -1743.1, y: -598.06 },
  { id: 'setup-68', kind: 'cup', halves: ['gray', 'clear'], x: -1196.12, y: 1196.12 },
  { id: 'setup-69', kind: 'cup', halves: ['gray', 'clear'], x: -598.06, y: 598.06 },
  { id: 'setup-70', kind: 'cup', halves: ['gray', 'clear'], x: 1196.12, y: -1196.12 },
  { id: 'setup-71', kind: 'cup', halves: ['gray', 'clear'], x: 598.06, y: -598.06 },
  { id: 'setup-72', kind: 'cup', halves: ['clear', 'gray'], x: -1743.1, y: 598.06 },
  { id: 'setup-73', kind: 'cup', halves: ['clear', 'gray'], x: -598.06, y: 1743.1 },
  { id: 'setup-74', kind: 'cup', halves: ['clear', 'gray'], x: 1743.1, y: 598.06 },
  { id: 'setup-75', kind: 'cup', halves: ['clear', 'gray'], x: 598.06, y: -1743.1 },
  { id: 'setup-76', kind: 'cup', halves: ['clear', 'gray'], x: 598.06, y: 1743.1 },
  { id: 'setup-77', kind: 'cup', halves: ['clear', 'gray'], x: 1743.1, y: -598.06 },
  { id: 'setup-78', kind: 'cup', halves: ['clear', 'gray'], x: -598.06, y: -1743.1 },
  { id: 'setup-79', kind: 'cup', halves: ['gray', 'clear'], x: -1196.12, y: -1196.12 },
  { id: 'setup-80', kind: 'cup', halves: ['gray', 'clear'], x: -598.06, y: -598.06 },
  { id: 'setup-81', kind: 'cup', halves: ['gray', 'clear'], x: 1196.12, y: 1196.12 },
  { id: 'setup-82', kind: 'cup', halves: ['gray', 'clear'], x: 598.06, y: 598.06 },
  { id: 'setup-83', kind: 'cup', halves: ['clear', 'gray'], x: -1743.1, y: -678.26 },
  { id: 'setup-84', kind: 'cup', halves: ['clear', 'gray'], x: -1743.1, y: -517.86 },
  { id: 'setup-85', kind: 'cup', halves: ['clear', 'gray'], x: -1743.1, y: 678.26 },
  { id: 'setup-86', kind: 'cup', halves: ['clear', 'gray'], x: -1743.1, y: 517.86 },
  { id: 'setup-87', kind: 'cup', halves: ['clear', 'gray'], x: 517.86, y: 1743.1 },
  { id: 'setup-88', kind: 'cup', halves: ['clear', 'gray'], x: 1743.1, y: -517.86 },
  { id: 'setup-89', kind: 'cup', halves: ['clear', 'gray'], x: -517.86, y: -1743.1 },
  { id: 'setup-90', kind: 'cup', halves: ['clear', 'gray'], x: 678.26, y: 1743.1 },
  { id: 'setup-91', kind: 'cup', halves: ['clear', 'gray'], x: 1743.1, y: -678.26 },
  { id: 'setup-92', kind: 'cup', halves: ['clear', 'gray'], x: -678.26, y: -1743.1 },
  { id: 'setup-93', kind: 'cup', halves: ['clear', 'gray'], x: -517.86, y: 1743.1 },
  { id: 'setup-94', kind: 'cup', halves: ['clear', 'gray'], x: 1743.1, y: 517.86 },
  { id: 'setup-95', kind: 'cup', halves: ['clear', 'gray'], x: 517.86, y: -1743.1 },
  { id: 'setup-96', kind: 'cup', halves: ['clear', 'gray'], x: -678.26, y: 1743.1 },
  { id: 'setup-97', kind: 'cup', halves: ['clear', 'gray'], x: 1743.1, y: 678.26 },
  { id: 'setup-98', kind: 'cup', halves: ['clear', 'gray'], x: 678.26, y: -1743.1 },
  { id: 'setup-99', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: -40.25 },
  { id: 'setup-100', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: -120.75 },
  { id: 'setup-101', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: -201.25 },
  { id: 'setup-102', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: -281.75 },
  { id: 'setup-103', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: -362.25 },
  { id: 'setup-104', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: -40.25 },
  { id: 'setup-105', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: -120.75 },
  { id: 'setup-106', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: -201.25 },
  { id: 'setup-107', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: -281.75 },
  { id: 'setup-108', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: -362.25 },
  { id: 'setup-109', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: 40.25 },
  { id: 'setup-110', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: 120.75 },
  { id: 'setup-111', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: 201.25 },
  { id: 'setup-112', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: 281.75 },
  { id: 'setup-113', kind: 'cup', halves: ['gray', 'clear'], x: -2450.0, y: 362.25 },
  { id: 'setup-114', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: 40.25 },
  { id: 'setup-115', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: 120.75 },
  { id: 'setup-116', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: 201.25 },
  { id: 'setup-117', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: 281.75 },
  { id: 'setup-118', kind: 'cup', halves: ['gray', 'clear'], x: 2450.0, y: 362.25 },
]
