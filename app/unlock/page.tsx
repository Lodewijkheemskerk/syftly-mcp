import type { Metadata } from "next";
import { Suspense } from "react";
import UnlockKeypad from "./UnlockKeypad";

// The lock screen itself is never indexed. useSearchParams (in the keypad) needs
// a Suspense boundary, so the page is a thin server wrapper around the client UI.
export const metadata: Metadata = {
  title: "Syftly — locked",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense>
      <UnlockKeypad />
    </Suspense>
  );
}
