/**
 * The rail's Notepad entry: a premium hairline divider that sets the notepad
 * apart from the nav group, plus the launcher button that opens the drawer.
 * Lives between the nav and the engine-bay footer in `LeftRail`.
 */
import { useNotepad } from '../store/useNotepad'
import { IconNotebook } from './notepadIcons'

export function NotepadLauncher() {
  const open = useNotepad((s) => s.open)
  const count = useNotepad((s) => s.notes.length)
  const toggle = useNotepad((s) => s.toggle)

  return (
    <div className="railNote">
      <div className="railNote__divider" aria-hidden />
      <button
        type="button"
        className={`railNote__btn ${open ? 'railNote__btn--active' : ''}`}
        onClick={() => toggle()}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Open notepad"
      >
        <span className="railNote__glyph">
          <IconNotebook width={17} height={17} />
        </span>
        <span className="railNote__label">Notepad</span>
        {count > 0 && <span className="railNote__count mono">{count}</span>}
      </button>
    </div>
  )
}
