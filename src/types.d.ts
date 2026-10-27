// AmbientScene and PlaygroundScene are React components rendered in main.tsx.
// They are intentionally client-only and avoid SSR in this app because main.tsx
// still runs on the server in some deployment targets; the export is a plain React
// component signature typed as ReactNode so it can be placed in the route tree.
declare module './scenes' {
  import { ReactNode } from 'react'
  export function AmbientScene(): ReactNode
  export function PlaygroundScene(): ReactNode
}
