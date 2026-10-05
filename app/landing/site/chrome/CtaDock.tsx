import { DemoCta, StartCta } from "./Ctas";

/** The phone / portrait CTA dock (`.dock`, shown by chrome.css below 1100px or a
 *  5:4 aspect): the two calls to action, pinned to the bottom edge. */
export default function CtaDock({ signupOpen, placement }: { signupOpen: boolean; placement: string }) {
  return (
    <div className="dock" id="dock">
      <StartCta signupOpen={signupOpen} placement={placement} className="btn primary" />
      <DemoCta className="btn" />
    </div>
  );
}
