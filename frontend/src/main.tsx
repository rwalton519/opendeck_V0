import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { PrivyWalletLinkProvider } from "./context/PrivyWalletLinkContext";
import { PrivyProviders } from "./providers/PrivyProviders";
import "./styles/global.css";

// FIXED (spec v3.0, issue 7.1): AdminAuthProvider used to wrap App here for
// the SPA's own admin session (POST /admin/login). That admin surface has
// been retired in favor of the static dashboard at /admin/, which manages
// its own session independently and outside this SPA entirely - nothing
// under src/ authenticates as an admin anymore, so there's no admin
// session to provide.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PrivyProviders>
        <AuthProvider>
          <PrivyWalletLinkProvider>
            <App />
          </PrivyWalletLinkProvider>
        </AuthProvider>
      </PrivyProviders>
    </BrowserRouter>
  </StrictMode>,
);
