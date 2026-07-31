// Kept as "mowify_session" despite the GroundsRoute rename: changing the
// cookie name would invalidate every existing session cookie in the wild,
// signing out every signed-in user (including the owner) on deploy.
export const SESSION_COOKIE = "mowify_session";
