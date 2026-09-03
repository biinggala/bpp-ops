// 구글 캘린더가 **화면에 그리는** 색.
//
// API는 옛 팔레트를 돌려줍니다 — 기본 캘린더는 `#9fe1e7`, 토마토색 일정은
// `#dc2127`. 그런데 구글 캘린더 화면은 그 색을 안 씁니다. 같은 '공작(Peacock)'이
// 화면에서는 `#039be5`고, 그래서 우리 달력과 구글 달력을 나란히 놓으면 같은
// 일정이 다른 색이었습니다. 여기서 옛 값을 화면 값으로 바꿉니다.
//
// 표에 없는 색은 그대로 둡니다 — 사람이 직접 고른 색은 API도 그 값 그대로
// 주고, 그건 이미 화면 색입니다.

/** 일정 색 id(1–11) → 화면 색. 일정에 색을 따로 칠했을 때만 옵니다. */
export const EVENT_COLOURS: Record<string, string> = {
  '1': '#7986cb',  // Lavender
  '2': '#33b679',  // Sage
  '3': '#8e24aa',  // Grape
  '4': '#e67c73',  // Flamingo
  '5': '#f6bf26',  // Banana
  '6': '#f4511e',  // Tangerine
  '7': '#039be5',  // Peacock
  '8': '#616161',  // Graphite
  '9': '#3f51b5',  // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
}

/** 캘린더 색 — API의 옛 hex → 화면 hex. 목록 순서는 구글의 colorId 1–24. */
const CALENDAR_LEGACY_TO_MODERN: Record<string, string> = {
  '#ac725e': '#795548', // Cocoa
  '#d06b64': '#e67c73', // Flamingo
  '#f83a22': '#d50000', // Tomato
  '#fa573c': '#f4511e', // Tangerine
  '#ff7537': '#ef6c00', // Pumpkin
  '#ffad46': '#f09300', // Mango
  '#42d692': '#009688', // Eucalyptus
  '#16a765': '#0b8043', // Basil
  '#7bd148': '#7cb342', // Pistachio
  '#b3dc6c': '#c0ca33', // Avocado
  '#fbe983': '#e4c441', // Citron
  '#fad165': '#f6bf26', // Banana
  '#92e1c0': '#33b679', // Sage
  '#9fe1e7': '#039be5', // Peacock
  '#9fc6e7': '#4285f4', // Cobalt
  '#4986e7': '#3f51b5', // Blueberry
  '#9a9cff': '#7986cb', // Lavender
  '#b99aff': '#b39ddb', // Wisteria
  '#c2c2c2': '#616161', // Graphite
  '#cabdbf': '#a79b8e', // Birch
  '#cca6ac': '#ad1457', // Radicchio
  '#f691b2': '#d81b60', // Cherry Blossom
  '#cd74e6': '#8e24aa', // Grape
  '#a47ae2': '#9e69af', // Amethyst
}

/** 일정 색 id의 옛 hex. 일정 목록이 colorId 대신 이걸 줄 일은 없지만, 캐시에 남은 옛 값을 위해. */
const EVENT_LEGACY_TO_MODERN: Record<string, string> = {
  '#a4bdfc': '#7986cb', '#7ae7bf': '#33b679', '#dbadff': '#8e24aa', '#ff887c': '#e67c73',
  '#fbd75b': '#f6bf26', '#ffb878': '#f4511e', '#46d6db': '#039be5', '#e1e1e1': '#616161',
  '#5484ed': '#3f51b5', '#51b749': '#0b8043', '#dc2127': '#d50000',
}

/** 캘린더가 화면에 그려지는 색. */
export function calendarColour(backgroundColor: string | null | undefined): string {
  const hex = (backgroundColor ?? '').trim().toLowerCase()
  if (!hex) return '#4285f4'
  return CALENDAR_LEGACY_TO_MODERN[hex] ?? EVENT_LEGACY_TO_MODERN[hex] ?? hex
}

/**
 * 일정이 화면에 그려지는 색.
 *
 * 일정에 색을 따로 칠했으면 그 색, 아니면 캘린더 색 — 구글이 그리는 순서
 * 그대로입니다. 모르는 id(구글이 팔레트를 늘리면)는 캘린더 색으로 물러납니다.
 */
export function eventColour(colorId: string | null | undefined, calendarColor: string | null | undefined): string {
  const own = colorId ? EVENT_COLOURS[colorId] : undefined
  return own ?? calendarColour(calendarColor)
}
