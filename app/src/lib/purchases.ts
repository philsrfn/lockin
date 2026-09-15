/**
 * Whether this build can sell anything.
 *
 * 1.0 goes to App Review before StoreKit exists. Apple rejects an app that
 * talks about a subscription it gives no way to buy (guideline 3.1.1), so until
 * purchases ship, nothing on screen mentions a trial, a plan or a lapse.
 *
 * The server is unchanged: a new account still gets `TRIAL_DAYS`. That makes
 * this a deadline rather than a switch — StoreKit has to ship inside that
 * window, or trials have to be extended from the admin panel, before the
 * first one runs out and somebody is told they need a subscription they
 * cannot buy.
 */
export const PURCHASES_AVAILABLE = false;
