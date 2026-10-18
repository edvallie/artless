import type { RouteObject } from 'react-router'
import App from './App'
import { About } from './pages/About'
import { NotFound } from './pages/NotFound'
import { Roaster } from './pages/Roaster'

// Every page sits inside the shell, so moving between them never touches the connection or the recording.
export const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { index: true, element: <Roaster /> },
      { path: 'about', element: <About /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
