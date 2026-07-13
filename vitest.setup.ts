import 'vitest-canvas-mock'

window.alert = (msg: string) => { console.log(msg) }
window.matchMedia = () => ({} as MediaQueryList)
window.scrollTo = () => {}
