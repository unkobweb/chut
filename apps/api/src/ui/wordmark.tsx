/**
 * The wordmark, drawn as a dot matrix in SVG.
 *
 * The mockups used an ASCII banner made of text characters. It fell apart in
 * practice: its shape depends on whichever monospace font the device happens to
 * have, and on a phone it rendered as a smear of green rather than a word. A logo
 * nobody can read looks like a broken page — and a broken page is exactly what a
 * phishing attempt looks like, on a screen that is about to ask for a credential.
 *
 * Drawn as rectangles, it is the same everywhere, at any size, in any font
 * situation, and it still reads as a terminal.
 */

// 5x7 cells per glyph. '#' is a lit pixel.
const GLYPHS: Record<string, string[]> = {
  c: ['.....', '.....', '.###.', '#...#', '#....', '#...#', '.###.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  t: ['.#...', '.#...', '####.', '.#...', '.#...', '.#..#', '..##.'],
}

const WORD = 'chut'
const CELL = 3
const GAP = 1
const GLYPH_GAP = 2
const COLS = 5
const ROWS = 7

const step = CELL + GAP
const glyphWidth = COLS * step - GAP
const width = WORD.length * glyphWidth + (WORD.length - 1) * (GLYPH_GAP + GAP)
const height = ROWS * step - GAP

export function Wordmark({ title = 'chut' }: { title?: string }) {
  const pixels: { x: number; y: number }[] = []

  WORD.split('').forEach((char, index) => {
    const glyph = GLYPHS[char]
    if (!glyph) return
    const offsetX = index * (glyphWidth + GLYPH_GAP + GAP)
    glyph.forEach((line, row) => {
      line.split('').forEach((cell, col) => {
        if (cell === '#') pixels.push({ x: offsetX + col * step, y: row * step })
      })
    })
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width * 1.6}
      height={height * 1.6}
      role="img"
      aria-label={title}
      fill="currentColor"
      class="text-phosphor"
    >
      <title>{title}</title>
      {pixels.map((p) => (
        <rect x={p.x} y={p.y} width={CELL} height={CELL} />
      ))}
    </svg>
  )
}
