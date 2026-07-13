export interface MapCommand {
  type: string
  payload: unknown
}

type Listener = (cmd: MapCommand) => void

const listeners = new Set<Listener>()

export const mapCommandBus = {
  dispatch(cmd: MapCommand) {
    listeners.forEach(fn => fn(cmd))
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
