/** Static asset module declarations for the Vite renderer build.
 *  Importing an image yields its resolved (hashed) URL as a string. */
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
