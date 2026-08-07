import ReturnClient from "./ReturnClient";

// Public by way of src/proxy.ts: the visitor arrives here straight from Stripe
// with no session, and on a good day no account existed a second ago either.
export default function BillingReturnPage() {
  return <ReturnClient />;
}
