import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * Vercel already sends HSTS on its own, but relying on a platform default
 * means the guarantee is not in this repo and changes without a commit. These
 * are all set explicitly so the policy is reviewable here.
 *
 * Deliberately absent: a `script-src`/`style-src` CSP. Next inlines the RSC
 * payload and hydration bootstrap as inline `<script>` tags, so a real policy
 * needs a per-request nonce threaded from `src/proxy.ts` into the document.
 * Getting that wrong breaks hydration silently — the page renders and then
 * simply stops being interactive — which is a worse failure than the one it
 * prevents. The directives below were chosen because none of them can do
 * that: they restrict framing, form targets and the base URL, and no
 * legitimate request in this app touches any of the three.
 */
const SECURITY_HEADERS = [
  {
    // Two years, matching what Vercel was already sending. `includeSubDomains`
    // is safe here: the only subdomain in use is send.groundsroute.com, which
    // exists for Resend's SMTP records and serves nothing over HTTP.
    //
    // `preload` is omitted on purpose. Submission to the browser preload list
    // is a separate, deliberate act and is slow and awkward to reverse — it
    // should not ride along in a headers refactor.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Modern browsers already default to this, but stating it removes the
    // dependency on that default. It matters more here than in most apps:
    // password-reset, email-verification and email-change links are
    // single-use tokens in a URL, and a full `Referer` leaking one to a
    // third party is a failure this project has already designed around
    // (see the peek/consume split and the no-remote-assets rule for email
    // templates in AGENTS.md).
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Superseded by `frame-ancestors` below, but kept because browsers that
    // ignore CSP framing directives still honour this one, and nothing in
    // this app is ever meant to be embedded.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // The app asks for none of these. Denying them means a dependency that
    // starts asking cannot silently succeed.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    // `form-action 'self'` is safe despite the Stripe integration: Checkout
    // and the Billing Portal are reached by a server-side redirect to a
    // Stripe URL, never by posting a form at Stripe, and Server Actions post
    // to this origin. `base-uri 'self'` stops an injected <base> tag from
    // re-pointing every relative URL on the page.
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
