// Pull @testing-library/jest-dom's matcher type augmentations into the TS
// program so svelte-check knows `toBeInTheDocument`, `toBeDisabled`, etc. The
// runtime registration lives in the root `vitest-setup-client.ts`; this file
// exists only because that setup file sits outside the tsconfig `include`.
import '@testing-library/jest-dom/vitest';
