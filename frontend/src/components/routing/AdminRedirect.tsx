import { useEffect } from "react";

/**
 * FIXED (spec v3.0, issue 7.1): the app used to ship two independent admin
 * surfaces - this React SPA's own /admin/login + /admin/withdrawals routes
 * (AdminLoginPage, AdminWithdrawalQueuePage, gated by RequireAdmin), and a
 * separate hand-built static dashboard at dist/admin/index.html covering
 * those same two things (login, withdrawal queue) *plus* the ledger,
 * accounts, and fraud-flag surfaces the React routes never had any UI for
 * at all. Both called the exact same backend /admin/* endpoints from two
 * unrelated codebases with no shared session or design system.
 *
 * The static dashboard is the more complete implementation and is kept as
 * the single canonical admin surface - see docs/ADMIN_SURFACE_DECISION.md
 * for the full writeup. AdminLoginPage, AdminWithdrawalQueuePage,
 * RequireAdmin, AdminAuthContext, useAdminAuth, and api/admin.ts have all
 * been removed accordingly (nothing in this SPA authenticates as an admin
 * or calls /admin/* anymore).
 *
 * This component exists purely for backward compatibility: anyone with an
 * old bookmark or link to /admin/login or /admin/withdrawals should still
 * land somewhere useful instead of hitting the 404 PageStub. A client-side
 * <Navigate> can't do that - /admin/ isn't a React Router route, it's a
 * real static file nginx serves directly, so reaching it requires an
 * actual browser navigation (a fresh request nginx can route), not a
 * history.pushState. Hence window.location rather than react-router's
 * Navigate here.
 */
export function AdminRedirect() {
  useEffect(() => {
    window.location.replace("/admin/");
  }, []);

  return null;
}
