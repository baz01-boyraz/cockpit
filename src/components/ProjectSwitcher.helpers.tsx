/** Small colored folder glyph derived deterministically from the project name. */
export function IconedFolder({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="projcard__glyph"
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 45% 26%), hsl(${(hue + 40) % 360} 40% 18%))`,
      }}
    >
      {initials || '·'}
    </div>
  )
}
