import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { Providers } from '@/app/providers';
import { router } from '@/app/routes';
import { bootstrapCustomer } from '@/stores/customer';
import '@/styles/globals.css';
import 'highlight.js/styles/github-dark.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Kick off the customer.yaml load BEFORE first render. This is
// best-effort: if the IPC call fails (vitest, web-only dev mode,
// missing backend) we still render with default Corey branding.
// We deliberately don't `await` here — the React tree starts
// rendering immediately and the `useCustomerStore` selectors return
// "not present" until the bootstrap resolves, then re-render with
// the real brand. That few-frames flash on a delivered build is
// acceptable for v0.2.0; if it becomes visible we can switch to
// blocking load via a Suspense boundary.
void bootstrapCustomer();

createRoot(rootEl).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
