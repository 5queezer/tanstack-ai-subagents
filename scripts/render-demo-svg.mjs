import fs from 'node:fs'

const castPath = 'demo/routing-in-action.cast'
const svgPath = 'demo/routing-in-action.svg'
const lines = fs.readFileSync(castPath, 'utf8').trim().split('\n').slice(1)
const text = lines
  .map((line) => JSON.parse(line)[2])
  .join('')
  .replace(/\r/g, '')
  .split('\n')
  .filter((line, index, all) => line.length > 0 || index < all.length - 1)

const escaped = text.map((line) => line
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;'))

const width = 920
const lineHeight = 22
const top = 58
const height = top + escaped.length * lineHeight + 28

const rows = escaped.map((line, index) => {
  const y = top + index * lineHeight
  const color = line.startsWith('$') ? '#7ee787' : line.includes('✓') ? '#79c0ff' : line.includes('action:') || line.includes('status:') ? '#ffa657' : '#c9d1d9'
  return `  <text x="24" y="${y}" fill="${color}">${line || ' '}</text>`
}).join('\n')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="tanstack-ai-subagents routing demo">
  <title>tanstack-ai-subagents routing demo</title>
  <rect width="100%" height="100%" rx="12" fill="#0d1117"/>
  <circle cx="24" cy="24" r="6" fill="#ff5f56"/>
  <circle cx="44" cy="24" r="6" fill="#ffbd2e"/>
  <circle cx="64" cy="24" r="6" fill="#27c93f"/>
  <text x="92" y="29" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">routing-in-action.cast · 17s</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="16">
${rows}
  </g>
</svg>
`

fs.writeFileSync(svgPath, svg)
console.log(`wrote ${svgPath}`)
