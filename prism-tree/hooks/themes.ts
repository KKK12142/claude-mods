import type { Theme } from '../types'

// The tone slots the tree flashes with. The names are the slots' historic
// colors (reads were purple, writes orange, commits green, pushes teal,
// pulls blue, failures red); each preset fills every slot with its own hue.
export const TONE_SLOTS = ['orange', 'green', 'teal', 'blue', 'purple', 'cyan', 'red'] as const
export type ToneSlot = (typeof TONE_SLOTS)[number]
export type Tone = { bright: string[]; dim: string[]; solid: string }

export type Preset = {
  label: string
  // A one-cell mark drawn before the header (East Asian width Neutral, so a
  // CJK terminal still draws it one cell wide).
  mark: string
  light: boolean
  base: Theme
  hover: string
  // What the shimmer band blends toward at its peak.
  glow: string
  git: { add: string; del: string; mod: string; ren: string }
  hues: Record<ToneSlot, string>
}

export type Palette = Preset & { name: string; tones: Record<string, Tone> }

const PRESETS: Record<string, Preset> = {
  aurora: {
    label: 'Aurora',
    mark: '✦',
    light: false,
    base: { fg: '', accent: '#5eead4', muted: '#7b8794', urgent: '#fb7185', selection: '#16384a', bg: '' },
    hover: '#11252f',
    glow: '#c4b5fd',
    git: { add: '#6ee7b7', del: '#fb7185', mod: '#fde68a', ren: '#7dd3fc' },
    hues: { orange: '#f0abfc', green: '#6ee7b7', teal: '#5eead4', blue: '#7dd3fc', purple: '#a5b4fc', cyan: '#67e8f9', red: '#fb7185' },
  },
  ember: {
    label: 'Ember',
    mark: '✶',
    light: false,
    base: { fg: '', accent: '#f59e0b', muted: '#8f8272', urgent: '#ef4444', selection: '#4a2c17', bg: '' },
    hover: '#2e1d11',
    glow: '#fde68a',
    git: { add: '#bef264', del: '#f87171', mod: '#fcd34d', ren: '#fdba74' },
    hues: { orange: '#fb923c', green: '#a3e635', teal: '#facc15', blue: '#fdba74', purple: '#c4b5fd', cyan: '#fcd34d', red: '#f87171' },
  },
  forest: {
    label: 'Forest',
    mark: '✿',
    light: false,
    base: { fg: '', accent: '#84cc16', muted: '#7d8a76', urgent: '#f43f5e', selection: '#203320', bg: '' },
    hover: '#172417',
    glow: '#ecfccb',
    git: { add: '#86efac', del: '#fda4af', mod: '#facc15', ren: '#93c5fd' },
    hues: { orange: '#eab308', green: '#4ade80', teal: '#2dd4bf', blue: '#93c5fd', purple: '#a78bfa', cyan: '#5eead4', red: '#f87171' },
  },
  mono: {
    label: 'Mono',
    mark: '✱',
    light: false,
    base: { fg: '', accent: '#e5e7eb', muted: '#6b7280', urgent: '#f87171', selection: '#3a3f47', bg: '' },
    hover: '#2a2d33',
    glow: '#ffffff',
    git: { add: '#d4d4d8', del: '#f87171', mod: '#a1a1aa', ren: '#d4d4d8' },
    hues: { orange: '#f4f4f5', green: '#d4d4d8', teal: '#e4e4e7', blue: '#a1a1aa', purple: '#c4c4cc', cyan: '#e4e4e7', red: '#f87171' },
  },
  paper: {
    label: 'Paper',
    mark: '✧',
    light: true,
    base: { fg: '', accent: '#0f766e', muted: '#6b7280', urgent: '#b91c1c', selection: '#d6e9f8', bg: '' },
    hover: '#eaf3fb',
    glow: '#111827',
    git: { add: '#15803d', del: '#b91c1c', mod: '#a16207', ren: '#1d4ed8' },
    hues: { orange: '#c2410c', green: '#15803d', teal: '#0f766e', blue: '#1d4ed8', purple: '#7e22ce', cyan: '#0e7490', red: '#b91c1c' },
  },
  classic: {
    label: 'Classic',
    mark: '',
    light: false,
    base: { fg: '', accent: '#5b9bd5', muted: '#808a96', urgent: '#d0605e', selection: '#6b7280', bg: '' },
    hover: '#3c4048',
    glow: '#ffffff',
    git: { add: '#98c379', del: '#e06c75', mod: '#e5c07b', ren: '#61afef' },
    hues: { orange: '#f97316', green: '#22c55e', teal: '#14b8a6', blue: '#3b82f6', purple: '#a855f7', cyan: '#06b6d4', red: '#ef4444' },
  },
}

export const THEME_NAMES = Object.keys(PRESETS)
export const DEFAULT_PRESET = 'aurora'

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return `#${x.map((c, i) => Math.round(c + ((y[i] ?? c) - c) * t).toString(16).padStart(2, '0')).join('')}`
}

// A shimmer ramp: index 0 is the hue itself, index 3 the band's peak. Dark
// presets dim toward black and peak toward their glow; the light preset dims
// toward white (a faded hue on paper) and peaks toward its dark glow.
export function ramp(hue: string, glow: string, light: boolean): Tone {
  const fade = light ? '#ffffff' : '#000000'
  return {
    bright: [hue, mix(hue, glow, 0.3), mix(hue, glow, 0.55), mix(hue, glow, 0.8)],
    dim: [mix(hue, fade, 0.58), mix(hue, fade, 0.46), mix(hue, fade, 0.32), mix(hue, fade, 0.18)],
    solid: hue,
  }
}

const cache = new Map<string, Palette>()

export function isPreset(name: unknown): name is string {
  return typeof name === 'string' && name in PRESETS
}

export function palette(name: unknown): Palette {
  const key = isPreset(name) ? name : DEFAULT_PRESET
  const hit = cache.get(key)
  if (hit) return hit
  const p = PRESETS[key] as Preset
  const tones: Record<string, Tone> = {}
  for (const slot of TONE_SLOTS) tones[slot] = ramp(p.hues[slot], p.glow, p.light)
  const built: Palette = { ...p, name: key, tones }
  cache.set(key, built)
  return built
}

export function nextPreset(name: string): string {
  const i = THEME_NAMES.indexOf(name)
  return THEME_NAMES[(i + 1) % THEME_NAMES.length] ?? DEFAULT_PRESET
}

export function gitColors(p: Palette): Record<string, string> {
  return { A: p.git.add, '?': p.git.add, R: p.git.ren, C: p.git.ren, M: p.git.mod, T: p.git.mod }
}
