import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // The [INVALID_ANNOTATION] lines in `npm run build` output come from
      // /*#__PURE__*/ comments inside @privy-io/react-auth's and
      // @walletconnect/*'s own published node_modules bundles (their build,
      // not ours), sitting in a position Rolldown's parser can't attach to
      // a call expression. Harmless - the build succeeds either way; the
      // only effect is skipped dead-code-elimination for those specific
      // expressions in third-party code. Nothing to fix in our own source,
      // so this just turns the check off. See
      // https://rolldown.rs/reference/InputOptions.checks#invalidannotation
      checks: {
        invalidAnnotation: false,
      },
    },
    chunkSizeWarningLimit: 800,
  },
})
