// Runs before every client (component) test. Registers jest-dom's custom
// matchers (`toBeInTheDocument`, `toBeDisabled`, …) on Vitest's `expect`.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// Unmount rendered components between tests; without this each `render` stacks
// another copy in `document.body`, so queries match multiple elements.
afterEach(() => cleanup());
